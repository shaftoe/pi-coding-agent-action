/**
 * @file Issue/PR thread data fetching.
 *
 * Retrieves the complete thread (metadata + comments) for a GitHub issue or PR,
 * including inline review comments for pull requests. Used by the
 * `get_issue_or_pr_thread` Pi tool via the platform provider.
 */

import * as github from '@actions/github';
import { getOctokit } from '../octokit';
import { MAX_COMMENTS, MAX_REVIEW_COMMENTS } from '../constants';
import { getCoreAdapter } from '../index';
import type { ThreadComment, ReviewComment, IssueOrPRThread, GetIssueOrPRThreadParams } from '../types';
import RestEndpointMethodTypes from '@octokit/plugin-rest-endpoint-methods';

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  getCoreAdapter().debug(msg);
}

function resolveThreadParams(
  params?: GetIssueOrPRThreadParams
): { owner: string; repo: string; issueNumber: number; maxComments: number } | undefined {
  const { owner, repo, issue_number, max_comments = MAX_COMMENTS } = params ?? {};

  const resolvedOwner = owner ?? github.context.repo.owner;
  const resolvedRepo = repo ?? github.context.repo.repo;
  const resolvedIssueNumber = issue_number ?? github.context.issue.number;

  if (!resolvedOwner || !resolvedRepo || !resolvedIssueNumber) {
    debug(`[getIssueOrPRThread] Missing owner, repo, or issue_number`);
    return undefined;
  }

  return {
    owner: resolvedOwner,
    repo: resolvedRepo,
    issueNumber: resolvedIssueNumber,
    maxComments: max_comments,
  };
}

async function fetchIssueData(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{
  issue: RestEndpointMethodTypes.RestEndpointMethodTypes['issues']['get']['response']['data'];
  isPullRequest: boolean;
}> {
  const octokit = getOctokit();
  const issueData = await octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const issue = issueData.data;
  const isPullRequest = issue.pull_request !== undefined;

  return { issue, isPullRequest };
}

async function fetchPRData(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<
  RestEndpointMethodTypes.RestEndpointMethodTypes['pulls']['get']['response']['data'] | undefined
> {
  try {
    const octokit = getOctokit();
    const prData = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: issueNumber,
    });
    return prData.data;
  } catch (_e) {
    debug(`[getIssueOrPRThread] Failed to fetch PR data, continuing`);
    return undefined;
  }
}

function transformComment(comment: {
  id: number;
  user?: { login?: string | null; type?: string | null } | null;
  created_at: string;
  updated_at: string | null;
  body?: string | null;
}): ThreadComment {
  const triggeringCommentId =
    github.context.payload.comment?.id ?? github.context.payload.review?.id;

  const baseComment: ThreadComment = {
    id: comment.id,
    author: comment.user?.login ?? 'unknown',
    author_type: comment.user?.type === 'Bot' ? 'bot' : 'user',
    created_at: comment.created_at,
    body: comment.body ?? '',
    is_triggering_comment: comment.id === triggeringCommentId,
  };

  // Only include updated_at if it's not null (exactOptionalPropertyTypes)
  if (comment.updated_at !== null) {
    baseComment.updated_at = comment.updated_at;
  }

  return baseComment;
}

async function fetchThreadComments(
  owner: string,
  repo: string,
  issueNumber: number,
  maxComments: number
): Promise<ThreadComment[]> {
  const comments: ThreadComment[] = [];
  let page = 1;
  const perPage = Math.min(maxComments, MAX_COMMENTS);

  while (comments.length < maxComments) {
    const octokit = getOctokit();
    const commentsData = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: perPage,
      page,
    });

    if (commentsData.data.length === 0) {
      break;
    }

    for (const comment of commentsData.data) {
      if (comments.length >= maxComments) {
        break;
      }
      comments.push(transformComment(comment));
    }

    if (commentsData.data.length < perPage) {
      break;
    }
    page++;
  }

  return comments;
}

/**
 * Fetch inline review comments for a pull request.
 *
 * Retrieves PR review comments (comments on specific lines of the diff)
 * via `octokit.rest.pulls.listReviewComments()`. These are distinct from
 * issue-level comments — they carry file path and line information.
 *
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param pullNumber - Pull request number.
 * @param maxReviewComments - Maximum number of review comments to return.
 * @returns Array of review comments, or empty array on error.
 */
async function fetchPRReviewComments(
  owner: string,
  repo: string,
  pullNumber: number,
  maxReviewComments: number = MAX_REVIEW_COMMENTS
): Promise<ReviewComment[]> {
  try {
    const octokit = getOctokit();
    const reviewComments: ReviewComment[] = [];
    let page = 1;
    const perPage = Math.min(maxReviewComments, MAX_REVIEW_COMMENTS);

    while (reviewComments.length < maxReviewComments) {
      const response = await octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: perPage,
        page,
      });

      if (response.data.length === 0) {
        break;
      }

      for (const comment of response.data) {
        if (reviewComments.length >= maxReviewComments) {
          break;
        }
        reviewComments.push({
          id: comment.id,
          path: comment.path,
          line: comment.line ?? comment.original_line ?? null,
          side: (comment.side as 'LEFT' | 'RIGHT') ?? 'RIGHT',
          author: comment.user?.login ?? 'unknown',
          author_type: comment.user?.type === 'Bot' ? 'bot' : 'user',
          created_at: comment.created_at,
          body: comment.body,
          ...(comment.in_reply_to_id ? { in_reply_to_id: comment.in_reply_to_id } : {}),
        });
      }

      if (response.data.length < perPage) {
        break;
      }
      page++;
    }

    return reviewComments;
  } catch (_e) {
    debug(`[fetchPRReviewComments] Failed to fetch review comments, continuing`);
    return [];
  }
}

/**
 * Determine the state of an issue or pull request.
 *
 * Returns 'merged' for closed PRs that have a merged_at timestamp,
 * otherwise returns the raw issue state.
 *
 * @param issueState - The raw issue state ('open' or 'closed').
 * @param prData - Optional PR data containing the merged_at timestamp.
 * @returns The determined state: 'open', 'closed', or 'merged'.
 */
function determineThreadState(
  issueState: string,
  prData?: RestEndpointMethodTypes.RestEndpointMethodTypes['pulls']['get']['response']['data']
): 'open' | 'closed' | 'merged' {
  if (issueState === 'closed' && prData?.merged_at) {
    return 'merged';
  }
  return issueState as 'open' | 'closed' | 'merged';
}

function buildThreadResult(
  issue: RestEndpointMethodTypes.RestEndpointMethodTypes['issues']['get']['response']['data'],
  isPullRequest: boolean,
  prData?: RestEndpointMethodTypes.RestEndpointMethodTypes['pulls']['get']['response']['data'],
  comments?: ThreadComment[],
  reviewComments?: ReviewComment[]
): IssueOrPRThread {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: determineThreadState(issue.state, prData),
    author: issue.user?.login ?? 'unknown',
    author_type: issue.user?.type === 'Bot' ? 'bot' : 'user',
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    merged_at: prData?.merged_at ?? undefined,
    labels: issue.labels.map(l => (typeof l === 'string' ? l : (l.name ?? ''))),
    is_pull_request: isPullRequest,
    head_branch: prData?.head.ref,
    base_branch: prData?.base.ref,
    head_sha: prData?.head.sha,
    comments: comments ?? [],
    review_comments: reviewComments ?? [],
  };
}

/**
 * Fetch the complete thread (metadata + comments) for a GitHub issue or PR.
 *
 * For pull requests, also fetches inline review comments (comments on
 * specific lines of the diff) in addition to issue-level comments.
 *
 * @param params - Optional parameters to override the default owner, repo,
 *                 issue number, or comment limit.
 * @returns The full thread data, or `undefined` if the issue/PR could not be
 *          resolved or was not found (404).
 */
export async function getIssueOrPRThread(
  params?: GetIssueOrPRThreadParams
): Promise<IssueOrPRThread | undefined> {
  const resolvedParams = resolveThreadParams(params);
  if (!resolvedParams) {
    return undefined;
  }

  const { owner, repo, issueNumber, maxComments } = resolvedParams;

  try {
    const { issue, isPullRequest } = await fetchIssueData(owner, repo, issueNumber);

    const prData = isPullRequest ? await fetchPRData(owner, repo, issueNumber) : undefined;

    // Fetch issue-level comments and PR review comments in parallel for PRs
    let reviewComments: ReviewComment[] = [];
    let comments: ThreadComment[];

    if (isPullRequest) {
      const [issueComments, prReviewComments] = await Promise.all([
        fetchThreadComments(owner, repo, issueNumber, maxComments),
        fetchPRReviewComments(owner, repo, issueNumber),
      ]);
      comments = issueComments;
      reviewComments = prReviewComments;
    } else {
      comments = await fetchThreadComments(owner, repo, issueNumber, maxComments);
    }

    return buildThreadResult(issue, isPullRequest, prData, comments, reviewComments);
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404) {
      debug(`[getIssueOrPRThread] Issue/PR #${issueNumber} not found`);
      return undefined;
    }
    throw error;
  }
}

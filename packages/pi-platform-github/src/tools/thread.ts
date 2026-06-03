/**
 * @file Issue/PR thread data fetching.
 *
 * Retrieves the complete thread (metadata + comments) for a GitHub issue or PR,
 * including inline review comments for pull requests. Used by the
 * `get_issue_or_pr_thread` Pi tool via the platform provider.
 */

import { MAX_COMMENTS, MAX_REVIEW_COMMENTS } from '../constants';
import type {
  GitHubModuleDeps,
  ThreadComment,
  ReviewComment,
  IssueOrPRThread,
  GetIssueOrPRThreadParams,
} from '../types';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';

function resolveThreadParams(
  deps: GitHubModuleDeps,
  params?: GetIssueOrPRThreadParams
): { owner: string; repo: string; issueNumber: number; maxComments: number } | undefined {
  const { owner, repo, issue_number, max_comments = MAX_COMMENTS } = params ?? {};

  const resolvedOwner = owner ?? deps.context.repo.owner;
  const resolvedRepo = repo ?? deps.context.repo.repo;
  const resolvedIssueNumber = issue_number ?? deps.context.issue.number;

  if (!resolvedOwner || !resolvedRepo || !resolvedIssueNumber) {
    deps.logger.debug(`[getIssueOrPRThread] Missing owner, repo, or issue_number`);
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
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{
  issue: RestEndpointMethodTypes['issues']['get']['response']['data'];
  isPullRequest: boolean;
}> {
  const issueData = await deps.octokit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
  });

  const issue = issueData.data;
  const isPullRequest = issue.pull_request !== undefined;

  return { issue, isPullRequest };
}

async function fetchPRData(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<RestEndpointMethodTypes['pulls']['get']['response']['data'] | undefined> {
  try {
    const prData = await deps.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: issueNumber,
    });
    return prData.data;
  } catch (_e) {
    deps.logger.debug(`[getIssueOrPRThread] Failed to fetch PR data, continuing`);
    return undefined;
  }
}

function transformComment(
  deps: GitHubModuleDeps,
  comment: {
    id: number;
    user?: { login?: string | null; type?: string | null } | null;
    created_at: string;
    updated_at: string | null;
    body?: string | null;
  }
): ThreadComment {
  const triggeringCommentId =
    (deps.context.payload.comment as { id?: number } | undefined)?.id ??
    (deps.context.payload.review as { id?: number } | undefined)?.id;

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
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  issueNumber: number,
  maxComments: number
): Promise<ThreadComment[]> {
  const comments: ThreadComment[] = [];
  let page = 1;
  const perPage = Math.min(maxComments, MAX_COMMENTS);

  while (comments.length < maxComments) {
    const commentsData = await deps.octokit.rest.issues.listComments({
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
      comments.push(transformComment(deps, comment));
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
 * @param deps - Module dependencies.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param pullNumber - Pull request number.
 * @param maxReviewComments - Maximum number of review comments to return.
 * @returns Array of review comments, or empty array on error.
 */
async function fetchPRReviewComments(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  pullNumber: number,
  maxReviewComments: number = MAX_REVIEW_COMMENTS
): Promise<ReviewComment[]> {
  try {
    const reviewComments: ReviewComment[] = [];
    let page = 1;
    const perPage = Math.min(maxReviewComments, MAX_REVIEW_COMMENTS);

    while (reviewComments.length < maxReviewComments) {
      const response = await deps.octokit.rest.pulls.listReviewComments({
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
    deps.logger.debug(`[fetchPRReviewComments] Failed to fetch review comments, continuing`);
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
  prData?: RestEndpointMethodTypes['pulls']['get']['response']['data']
): 'open' | 'closed' | 'merged' {
  if (issueState === 'closed' && prData?.merged_at) {
    return 'merged';
  }
  return issueState as 'open' | 'closed' | 'merged';
}

function buildThreadResult(
  issue: RestEndpointMethodTypes['issues']['get']['response']['data'],
  isPullRequest: boolean,
  prData?: RestEndpointMethodTypes['pulls']['get']['response']['data'],
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
    labels: issue.labels.map((l: string | { name?: string }) =>
      typeof l === 'string' ? l : (l.name ?? '')
    ),
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
 * @param deps - Module dependencies.
 * @param params - Optional parameters to override the default owner, repo,
 *                 issue number, or comment limit.
 * @returns The full thread data, or `undefined` if the issue/PR could not be
 *          resolved or was not found (404).
 */
export async function getIssueOrPRThread(
  deps: GitHubModuleDeps,
  params?: GetIssueOrPRThreadParams
): Promise<IssueOrPRThread | undefined> {
  const resolvedParams = resolveThreadParams(deps, params);
  if (!resolvedParams) {
    return undefined;
  }

  const { owner, repo, issueNumber, maxComments } = resolvedParams;

  try {
    const { issue, isPullRequest } = await fetchIssueData(deps, owner, repo, issueNumber);

    const prData = isPullRequest ? await fetchPRData(deps, owner, repo, issueNumber) : undefined;

    // Fetch issue-level comments and PR review comments in parallel for PRs
    let reviewComments: ReviewComment[] = [];
    let comments: ThreadComment[];

    if (isPullRequest) {
      const [issueComments, prReviewComments] = await Promise.all([
        fetchThreadComments(deps, owner, repo, issueNumber, maxComments),
        fetchPRReviewComments(deps, owner, repo, issueNumber),
      ]);
      comments = issueComments;
      reviewComments = prReviewComments;
    } else {
      comments = await fetchThreadComments(deps, owner, repo, issueNumber, maxComments);
    }

    return buildThreadResult(issue, isPullRequest, prData, comments, reviewComments);
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404) {
      deps.logger.debug(`[getIssueOrPRThread] Issue/PR #${issueNumber} not found`);
      return undefined;
    }
    throw error;
  }
}

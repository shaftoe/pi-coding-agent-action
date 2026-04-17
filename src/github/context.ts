/**
 * @file GitHub context extraction and issue/PR thread retrieval.
 *
 * Reads the current GitHub Actions context (issue, pull request, or comment)
 * and provides helpers to build the prompt sent to the Pi agent, as well as a
 * richer `getIssueOrPRThread` function used by the `get_issue_or_pr_thread` tool.
 */

import * as github from '@actions/github';
import { Temporal } from '@js-temporal/polyfill';
import { getOctokit } from './octokit';
import { DEFAULT_TRIGGER, MAX_COMMENTS } from './constants';
import { isPR, getContextType } from './context-utils';
import { getCoreAdapter } from './index';
import RestEndpointMethodTypes from '@octokit/plugin-rest-endpoint-methods';

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  getCoreAdapter().debug(msg);
}

/**
 * Maps GitHub event names to functions that extract the relevant timestamp
 * from the event payload. Each extractor returns a timestamp string suitable
 * for `Temporal.Instant.from()`, or `undefined` if unavailable.
 */
const TIMESTAMP_SOURCES: Record<string, (p: typeof github.context.payload) => string | undefined> =
  {
    issue_comment: p => p.comment?.created_at,
    pull_request_review_comment: p => p.comment?.created_at,
    pull_request_review: p => p.review?.submitted_at,
    issues: p => p.issue?.updated_at,
    pull_request: p => p.pull_request?.updated_at,
  };

/**
 * Get the trigger command for stripping from comments.
 *
 * Lazily retrieves the trigger input to avoid module-level evaluation issues.
 *
 * @returns The trigger string (default '/pi' if not specified).
 */
function getTrigger(): string {
  return getCoreAdapter().getInput('trigger') || DEFAULT_TRIGGER;
}

/**
 * Extract the start timestamp from the GitHub event payload.
 *
 * Uses the timestamp of the triggering event to measure the total time from
 * user action to completion.
 *
 * @returns The start instant, or `undefined` if it cannot be determined.
 */
export function getStartTimeFromContext(): Temporal.Instant | undefined {
  const { eventName, payload } = github.context;

  // Record-based dispatch: event name → timestamp field extractor
  const extractor = TIMESTAMP_SOURCES[eventName];
  if (!extractor) {
    debug(`[getStartTimeFromContext] No timestamp source for event type: ${eventName}`);
    return undefined;
  }

  const timestamp = extractor(payload);
  if (!timestamp) {
    return undefined;
  }

  return Temporal.Instant.from(timestamp);
}

export interface IssueOrPullRequestContext {
  title: string;
  body?: string;
  number: number;
}

export interface ThreadComment {
  id: number;
  author: string;
  author_type: 'user' | 'bot';
  created_at: string;
  updated_at?: string;
  body: string;
  is_triggering_comment?: boolean; // marks the comment that invoked /pi
}

export interface IssueOrPRThread {
  number: number;
  title: string;
  body: string | null | undefined;
  state: 'open' | 'closed' | 'merged';
  author: string;
  author_type: 'user' | 'bot';
  created_at: string | null | undefined;
  updated_at: string | null | undefined;
  closed_at: string | null | undefined;
  merged_at: string | null | undefined; // PR only
  labels: string[];
  // PR-specific fields
  is_pull_request: boolean;
  head_branch: string | undefined; // PR only
  base_branch: string | undefined; // PR only
  head_sha: string | undefined; // PR only
  // Comments
  comments: ThreadComment[];
  // Cancellation flag
  cancelled?: boolean;
}

export interface GetIssueOrPRThreadParams {
  owner?: string;
  repo?: string;
  issue_number?: number;
  max_comments?: number;
}

// Re-export context utility functions for backward compatibility
export { isPR, getContextType };

/**
 * Extracts an {@link IssueOrPullRequestContext} from a GitHub event payload
 * keyed by context type ('issue' or 'pull_request').
 */
const CONTEXT_EXTRACTORS: Record<
  'issue' | 'pull_request',
  (payload: typeof github.context.payload) => IssueOrPullRequestContext | undefined
> = {
  issue: payload => {
    const issue = payload.issue;
    if (!issue?.title) {
      return undefined;
    }
    return {
      title: issue.title,
      number: issue.number,
      ...(issue.body !== undefined ? { body: issue.body } : {}),
    };
  },
  pull_request: payload => {
    const pr = payload.pull_request;
    if (!pr?.title) {
      return undefined;
    }
    return {
      title: pr.title,
      number: pr.number,
      ...(pr.body !== undefined ? { body: pr.body } : {}),
    };
  },
};

export function getIssueOrPullRequestContext(): IssueOrPullRequestContext | undefined {
  const contextType = getContextType();
  if (!contextType) {
    return undefined;
  }

  const extractor = CONTEXT_EXTRACTORS[contextType];
  if (!extractor) {
    return undefined;
  }

  return extractor(github.context.payload);
}

/**
 * Enrich a prompt string with issue/PR context when available.
 *
 * @param instruction - The raw instruction text.
 * @param label - Label for the instruction section (e.g. "Comment/Instruction" or "Instruction").
 * @returns The enriched prompt, or the original instruction if no context is available.
 */
function enrichWithContext(instruction: string, label: string): string {
  const issueOrPrContext = getIssueOrPullRequestContext();
  if (issueOrPrContext) {
    const { title, body, number } = issueOrPrContext;
    const contextParts: string[] = [`Issue/PR #${number}: ${title}`];

    if (body) {
      contextParts.push(`\nDescription:\n${body}`);
    }

    contextParts.push(`\n\n${label}:\n${instruction}`);
    return contextParts.join('');
  }

  return instruction;
}

/**
 * Build the full prompt that will be sent to the Pi agent.
 *
 * First checks for a `prompt` action input. If provided, it is used as-is
 * (no trigger stripping). If not provided, falls back to extracting the prompt
 * from the triggering comment.
 *
 * In both cases, if an issue/PR is available in the current context, its title
 * and description are prepended for additional context.
 *
 * @returns The assembled prompt string, or `undefined` if no prompt source was
 *          found.
 */
export async function getPrompt(promptInput?: string): Promise<string | undefined> {
  // Prefer explicit prompt input over comment-based extraction
  if (promptInput) {
    const trimmed = promptInput.trim();
    if (!trimmed) {
      getCoreAdapter().notice('prompt input is empty, skipping');
      return undefined;
    }
    return enrichWithContext(trimmed, 'Instruction');
  }

  // Fall back to comment-based prompt
  const comment = await getComment();
  if (!comment) {
    getCoreAdapter().notice('no comment found in context, skipping');
    return undefined;
  }

  const prompt = comment.body;
  if (!prompt) {
    getCoreAdapter().notice('no prompt found in comment, skipping');
    return undefined;
  }

  return enrichWithContext(prompt, 'Comment/Instruction');
}

/**
 * Minimal shape returned by {@link getComment}.
 *
 * Covers both `payload.comment` (issue_comment, pull_request_review_comment)
 * and `payload.review` (pull_request_review) — both carry `id` and `body`.
 */
interface TriggeringComment {
  id: number;
  body: string;
}

async function getComment(): Promise<TriggeringComment | undefined> {
  const comment = github.context.payload.comment;
  const review = github.context.payload.review;

  // For pull_request_review events, the body is on the review object, not comment
  if (!comment && review) {
    if (!review.body) {
      return;
    }

    const body = (review.body as string).replace(getTrigger(), '').trim();
    return { id: review.id, body };
  }

  if (!comment) {
    return;
  }

  const body = comment.body.replace(getTrigger(), '').trim();
  return { id: comment.id, body };
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
  comments?: ThreadComment[]
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
  };
}

/**
 * Fetch the complete thread (metadata + comments) for a GitHub issue or PR.
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

    const comments = await fetchThreadComments(owner, repo, issueNumber, maxComments);

    return buildThreadResult(issue, isPullRequest, prData, comments);
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404) {
      debug(`[getIssueOrPRThread] Issue/PR #${issueNumber} not found`);
      return undefined;
    }
    throw error;
  }
}

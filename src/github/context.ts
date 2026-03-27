/**
 * @file GitHub context extraction and issue/PR thread retrieval.
 *
 * Reads the current GitHub Actions context (issue, pull request, or comment)
 * and provides helpers to build the prompt sent to the Pi agent, as well as a
 * richer `getIssueOrPRThread` function used by the `get_issue_or_pr_thread` tool.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { Temporal } from '@js-temporal/polyfill';
import { getOctokit } from './octokit.js';
import { DEFAULT_TRIGGER, MAX_COMMENTS } from './constants.js';

/**
 * Extract the start timestamp from the GitHub event payload.
 *
 * Uses the timestamp of the triggering event (comment creation, issue opening,
 * or PR opening) to measure the total time from user action to completion.
 *
 * @returns The start instant, or `undefined` if it cannot be determined.
 */
export function getStartTimeFromContext(): Temporal.Instant | undefined {
  const { eventName, payload } = github.context;

  // For issue_comment events, use the comment's created_at timestamp
  if (eventName === 'issue_comment' && payload.comment?.created_at) {
    return Temporal.Instant.from(payload.comment.created_at);
  }

  // For issues events (opened/edited), use the issue's created_at timestamp
  if (eventName === 'issues' && payload.issue?.created_at) {
    return Temporal.Instant.from(payload.issue.created_at);
  }

  // For pull_request events, use the PR's created_at timestamp
  if (eventName === 'pull_request' && payload.pull_request?.created_at) {
    return Temporal.Instant.from(payload.pull_request.created_at);
  }

  core.debug(
    `[getStartTimeFromContext] Could not determine start time from event type: ${eventName}`
  );
  return undefined;
}

const trigger = core.getInput('trigger') || DEFAULT_TRIGGER;
const octokit = getOctokit();

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
}

export interface GetIssueOrPRThreadParams {
  owner?: string;
  repo?: string;
  issue_number?: number;
  max_comments?: number;
}

/**
 * Determine if the current GitHub context is a pull request.
 *
 * @returns `true` if the event type is `pull_request` or the payload contains a
 *          `pull_request` object.
 */
export function isPR(): boolean {
  const eventType = github.context.eventName;
  return eventType === 'pull_request' || github.context.payload.pull_request !== undefined;
}

/**
 * Determine whether the current context originated from an issue or a pull
 * request.
 *
 * @returns `'issue'`, `'pull_request'`, or `undefined` if the context cannot be
 *          classified.
 */
export function getContextType(): 'issue' | 'pull_request' | undefined {
  if (isPR()) {
    return 'pull_request';
  }
  if (github.context.eventName === 'issue_comment' || github.context.eventName === 'issues') {
    return 'issue';
  }
  return undefined;
}

/**
 * Extract a lightweight context object (title, body, number) from the current
 * GitHub issue or pull request.
 *
 * @returns The context data, or `undefined` if the payload does not contain a
 *          recognised issue or PR.
 */
export function getIssueOrPullRequestContext(): IssueOrPullRequestContext | undefined {
  const contextType = getContextType();
  const payload = github.context.payload;

  if (contextType === 'issue') {
    const issue = payload.issue;
    if (issue?.title) {
      const result: IssueOrPullRequestContext = {
        title: issue.title,
        number: issue.number,
      };
      if (issue.body !== undefined) {
        result.body = issue.body;
      }
      return result;
    }
  } else if (contextType === 'pull_request') {
    const pullRequest = payload.pull_request;
    if (pullRequest?.title) {
      const result: IssueOrPullRequestContext = {
        title: pullRequest.title,
        number: pullRequest.number,
      };
      if (pullRequest.body !== undefined) {
        result.body = pullRequest.body;
      }
      return result;
    }
  }

  return undefined;
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
      core.notice('prompt input is empty, skipping');
      return undefined;
    }
    return enrichWithContext(trimmed, 'Instruction');
  }

  // Fall back to comment-based prompt
  const comment = await getComment();
  if (!comment) {
    return undefined;
  }

  const prompt = comment.body;
  if (!prompt) {
    core.notice('no prompt found in comment, skipping prompt');
    return undefined;
  }

  return enrichWithContext(prompt, 'Comment/Instruction');
}

async function getComment(): Promise<typeof github.context.payload.comment | undefined> {
  const comment = github.context.payload.comment;
  if (!comment) {
    core.notice('no comment found in context, skipping prompt');
    return;
  }

  comment.body = comment.body.replace(trigger, '').trim();

  return comment;
}

function resolveThreadParams(
  params?: GetIssueOrPRThreadParams
): { owner: string; repo: string; issueNumber: number; maxComments: number } | undefined {
  const { owner, repo, issue_number, max_comments = MAX_COMMENTS } = params ?? {};

  const resolvedOwner = owner ?? github.context.repo.owner;
  const resolvedRepo = repo ?? github.context.repo.repo;
  const resolvedIssueNumber = issue_number ?? github.context.issue.number;

  if (!resolvedOwner || !resolvedRepo || !resolvedIssueNumber) {
    core.debug('[getIssueOrPRThread] Missing owner, repo, or issue_number');
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
  issue: Awaited<ReturnType<typeof octokit.rest.issues.get>>['data'];
  isPullRequest: boolean;
}> {
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
): Promise<Awaited<ReturnType<typeof octokit.rest.pulls.get>>['data'] | undefined> {
  try {
    const prData = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: issueNumber,
    });
    return prData.data;
  } catch (_e) {
    core.debug('[getIssueOrPRThread] Failed to fetch PR data, continuing');
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
  const triggeringCommentId = github.context.payload.comment?.id;

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

function buildThreadResult(
  issue: Awaited<ReturnType<typeof octokit.rest.issues.get>>['data'],
  isPullRequest: boolean,
  prData?: Awaited<ReturnType<typeof octokit.rest.pulls.get>>['data'],
  comments?: ThreadComment[]
): IssueOrPRThread {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: (issue.state === 'closed' && prData?.merged_at ? 'merged' : issue.state) as
      | 'open'
      | 'closed'
      | 'merged',
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
      core.debug(`[getIssueOrPRThread] Issue/PR #${issueNumber} not found`);
      return undefined;
    }
    throw error;
  }
}

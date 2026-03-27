import * as core from '@actions/core';
import * as github from '@actions/github';
import { getOctokit } from './octokit.js';

const trigger = core.getInput('trigger') || '/pi';
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
 * @returns true if the event type is 'pull_request' or if the context payload contains a pull_request object
 */
export function isPR(): boolean {
  const eventType = github.context.eventName;
  return eventType === 'pull_request' || github.context.payload.pull_request !== undefined;
}

/**
 * Get the event type for the current context.
 * @returns 'issue' | 'pull_request' | undefined
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

export async function getPrompt(): Promise<string | undefined> {
  const comment = await getComment();
  if (!comment) {
    return undefined;
  }

  const prompt = comment.body;
  if (!prompt) {
    core.notice('no prompt found in comment, skipping prompt');
    return undefined;
  }

  // Fetch additional context from issue/PR
  const issueOrPrContext = getIssueOrPullRequestContext();
  if (issueOrPrContext) {
    const { title, body, number } = issueOrPrContext;
    const contextParts: string[] = [`Issue/PR #${number}: ${title}`];

    if (body) {
      contextParts.push(`\nDescription:\n${body}`);
    }

    contextParts.push(`\n\nComment/Instruction:\n${prompt}`);
    return contextParts.join('');
  }

  // Return just the comment body if no context available
  return prompt;
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
  const { owner, repo, issue_number, max_comments = 100 } = params ?? {};

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
  const perPage = Math.min(maxComments, 100);

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

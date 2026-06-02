/**
 * @file Shared type definitions for the GitHub/Codeberg/Forgejo platform module.
 *
 * Centralises all interfaces used across the github module so that individual
 * files can import types without creating circular dependencies.
 */

import type { Logger } from '../../types';
import type { PlatformContext } from '../types';

type OctokitInstance = ReturnType<typeof import('@actions/github').getOctokit>;

/**
 * Explicit dependency bag for GitHub module functions.
 *
 * Every function in `src/platform/github/` receives this as its first
 * parameter instead of reaching for singletons or `@actions/*` globals.
 * Constructed once in `createGitHubPlatformProvider` and threaded through.
 */
export interface GitHubModuleDeps {
  /** Pre-authenticated Octokit REST client. */
  readonly octokit: OctokitInstance;
  /** Platform context (repo, issue, event payload, …). */
  readonly context: PlatformContext;
  /** Logger for debug/info/warning output. */
  readonly logger: Logger;
  /**
   * The trigger command string (e.g. '/pi') used to strip invocation prefixes
   * from comment bodies. When omitted, defaults to {@link DEFAULT_TRIGGER}.
   */
  readonly trigger?: string;
  /**
   * Branch name template for generating branch names.
   * When provided, overrides the default template.
   */
  readonly branchNameTemplate?: string;
}

/**
 * Extract the Octokit type from the deps so consumers don't need to
 * import `@actions/github` just for the type.
 */
export type { OctokitInstance };


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

export interface ReviewComment {
  id: number;
  path: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT';
  author: string;
  author_type: 'user' | 'bot';
  created_at: string;
  body: string;
  in_reply_to_id?: number;
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
  // PR review comments (inline comments on the diff)
  review_comments: ReviewComment[];
  // Cancellation flag
  cancelled?: boolean;
}

export interface GetIssueOrPRThreadParams {
  owner?: string;
  repo?: string;
  issue_number?: number;
  max_comments?: number;
}

/**
 * A single inline comment anchored to a specific line of the pull request diff.
 */
export interface ReviewInlineComment {
  /** Repository-relative file path (e.g. "src/main.ts"). */
  path: string;
  /** Line number in the diff. For multi-line comments this is the **end** line. */
  line: number;
  /** Which side of the diff the line refers to: `RIGHT` = new file (default), `LEFT` = old file. */
  side?: 'LEFT' | 'RIGHT';
  /** Start line for multi-line comments. If omitted the comment covers a single line. */
  start_line?: number;
  /** Which side `start_line` refers to. Only required when `start_line` is set and differs from `side`. */
  start_side?: 'LEFT' | 'RIGHT';
  /** The Markdown body of the comment. */
  body: string;
}

/**
 * Parameters for the get_ci_status operation.
 */
export interface GetCIStatusParams {
  owner?: string;
  repo?: string;
  pull_number?: number;
  /** Git ref (SHA or branch) to check. Alternative to pull_number. */
  ref?: string;
  /** Filter by status: queued, in_progress, completed. */
  status?: string;
  /** Filter by conclusion: success, failure, cancelled, timed_out, etc. */
  conclusion?: string;
}

/**
 * A single check run result.
 */
export interface CheckRunResult {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string | null;
  details_url: string | null;
}

/**
 * A single workflow run result.
 */
export interface WorkflowRunResult {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  html_url: string;
  head_branch: string;
  head_sha: string;
  event: string;
}

/**
 * Details returned by the get_ci_status tool.
 */
export interface GetCIStatusDetails {
  ref: string;
  check_runs: CheckRunResult[];
  workflow_runs: WorkflowRunResult[];
  cancelled?: boolean;
}

/**
 * Parameters for the get_workflow_run_logs operation.
 */
export interface GetWorkflowRunLogsParams {
  owner?: string;
  repo?: string;
  /** The workflow run ID to fetch logs for. */
  run_id: number;
  /** Maximum total log bytes to return. Defaults to 51200 (50KB). */
  max_bytes?: number;
}

/**
 * Log output for a single job.
 */
export interface JobLog {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  log: string;
  truncated: boolean;
}

/**
 * Details returned by the get_workflow_run_logs tool.
 */
export interface GetWorkflowRunLogsDetails {
  run_id: number;
  jobs: JobLog[];
  total_bytes: number;
  truncated: boolean;
  cancelled?: boolean;
}

export interface CreateReviewParams {
  /** Pull request number. If omitted the current PR from context is used. */
  pull_number?: number;
  /** Summary comment for the review (shown at the top of the review). */
  body?: string;
  /** Review event: COMMENT (default), APPROVE, or REQUEST_CHANGES. */
  event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
  /** Inline comments anchored to specific diff lines. At least one is required. */
  comments: ReviewInlineComment[];
}

/**
 * Structured details returned after a review is created.
 */
export interface CreateReviewDetails {
  /** The ID of the created review. */
  reviewId: number;
  /** The HTML URL of the review. */
  reviewUrl: string;
  /** The pull request number the review was created on. */
  pullRequestNumber: number;
  /** The review event type. */
  event: string;
  /** Number of inline comments created. */
  commentCount: number;
  /** Whether the operation was cancelled. */
  cancelled?: boolean;
}

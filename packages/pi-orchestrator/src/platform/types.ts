/**
 * @file Platform abstraction types for multi-platform support.
 *
 * Defines interfaces that abstract platform-specific operations (context
 * extraction, API client creation) to support GitHub, Codeberg, and
 * self-hosted Forgejo instances.
 *
 * All three platforms use GitHub-compatible REST APIs, so the abstraction
 * focuses on context extraction and API endpoint configuration rather than
 * full API abstraction.
 */

import type { Temporal } from '@js-temporal/polyfill';
import type { CommentMetadata } from '../types';

/**
 * Platform identifiers supported by this action.
 */
export type PlatformType = 'github' | 'codeberg' | 'forgejo';

/**
 * Platform-agnostic context information extracted from the CI/CD environment.
 *
 * Abstracts the event payload, repository info, and other context needed
 * by the action, regardless of which platform (GitHub, Codeberg, Forgejo)
 * triggered the workflow.
 */
export interface PlatformContext {
  /** Repository owner and name */
  repo: { owner: string; repo: string };
  /** Current issue or PR number */
  issue: { number: number };
  /** The event that triggered the workflow */
  eventName: string;
  /** The full event payload */
  payload: Record<string, unknown>;
  /** The server URL (e.g. https://github.com, https://codeberg.org) */
  serverUrl: string;
  /**
   * The current workflow run ID.
   *
   * Optional so non-CI frontends can omit it.
   * `buildActionRunUrl()` returns `undefined` when `runId` is missing,
   * which suppresses the "View action run" footer on posted comments.
   */
  runId?: number;
  /**
   * The current workflow run NUMBER (the per-repo sequence, read from
   * `GITHUB_RUN_NUMBER`).
   *
   * This is distinct from {@link runId}, which is the global DB id.
   * Forgejo/Codeberg serve an action run at `…/actions/runs/{runNumber}`
   * — using `runId` there produces a 404 — so `buildActionRunUrl()` reads
   * this field for the Forgejo/Codeberg URL. GitHub itself uses `runId` in
   * its URLs and ignores this field.
   *
   * Optional so non-CI frontends (e.g. the CLI) can omit it.
   */
  runNumber?: number;
  /** The workspace directory path */
  workspace: string;
  /** The user/actor who triggered the workflow (e.g. for Co-authored-by trailers). */
  actor?: string;
  /** The commit SHA of the triggering event. */
  sha?: string;
}

// ---------------------------------------------------------------------------
// Shared data types used across platform implementations and consumers.
// Platform-specific packages (pi-platform-github) import these rather than
// defining their own copies.
// ---------------------------------------------------------------------------

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

export interface CreatePullRequestParams {
  title: string;
  body?: string;
  base?: string;
  dryRun?: boolean;
}

export interface CreatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  dryRun: boolean;
  cancelled?: boolean;
}

export interface UpdatePullRequestParams {
  pull_number?: number;
  title?: string;
  body?: string;
  message?: string;
  dryRun?: boolean;
}

export interface UpdatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  commitSha?: string;
  titleUpdated?: boolean;
  bodyUpdated?: boolean;
  dryRun: boolean;
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

// ---------------------------------------------------------------------------
// Platform provider interface
// ---------------------------------------------------------------------------

/**
 * Opaque handle returned by {@link PlatformProvider.addReaction}.
 *
 * Platform implementations define their own concrete type internally.
 * The orchestrator treats this as an opaque token passed between
 * `addReaction()` and `deleteReaction()`.
 */
export type CreateReactionType = unknown;

/**
 * Platform provider interface for multi-platform support.
 *
 * Encapsulates all platform-specific operations needed by the action.
 * Each supported platform (GitHub, Codeberg, Forgejo) provides its own
 * implementation.
 *
 * The provider is responsible for:
 * - Detecting which platform the action is running on
 * - Extracting context from the platform's CI/CD environment
 * - Creating authenticated API clients for the platform
 * - Providing platform-specific implementations of common operations
 */
export interface PlatformProvider {
  /** The detected platform type */
  readonly type: PlatformType;

  /**
   * Get the platform context (repo info, event payload, etc.).
   *
   * Extracts context from the platform's CI/CD environment variables
   * and event payload.
   */
  getContext(): PlatformContext;

  /**
   * Add an "eyes" reaction to the triggering comment.
   *
   * @returns The reaction response, or undefined if no comment is present.
   */
  addReaction(): Promise<CreateReactionType | undefined>;

  /**
   * Remove a previously added reaction.
   *
   * @param reaction - The reaction to remove.
   */
  deleteReaction(reaction: CreateReactionType | undefined): Promise<void>;

  /**
   * Create the final comment with optional metadata footer.
   *
   * @param body - The comment body.
   * @param metadata - Optional metadata to include in the footer.
   */
  createFinalComment(body: string, metadata: CommentMetadata): Promise<void>;

  /**
   * Get the prompt from input or comment context.
   *
   * @param inputPrompt - Optional prompt input override.
   * @returns The prompt string, or undefined if no prompt is available.
   */
  getPrompt(inputPrompt?: string): Promise<string | undefined>;

  /**
   * Get the start time from the platform event payload.
   *
   * @returns The start instant, or undefined if unavailable.
   */
  getStartTime(): Temporal.Instant | undefined;

  /**
   * Create a pull request.
   *
   * @param params - Pull request creation parameters.
   * @returns The result of the PR creation.
   */
  createPullRequest(
    params: CreatePullRequestParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: CreatePullRequestDetails }>;

  /**
   * Update an existing pull request.
   *
   * @param params - Pull request update parameters.
   * @returns The result of the PR update.
   */
  updatePullRequest(
    params: UpdatePullRequestParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: UpdatePullRequestDetails }>;

  /**
   * Fetch the complete thread for an issue or pull request.
   *
   * For pull requests, the thread includes inline review comments
   * (comments on specific lines of the diff) in addition to issue-level comments.
   *
   * @param params - Optional parameters to override defaults.
   * @returns The thread data, or undefined if not found.
   */
  getIssueOrPRThread(params?: GetIssueOrPRThreadParams): Promise<IssueOrPRThread | undefined>;

  /**
   * Fetch the diff for a pull request.
   *
   * @param owner - Repository owner.
   * @param repo - Repository name.
   * @param pullNumber - Pull request number.
   * @param ignoreFiles - Optional list of file paths to exclude from the diff.
   *                      Supports exact paths (e.g. "dist/bundle.js") and prefix
   *                      matching (e.g. "dist/" excludes everything under dist/).
   *                      Matching is literal — glob patterns are NOT supported.
   * @returns The diff string, or empty string if unavailable.
   */
  getPRDiff(
    owner: string,
    repo: string,
    pullNumber: number,
    ignoreFiles?: string[]
  ): Promise<string>;

  /**
   * Create a pull request review with inline comments anchored to diff lines.
   *
   * Uses the GitHub `pulls.createReview` API with the modern `line`/`side`
   * positioning for each comment.
   *
   * @param params - Review creation parameters including inline comments.
   * @returns The tool result containing a human-readable message and structured details.
   */
  createReview(
    params: CreateReviewParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: CreateReviewDetails }>;

  /**
   * Get CI status for a ref or pull request.
   *
   * Fetches check runs and workflow runs for the resolved commit SHA.
   * For pull requests, the head SHA is resolved automatically.
   *
   * @param params - Parameters for the CI status query.
   * @returns Structured details about CI check runs and workflow runs.
   */
  getCIStatus(
    params: GetCIStatusParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: GetCIStatusDetails }>;

  /**
   * Get logs for a specific workflow run.
   *
   * Lists all jobs for the run and downloads their logs, truncated
   * to the specified byte limit.
   *
   * @param params - Parameters including the run ID and optional byte limit.
   * @returns Structured details about the workflow run logs.
   */
  getWorkflowRunLogs(
    params: GetWorkflowRunLogsParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: GetWorkflowRunLogsDetails }>;
}

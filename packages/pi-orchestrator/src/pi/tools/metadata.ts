/**
 * @file Shared tool metadata and output schemas for the pi orchestration APIs.
 *
 * Leverages the pi-coding-agent 0.99.x tool orchestration APIs:
 *
 * - `namespace` — groups all action tools under one codemode-listed namespace
 *   with shared usage instructions (readable by scripts via `describeNamespace()`).
 * - `annotations` — MCP-style hints (`readOnlyHint`, `destructiveHint`,
 *   `openWorldHint`) that permission extensions can use to gate tool calls
 *   declaratively instead of by name.
 * - `outputSchema` / `structuredContent` — machine-readable results for
 *   programmatic callers (codemode scripts receive `structuredContent` instead
 *   of the model-facing text content).
 */

import { Type } from 'typebox';
import type { ToolAnnotations, ToolNamespace } from '@earendil-works/pi-coding-agent';
import type { JsonValue } from '@earendil-works/pi-ai';
import { nullable } from './schema';

// ---------------------------------------------------------------------------
// Namespace
// ---------------------------------------------------------------------------

/** Shared namespace all action tools register under. */
export const PI_ACTION_NAMESPACE: ToolNamespace = {
  name: 'pi_action',
  description: 'Pull request, CI, and review operations for the current repository',
  instructions: [
    'Tools in this namespace operate on the repository and issue/PR context of the current run.',
    'owner/repo/pull_number parameters are optional: they default to the repository and issue or PR from the platform context.',
    'Read-only tools (get_ci_status, get_pr_diff, get_issue_or_pr_thread, get_workflow_run_logs, parse_actions_url, summarize_text) never modify remote state.',
    'Mutating tools (create_pull_request, update_pull_request, create_pull_request_review) push commits or post content to the platform.',
  ].join(' '),
};

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

/** Annotations for tools that only read remote state or compute summaries. */
export const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  openWorldHint: true,
};

/** Annotations for tools that push commits or post content to the platform. */
export const MUTATING_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};

// ---------------------------------------------------------------------------
// Output schemas (structuredContent) for the read-only tools
// ---------------------------------------------------------------------------

/** Schema entries mirrored from `CheckRunResult` (platform/types.ts). */
export const checkRunSchema = Type.Object(
  {
    id: Type.Number(),
    name: Type.String(),
    status: Type.String(),
    conclusion: nullable(Type.String()),
    started_at: nullable(Type.String()),
    completed_at: nullable(Type.String()),
    html_url: nullable(Type.String()),
    details_url: nullable(Type.String()),
  },
  { additionalProperties: false }
);

/** Schema entries mirrored from `WorkflowRunResult` (platform/types.ts). */
export const workflowRunSchema = Type.Object(
  {
    id: Type.Number(),
    name: Type.String(),
    status: Type.String(),
    conclusion: nullable(Type.String()),
    started_at: nullable(Type.String()),
    html_url: Type.String(),
    head_branch: Type.String(),
    head_sha: Type.String(),
    event: Type.String(),
  },
  { additionalProperties: false }
);

/** Schema entries mirrored from `JobLog` (platform/types.ts). */
export const jobLogSchema = Type.Object(
  {
    id: Type.Number(),
    name: Type.String(),
    status: Type.String(),
    conclusion: nullable(Type.String()),
    started_at: nullable(Type.String()),
    completed_at: nullable(Type.String()),
    log: Type.String(),
    truncated: Type.Boolean(),
  },
  { additionalProperties: false }
);

/** `outputSchema` for get_ci_status — mirrors `GetCIStatusDetails`. */
export const ciStatusOutputSchema = Type.Object(
  {
    ref: Type.String(),
    check_runs: Type.Array(checkRunSchema),
    workflow_runs: Type.Array(workflowRunSchema),
    cancelled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

/** `outputSchema` for get_workflow_run_logs — mirrors `GetWorkflowRunLogsDetails`. */
export const workflowRunLogsOutputSchema = Type.Object(
  {
    run_id: Type.Number(),
    jobs: Type.Array(jobLogSchema),
    total_bytes: Type.Number(),
    truncated: Type.Boolean(),
    cancelled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

/** `outputSchema` for the local-only parse_actions_url tool. */
export const parseActionsUrlOutputSchema = Type.Object(
  {
    owner: Type.String(),
    repo: Type.String(),
    run_id: Type.Number(),
    job_id: nullable(Type.Number()),
    cancelled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

/** Schema entries mirrored from `ThreadComment` (platform/types.ts). */
const threadCommentSchema = Type.Object(
  {
    id: Type.Number(),
    author: Type.String(),
    author_type: Type.Union([Type.Literal('user'), Type.Literal('bot')]),
    created_at: Type.String(),
    updated_at: Type.Optional(Type.String()),
    body: Type.String(),
    is_triggering_comment: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

/** Schema entries mirrored from `ReviewComment` (platform/types.ts). */
const reviewCommentSchema = Type.Object(
  {
    id: Type.Number(),
    path: Type.String(),
    line: nullable(Type.Number()),
    side: Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')]),
    author: Type.String(),
    author_type: Type.Union([Type.Literal('user'), Type.Literal('bot')]),
    created_at: Type.String(),
    body: Type.String(),
    in_reply_to_id: Type.Optional(Type.Number()),
  },
  { additionalProperties: false }
);

/** `outputSchema` for get_issue_or_pr_thread — mirrors `IssueOrPRThread`. */
export const threadOutputSchema = Type.Object(
  {
    number: Type.Number(),
    title: Type.String(),
    body: nullable(Type.String()),
    state: Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('merged')]),
    author: Type.String(),
    author_type: Type.Union([Type.Literal('user'), Type.Literal('bot')]),
    created_at: nullable(Type.String()),
    updated_at: nullable(Type.String()),
    closed_at: nullable(Type.String()),
    merged_at: nullable(Type.String()),
    labels: Type.Array(Type.String()),
    is_pull_request: Type.Boolean(),
    head_branch: nullable(Type.String()),
    base_branch: nullable(Type.String()),
    head_sha: nullable(Type.String()),
    comments: Type.Array(threadCommentSchema),
    review_comments: Type.Array(reviewCommentSchema),
    cancelled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

/** `outputSchema` for get_pr_diff — details metadata plus the truncated diff text. */
export const prDiffOutputSchema = Type.Object(
  {
    pull_number: Type.Number(),
    lines: Type.Number(),
    truncated: Type.Boolean(),
    truncated_reason: Type.Optional(Type.Union([Type.Literal('bytes'), Type.Literal('lines')])),
    ignored_files: Type.Optional(Type.Array(Type.String())),
    diff: Type.String(),
    cancelled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

/** `outputSchema` for summarize_text — mirrors `SummarizeTextDetails`. */
export const summarizeOutputSchema = Type.Object(
  {
    summary: Type.String(),
    model: Type.String(),
    input_chars: Type.Number(),
    cancelled: Type.Optional(Type.Boolean()),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);

/** `outputSchema` for diagnose_ci_failure — mirrors `DiagnoseCIFailureDetails`. */
export const diagnoseOutputSchema = Type.Object(
  {
    ref: Type.String(),
    failed_checks: Type.Number(),
    failed_runs: Type.Number(),
    run_id: Type.Optional(Type.Number()),
    summarized: Type.Boolean(),
    summary: Type.String(),
    error: Type.Optional(Type.String()),
    cancelled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a details object into a JSON value safe for `structuredContent`.
 *
 * A JSON round-trip drops `undefined` fields (which are not valid `JsonValue`)
 * so the result always satisfies the SDK's `structuredContent` contract,
 * including under `exactOptionalPropertyTypes`.
 */
export function toStructuredContent(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonValue;
}

/**
 * @file Pi coding agent tools – main barrel export.
 *
 * Re-exports every public symbol from the package so consumers can import
 * from a single entry point:
 *
 * ```typescript
 * import {
 *   createToolsFactory,
 *   type ToolProvider,
 *   withCancellation,
 *   formatThreadAsText,
 * } from 'pi-coding-agent-tools';
 * ```
 */

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  ToolProvider,
  CreatePullRequestParams,
  CreatePullRequestDetails,
  UpdatePullRequestParams,
  UpdatePullRequestDetails,
  GetIssueOrPRThreadParams,
  IssueOrPRThread,
  ThreadComment,
} from './types';

// ─── Tool factory aggregator ────────────────────────────────────────────────
export { createToolsFactory } from './tools';

// ─── Individual tool factories ──────────────────────────────────────────────
export { createPRToolFactory } from './create-pr';
export { updatePullRequestToolFactory } from './update-pr';
export { getIssueOrPRThreadToolFactory } from './get-thread';

// ─── Utilities ──────────────────────────────────────────────────────────────
export {
  withCancellation,
  createCancellationResult,
  buildParams,
  type ToolExecutionConfig,
  type CancellationResult,
} from './tool-execution';

export { formatThreadAsText } from './common';

// ─── Constants ──────────────────────────────────────────────────────────────
export {
  CANCELLATION_MESSAGE_CREATE_PR,
  CANCELLATION_MESSAGE_GET_THREAD,
  CANCELLATION_MESSAGE_UPDATE_PR,
} from './constants';

// ─── Prompt strings ─────────────────────────────────────────────────────────
export {
  CREATE_PULL_REQUEST_PROMPT_SNIPPET,
  CREATE_PULL_REQUEST_PROMPT_GUIDELINES,
  CREATE_PULL_REQUEST_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_BASE_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PROMPT_SNIPPET,
  GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES,
  GET_ISSUE_PR_THREAD_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_OWNER_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_REPO_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_ISSUE_NUMBER_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_MAX_COMMENTS_DESCRIPTION,
  UPDATE_PULL_REQUEST_PROMPT_SNIPPET,
  UPDATE_PULL_REQUEST_PROMPT_GUIDELINES,
  UPDATE_PULL_REQUEST_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_PULL_NUMBER_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_MESSAGE_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
} from './prompt';

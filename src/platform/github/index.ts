/**
 * @file GitHub/Codeberg/Forgejo module barrel export.
 *
 * Re-exports public symbols used by consumers outside the github/ module.
 * Internal implementation details are not exported from this barrel file.
 *
 * Supports GitHub, Codeberg, and self-hosted Forgejo instances.
 */

// Context extraction functions (used by run.ts)
export {
  getPrompt,
  getStartTimeFromContext,
  getIssueOrPullRequestContext,
  isPR,
  getContextType,
} from './context';

// Shared types
export {
  type GitHubModuleDeps,
  type IssueOrPRThread,
  type IssueOrPullRequestContext,
  type ThreadComment,
  type ReviewComment,
  type GetIssueOrPRThreadParams,
} from './types';

// Reaction management functions (used by run.ts)
export { addReaction, deleteReaction, type CreateReactionType } from './reactions';

// Comment creation functions (used by run.ts)
export { createFinalComment } from './comments';

// Tool implementations (used by git-adapter and provider)
export {
  createPullRequest,
  type CreatePullRequestParams,
  type CreatePullRequestDetails,
} from './tools/pull-request';

export {
  updatePullRequest,
  type UpdatePullRequestParams,
  type UpdatePullRequestDetails,
} from './tools/pull-request-update';

export {
  createReview,
  validateCreateReviewParams,
  type CreateReviewParams,
  type CreateReviewDetails,
  type ReviewInlineComment,
} from './tools/review';

// Thread and diff fetching (used by provider and tools)
export { getIssueOrPRThread } from './tools/thread';
export { fetchPRDiff } from './tools/pr-diff';

// CI/CD status
export {
  getCIStatus,
  type GetCIStatusParams,
  type GetCIStatusDetails,
  type CheckRunResult,
  type WorkflowRunResult,
} from './tools/get-ci-status';

// Workflow run logs
export {
  getWorkflowRunLogs,
  type GetWorkflowRunLogsParams,
  type GetWorkflowRunLogsDetails,
  type JobLog,
} from './tools/get-workflow-run-logs';

// Platform provider (used by platform/index.ts)
export { detectPlatform, createGitHubPlatformProvider, type GitHubPlatformDeps } from './provider';

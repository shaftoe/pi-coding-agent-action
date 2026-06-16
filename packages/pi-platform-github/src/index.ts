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
  type ReviewInlineComment,
  type CreatePullRequestParams,
  type CreatePullRequestDetails,
  type UpdatePullRequestParams,
  type UpdatePullRequestDetails,
  type CreateReviewParams,
  type CreateReviewDetails,
  type GetCIStatusParams,
  type CheckRunResult,
  type WorkflowRunResult,
  type GetCIStatusDetails,
  type GetWorkflowRunLogsParams,
  type JobLog,
  type GetWorkflowRunLogsDetails,
} from './types';

// Reaction management functions (used by run.ts)
export {
  addReaction,
  deleteReaction,
  type GitHubReactionType,
  type DeleteReactionType,
} from './reactions';

// Comment creation functions (used by run.ts)
export { createFinalComment, formatExecutionTime, formatNumber } from './comments';

// Tool implementations (used by git-adapter and provider)
export {
  createPullRequest,
  determineBaseBranch,
  generateBranchName,
  generatePullRequestBody,
  slugify,
  validateCreatePullRequestParams,
  validateBranchName,
  findInvalidRefPattern,
  buildCreateDryRunMessage,
  buildCreateDryRunResult,
  buildCreateSuccessMessage,
  buildCreateSuccessResult,
  formatCreateError,
} from './tools/pull-request';

export {
  updatePullRequest,
  validateUpdatePullRequestParams,
  resolvePullRequestNumber,
  fetchPullRequestData,
  buildDryRunReport,
  formatChangeSummary,
  generateCommitMessage,
  buildSuccessReport,
  buildSuccessDetails,
  applyCommit,
  applyMetadataUpdate,
  logUpdateDebugStart,
  logPRFoundDebug,
} from './tools/pull-request-update';

export {
  createReview,
  validateCreateReviewParams,
  validateReviewComment,
  validateReviewEvent,
  toGitHubComment,
} from './tools/review';

// Thread and diff fetching (used by provider and tools)
export { getIssueOrPRThread, mapReviewComment } from './tools/thread';
export { fetchPRDiff, matchesIgnorePattern, filterDiffByIgnoreFiles } from './tools/pr-diff';

// CI/CD status
export { getCIStatus, buildCIStatusSummary } from './tools/get-ci-status';

// CI utils
export { getStatusIcon } from './tools/ci-utils';

// Workflow run logs
export { getWorkflowRunLogs } from './tools/get-workflow-run-logs';

// Git operations (used by tools internally)
export {
  createBlobsAndTree,
  createCommitAndUpdateBranch,
  appendCoAuthoredBy,
  buildFileMap,
  scanForChanges,
  scanDirectory,
  createLogger,
} from './git';

export type {
  CreateBlobsAndTreeParams,
  CreateCommitAndUpdateBranchParams,
  FileMode,
  TreeEntry,
  ChangeScanResult,
  ScanDirectoryParams,
} from './git';

// Platform provider (used by platform/index.ts)
export {
  detectPlatform,
  apiBaseUrlFromServerUrl,
  isKnownServerUrl,
  createGitHubPlatformProvider,
  type GitHubPlatformDeps,
} from './provider';

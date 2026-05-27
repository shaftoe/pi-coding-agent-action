/**
 * @file GitHub tool implementations barrel export.
 *
 * Re-exports the platform-specific implementations that back the Pi agent
 * custom tools (`create_pull_request`, `update_pull_request`,
 * `get_issue_or_pr_thread`, `get_pr_diff`, `create_pull_request_review`,
 * `get_ci_status`, `get_workflow_run_logs`).
 */

// Pull request creation
export {
  createPullRequest,
  determineBaseBranch,
  generatePullRequestBody,
  validateCreatePullRequestParams,
  type CreatePullRequestParams,
  type CreatePullRequestResult,
  type CreatePullRequestDetails,
} from './pull-request';

// Pull request update
export {
  updatePullRequest,
  validateUpdatePullRequestParams,
  type UpdatePullRequestParams,
  type UpdatePullRequestResult,
  type UpdatePullRequestDetails,
} from './pull-request-update';

// Issue/PR thread fetching
export { getIssueOrPRThread } from './thread';

// PR diff fetching
export { fetchPRDiff } from './pr-diff';

// Pull request review with inline comments
export {
  createReview,
  validateCreateReviewParams,
  type CreateReviewParams,
  type CreateReviewDetails,
  type ReviewInlineComment,
} from './review';

// CI/CD status
export {
  getCIStatus,
  type GetCIStatusParams,
  type GetCIStatusDetails,
  type CheckRunResult,
  type WorkflowRunResult,
} from './get-ci-status';

// Workflow run logs
export {
  getWorkflowRunLogs,
  type GetWorkflowRunLogsParams,
  type GetWorkflowRunLogsDetails,
  type JobLog,
} from './get-workflow-run-logs';

// Shared CI utilities
export { getStatusIcon } from './ci-utils';

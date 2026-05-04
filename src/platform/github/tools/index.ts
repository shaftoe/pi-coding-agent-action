/**
 * @file GitHub tool implementations barrel export.
 *
 * Re-exports the platform-specific implementations that back the Pi agent
 * custom tools (`create_pull_request`, `update_pull_request`,
 * `get_issue_or_pr_thread`, `get_pr_diff`).
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

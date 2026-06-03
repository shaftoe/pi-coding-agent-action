/**
 * @file Platform module barrel export.
 *
 * Re-exports platform types from the orchestrator core.
 * Concrete platform implementations (GitHub, GitLab, etc.) are provided by
 * separate packages (e.g. @alexanderfortin/pi-platform-github).
 */

export {
  type PlatformType,
  type PlatformContext,
  type PlatformProvider,
  type IssueOrPullRequestContext,
  type IssueOrPRThread,
  type ThreadComment,
  type ReviewComment,
  type GetIssueOrPRThreadParams,
  type CreatePullRequestParams,
  type CreatePullRequestDetails,
  type UpdatePullRequestParams,
  type UpdatePullRequestDetails,
  type CreateReactionType,
  type CreateReviewParams,
  type CreateReviewDetails,
  type ReviewInlineComment,
  type GetCIStatusParams,
  type GetCIStatusDetails,
  type CheckRunResult,
  type WorkflowRunResult,
  type GetWorkflowRunLogsParams,
  type GetWorkflowRunLogsDetails,
  type JobLog,
} from './types';

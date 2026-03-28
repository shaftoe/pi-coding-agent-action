/**
 * @file GitHub module barrel export.
 *
 * Re-exports public symbols used by consumers outside the github/ module.
 * Internal implementation details are not exported from this barrel file.
 */

// Context extraction functions (used by run.ts)
export {
  getPrompt,
  getIssueOrPRThread,
  getStartTimeFromContext,
  type IssueOrPRThread,
} from './context.js';

// Reaction management functions (used by run.ts)
export { addReaction, deleteReaction, type CreateReactionType } from './reactions.js';

// Comment creation functions (used by run.ts)
export { createFinalComment } from './comments.js';

// Pull request creation functions (used by pi/tools/create-pr.ts)
export {
  createPullRequest,
  type CreatePullRequestParams,
  type CreatePullRequestDetails,
} from './pull-request.js';

// Pull request update functions (used by pi/tools/update-pr.ts)
export {
  updatePullRequest,
  type UpdatePullRequestParams,
  type UpdatePullRequestDetails,
} from './pull-request-update.js';

// Cancellation messages (used by pi/tools)
export {
  CANCELLATION_MESSAGE_CREATE_PR,
  CANCELLATION_MESSAGE_GET_THREAD,
  CANCELLATION_MESSAGE_UPDATE_PR,
} from './constants.js';

/**
 * @file Git utilities barrel export for the GitHub platform.
 *
 * Re-exports the logger factory and git-CLI helpers for branch/commit/push.
 */

// Logger factory
export { createLogger } from './types';

// Git CLI helpers (branch creation, commit, push — replaces Git Data API writes)
export type { CommitAndPushOptions, WorkspaceChangePaths, GitIdentityOptions } from './git-cli';
export {
  appendCoAuthoredBy,
  ensureGitIdentity,
  getNoreplyEmail,
  hasLocalChanges,
  workspaceHasChanges,
  getWorkspaceChangePaths,
  checkoutExistingBranch,
  commitAndPushBranch,
} from './git-cli';

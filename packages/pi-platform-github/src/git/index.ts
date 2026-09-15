/**
 * @file Git utilities barrel export for the GitHub platform.
 *
 * Re-exports the logger factory, git-CLI helpers for branch/commit/push,
 * and the fork-management helpers used by the fork-based PR flow.
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
  ensureRemote,
  commitAndPushBranch,
} from './git-cli';

// Fork management (fork-based pull requests)
export type { ForkInfo, WaitForForkReadyOptions } from './fork';
export {
  buildForkRemoteUrl,
  canPushToRepository,
  ensureFork,
  getAuthenticatedLogin,
  resolveForkRemoteUrl,
  waitForForkReady,
} from './fork';

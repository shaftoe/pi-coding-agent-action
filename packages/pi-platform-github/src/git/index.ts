/**
 * @file Git utilities barrel export for the GitHub platform.
 *
 * Re-exports all public APIs including the platform-agnostic scanner
 * (via the GitHub-aware wrapper), git-CLI helpers for branch/commit/push,
 * and read-only tree operations.
 */

// Types and utilities
export type { FileMode, TreeEntry } from './types';
export { createLogger } from './types';

// File scanner (GitHub-aware wrapper around shared scanner)
export type { ChangeScanResult, ScanDirectoryParams } from './file-scanner';
export { buildFileMap, scanForChanges, scanDirectory } from './file-scanner';

// Git CLI helpers (branch creation, commit, push — replaces Git Data API writes)
export type { CommitAndPushOptions, WorkspaceChangePaths } from './git-cli';
export {
  appendCoAuthoredBy,
  ensureGitIdentity,
  hasLocalChanges,
  workspaceHasChanges,
  getWorkspaceChangePaths,
  checkoutExistingBranch,
  commitAndPushBranch,
} from './git-cli';

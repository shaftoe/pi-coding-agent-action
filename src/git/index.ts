/**
 * @file Platform-agnostic git utilities barrel export.
 *
 * Re-exports all public APIs from the shared git module. This module is
 * designed to be reused by any git hosting platform implementation
 * (GitHub, GitLab, Bitbucket, etc.).
 */

// Types
export type { Logger, FileMode, TreeEntry } from './types';

// Constants
export {
  FILE_MODE_REGULAR,
  FILE_MODE_EXECUTABLE,
  FILE_MODE_DIRECTORY,
  DEFAULT_IGNORE_PATTERNS,
} from './constants';

// File scanner
export type { ChangeScanResult, ScanDirectoryParams, ScanOptions } from './file-scanner';
export { scanForChanges, scanDirectory } from './file-scanner';

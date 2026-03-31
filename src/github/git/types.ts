/**
 * @file Shared types and utilities for Git operations.
 */

import * as core from '@actions/core';
import { FILE_MODE_DIRECTORY, FILE_MODE_EXECUTABLE, FILE_MODE_REGULAR } from '../constants';

/**
 * Git file mode types
 */
export type FileMode =
  | typeof FILE_MODE_REGULAR
  | typeof FILE_MODE_EXECUTABLE
  | typeof FILE_MODE_DIRECTORY;

/**
 * Tree entry for creating Git trees.
 * Setting `sha` to `null` indicates the file should be deleted.
 */
export interface TreeEntry {
  /** Path to the file or directory */
  path: string;
  /** File mode (permissions) */
  mode: FileMode;
  /** Type of tree entry */
  type: 'blob' | 'tree';
  /** SHA of the blob/tree, or `null` to delete the file */
  sha: string | null;
}

/**
 * Create a logger with a custom emoji prefix.
 */
export function createLogger(emoji = '🔀') {
  return {
    debug: (msg: string): void => core.debug(`${emoji} ${msg}`),
    info: (msg: string): void => core.info(`${emoji} ${msg}`),
  };
}

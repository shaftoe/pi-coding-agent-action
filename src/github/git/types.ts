/**
 * @file Shared types and utilities for Git operations.
 */

import * as core from '@actions/core';
import {
  FILE_MODE_DIRECTORY,
  FILE_MODE_EXECUTABLE,
  FILE_MODE_REGULAR,
} from '../constants.js';

/**
 * Git file mode types
 */
export type FileMode =
  | typeof FILE_MODE_REGULAR
  | typeof FILE_MODE_EXECUTABLE
  | typeof FILE_MODE_DIRECTORY;

/**
 * Create a logger with a custom emoji prefix.
 */
export function createLogger(emoji = '🔀') {
  return {
    debug: (msg: string): void => core.debug(`${emoji} ${msg}`),
    info: (msg: string): void => core.info(`${emoji} ${msg}`),
  };
}

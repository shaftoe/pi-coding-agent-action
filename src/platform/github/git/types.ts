/**
 * @file Shared types and utilities for GitHub Git operations.
 *
 * Re-exports platform-agnostic types from the shared git module and
 * provides the GitHub-specific logger factory.
 */

import { getCoreAdapter } from '../index';
import type { FileMode, TreeEntry, Logger } from '../../../git/types';

// Re-export shared types so consumers within the GitHub module can import
// them from a single location.
export type { FileMode, TreeEntry, Logger };

/**
 * Create a logger with a custom emoji prefix.
 *
 * The logger lazily fetches the CoreAdapter on first call to avoid
 * initialization order issues when modules are loaded.
 */
export function createLogger(emoji = '🔀'): Logger {
  return {
    debug: (msg: string): void => getCoreAdapter().debug(`${emoji} ${msg}`),
    info: (msg: string): void => getCoreAdapter().info(`${emoji} ${msg}`),
  };
}

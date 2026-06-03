/**
 * @file Shared types and utilities for GitHub Git operations.
 *
 * Re-exports platform-agnostic types from the shared git module and
 * provides the GitHub-specific logger factory.
 */

import type { FileMode, TreeEntry, Logger } from '@alexanderfortin/pi-orchestrator';

// Re-export shared types so consumers within the GitHub module can import
// them from a single location.
export type { FileMode, TreeEntry, Logger };

/**
 * Create a logger with a custom emoji prefix.
 *
 * The logger uses the provided deps for logging output.
 */
export function createLogger(deps: { logger: Logger }, emoji = '🔀'): Logger {
  return {
    debug: (msg: string): void => deps.logger.debug(`${emoji} ${msg}`),
    info: (msg: string): void => deps.logger.info(`${emoji} ${msg}`),
    warning: (msg: string): void => deps.logger.warning(`${emoji} ${msg}`),
    notice: (msg: string): void => deps.logger.notice(`${emoji} ${msg}`),
    error: (msg: string): void => deps.logger.error(`${emoji} ${msg}`),
  };
}

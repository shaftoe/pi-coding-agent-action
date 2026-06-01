/**
 * @file Shared utility functions for GitHub context operations.
 *
 * All functions accept a {@link GitHubModuleDeps} parameter for explicit
 * dependency injection — no module-level singletons or `@actions/*` imports.
 */

import type { GitHubModuleDeps } from './types';

/**
 * Determine if the current GitHub context is a pull request.
 *
 * @param deps - Module dependencies.
 * @returns `true` if the event type is `pull_request` or the payload contains a
 *          `pull_request` object.
 */
export function isPR(deps: GitHubModuleDeps): boolean {
  const { eventName, payload } = deps.context;
  return eventName === 'pull_request' || payload.pull_request !== undefined;
}

/**
 * Determine whether the current context originated from an issue or a pull
 * request.
 *
 * @param deps - Module dependencies.
 * @returns `'issue'`, `'pull_request'`, or `undefined` if the context cannot be
 *          classified.
 */
export function getContextType(
  deps: GitHubModuleDeps
): 'issue' | 'pull_request' | undefined {
  if (isPR(deps)) {
    return 'pull_request';
  }
  if (deps.context.eventName === 'issue_comment' || deps.context.eventName === 'issues') {
    return 'issue';
  }
  return undefined;
}

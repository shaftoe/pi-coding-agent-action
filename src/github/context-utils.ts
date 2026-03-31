/**
 * @file Shared utility functions for GitHub context operations.
 */

import * as github from '@actions/github';

/**
 * Determine if the current GitHub context is a pull request.
 *
 * @returns `true` if the event type is `pull_request` or the payload contains a
 *          `pull_request` object.
 */
export function isPR(): boolean {
  const eventType = github.context.eventName;
  return eventType === 'pull_request' || github.context.payload.pull_request !== undefined;
}

/**
 * Determine whether the current context originated from an issue or a pull
 * request.
 *
 * @returns `'issue'`, `'pull_request'`, or `undefined` if the context cannot be
 *          classified.
 */
export function getContextType(): 'issue' | 'pull_request' | undefined {
  if (isPR()) {
    return 'pull_request';
  }
  if (github.context.eventName === 'issue_comment' || github.context.eventName === 'issues') {
    return 'issue';
  }
  return undefined;
}

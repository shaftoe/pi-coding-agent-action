/**
 * @file Shared utility functions for GitHub context operations.
 */

import * as github from '@actions/github';
import { getModulePlatformContext } from './index';

/**
 * Get the platform context, falling back to @actions/github singleton.
 */
function ctx(): typeof github.context {
  try {
    const pc = getModulePlatformContext();
    return pc as unknown as typeof github.context;
  } catch {
    return github.context;
  }
}

/**
 * Determine if the current GitHub context is a pull request.
 *
 * @returns `true` if the event type is `pull_request` or the payload contains a
 *          `pull_request` object.
 */
export function isPR(): boolean {
  const eventType = ctx().eventName;
  return eventType === 'pull_request' || ctx().payload.pull_request !== undefined;
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
  if (ctx().eventName === 'issue_comment' || ctx().eventName === 'issues') {
    return 'issue';
  }
  return undefined;
}

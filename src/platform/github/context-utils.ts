/**
 * @file Shared utility functions for GitHub context operations.
 */

import * as github from '@actions/github';

/**
 * Check if the pr_number input is provided.
 *
 * Reads the input directly from the environment variable to avoid
 * circular dependency issues with the module context.
 *
 * @returns The parsed pr_number, or undefined if not set or invalid.
 */
function getPrNumberInput(): number | undefined {
  const value = process.env.INPUT_PR_NUMBER;
  if (!value) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  return !isNaN(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Determine if the current GitHub context is a pull request.
 *
 * Considers the event type, payload, and whether a `pr_number` input
 * is provided (which implies a PR context for workflow_dispatch).
 *
 * @returns `true` if the event type is `pull_request`, the payload contains a
 *          `pull_request` object, or a `pr_number` input is provided.
 */
export function isPR(): boolean {
  const eventType = github.context.eventName;
  if (eventType === 'pull_request' || github.context.payload.pull_request !== undefined) {
    return true;
  }
  // If pr_number is provided, treat as PR context
  return getPrNumberInput() !== undefined;
}

/**
 * Determine whether the current context originated from an issue or a pull
 * request.
 *
 * When `pr_number` is provided, the context is always treated as a PR.
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

/**
 * @file GitHub context extraction and prompt building.
 *
 * Reads the current GitHub Actions context (issue, pull request, or comment)
 * and provides helpers to build the prompt sent to the Pi agent.
 *
 * Thread data fetching and PR diff operations live in the {@link ./tools/}
 * subpackage.
 */

import * as github from '@actions/github';
import { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_TRIGGER } from './constants';
import { isPR, getContextType } from './context-utils';
import { getCoreAdapter } from './index';
import type { IssueOrPullRequestContext } from './types';

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  getCoreAdapter().debug(msg);
}

/**
 * Maps GitHub event names to functions that extract the relevant timestamp
 * from the event payload. Each extractor returns a timestamp string suitable
 * for `Temporal.Instant.from()`, or `undefined` if unavailable.
 */
const TIMESTAMP_SOURCES: Record<string, (p: typeof github.context.payload) => string | undefined> =
  {
    issue_comment: p => p.comment?.created_at,
    pull_request_review_comment: p => p.comment?.created_at,
    pull_request_review: p => p.review?.submitted_at,
    issues: p => p.issue?.updated_at,
    pull_request: p => p.pull_request?.updated_at,
  };

/**
 * Get the trigger command for stripping from comments.
 *
 * Lazily retrieves the trigger input to avoid module-level evaluation issues.
 *
 * @returns The trigger string (default '/pi' if not specified).
 */
function getTrigger(): string {
  return getCoreAdapter().getInput('trigger') || DEFAULT_TRIGGER;
}

/**
 * Extract the start timestamp from the GitHub event payload.
 *
 * Uses the timestamp of the triggering event to measure the total time from
 * user action to completion.
 *
 * @returns The start instant, or `undefined` if it cannot be determined.
 */
export function getStartTimeFromContext(): Temporal.Instant | undefined {
  const { eventName, payload } = github.context;

  // Record-based dispatch: event name → timestamp field extractor
  const extractor = TIMESTAMP_SOURCES[eventName];
  if (!extractor) {
    debug(`[getStartTimeFromContext] No timestamp source for event type: ${eventName}`);
    return undefined;
  }

  const timestamp = extractor(payload);
  if (!timestamp) {
    return undefined;
  }

  return Temporal.Instant.from(timestamp);
}

// Re-export context utility functions for backward compatibility
export { isPR, getContextType };

// Re-export types so existing consumers can import from this module
export type { IssueOrPullRequestContext, IssueOrPRThread, ThreadComment, ReviewComment, GetIssueOrPRThreadParams } from './types';

/**
 * Extracts an {@link IssueOrPullRequestContext} from a GitHub event payload
 * keyed by context type ('issue' or 'pull_request').
 */
const CONTEXT_EXTRACTORS: Record<
  'issue' | 'pull_request',
  (payload: typeof github.context.payload) => IssueOrPullRequestContext | undefined
> = {
  issue: payload => {
    const issue = payload.issue;
    if (!issue?.title) {
      return undefined;
    }
    return {
      title: issue.title,
      number: issue.number,
      ...(issue.body !== undefined ? { body: issue.body } : {}),
    };
  },
  pull_request: payload => {
    const pr = payload.pull_request;
    if (!pr?.title) {
      return undefined;
    }
    return {
      title: pr.title,
      number: pr.number,
      ...(pr.body !== undefined ? { body: pr.body } : {}),
    };
  },
};

export function getIssueOrPullRequestContext(): IssueOrPullRequestContext | undefined {
  const contextType = getContextType();
  if (!contextType) {
    return undefined;
  }

  const extractor = CONTEXT_EXTRACTORS[contextType];
  if (!extractor) {
    return undefined;
  }

  return extractor(github.context.payload);
}

/**
 * Enrich a prompt string with issue/PR context when available.
 *
 * @param instruction - The raw instruction text.
 * @param label - Label for the instruction section (e.g. "Comment/Instruction" or "Instruction").
 * @returns The enrichied prompt, or the original instruction if no context is available.
 */
function enrichWithContext(instruction: string, label: string): string {
  const issueOrPrContext = getIssueOrPullRequestContext();
  if (issueOrPrContext) {
    const { title, body, number } = issueOrPrContext;
    const contextParts: string[] = [`Issue/PR #${number}: ${title}`];

    if (body) {
      contextParts.push(`\nDescription:\n${body}`);
    }

    contextParts.push(`\n\n${label}:\n${instruction}`);
    return contextParts.join('');
  }

  return instruction;
}

/**
 * Build the full prompt that will be sent to the Pi agent.
 *
 * First checks for a `prompt` action input. If provided, it is used as-is
 * (no trigger stripping). If not provided, falls back to extracting the prompt
 * from the triggering comment.
 *
 * In both cases, if an issue/PR is available in the current context, its title
 * and description are prepended for additional context.
 *
 * @returns The assembled prompt string, or `undefined` if no prompt source was
 *          found.
 */
export async function getPrompt(promptInput?: string): Promise<string | undefined> {
  // Prefer explicit prompt input over comment-based extraction
  if (promptInput) {
    const trimmed = promptInput.trim();
    if (!trimmed) {
      getCoreAdapter().notice('prompt input is empty, skipping');
      return undefined;
    }
    return enrichWithContext(trimmed, 'Instruction');
  }

  // Fall back to comment-based prompt
  const comment = await getComment();
  if (!comment) {
    getCoreAdapter().notice('no comment found in context, skipping');
    return undefined;
  }

  const prompt = comment.body;
  if (!prompt) {
    getCoreAdapter().notice('no prompt found in comment, skipping');
    return undefined;
  }

  return enrichWithContext(prompt, 'Comment/Instruction');
}

/**
 * Minimal shape returned by {@link getComment}.
 *
 * Covers both `payload.comment` (issue_comment, pull_request_review_comment)
 * and `payload.review` (pull_request_review) — both carry `id` and `body`.
 */
interface TriggeringComment {
  id: number;
  body: string;
}

async function getComment(): Promise<TriggeringComment | undefined> {
  const comment = github.context.payload.comment;
  const review = github.context.payload.review;

  // For pull_request_review events, the body is on the review object, not comment
  if (!comment && review) {
    if (!review.body) {
      return;
    }

    const body = (review.body as string).replace(getTrigger(), '').trim();
    return { id: review.id, body };
  }

  if (!comment) {
    return;
  }

  const body = comment.body.replace(getTrigger(), '').trim();
  return { id: comment.id, body };
}

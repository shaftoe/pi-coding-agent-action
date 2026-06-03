/**
 * @file GitHub context extraction and prompt building.
 *
 * Reads the current GitHub Actions context (issue, pull request, or comment)
 * and provides helpers to build the prompt sent to the Pi agent.
 *
 * All functions accept a {@link GitHubModuleDeps} parameter for explicit
 * dependency injection — no module-level singletons or `@actions/*` imports.
 */

import { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_TRIGGER } from './constants';
import { isPR, getContextType } from './context-utils';
import type { GitHubModuleDeps, IssueOrPullRequestContext } from './types';

/**
 * Get the trigger command for stripping from comments.
 *
 * Reads the trigger directly from the deps bag. When omitted,
 * falls back to {@link DEFAULT_TRIGGER}.
 *
 * @returns The trigger string (default '/pi' if not specified).
 */
function getTrigger(deps: GitHubModuleDeps): string {
  return deps.trigger ?? DEFAULT_TRIGGER;
}

/**
 * Maps GitHub event names to functions that extract the relevant timestamp
 * from the event payload. Each extractor returns a timestamp string suitable
 * for `Temporal.Instant.from()`, or `undefined` if unavailable.
 */
const TIMESTAMP_SOURCES: Record<string, (p: Record<string, unknown>) => string | undefined> = {
  issue_comment: p => (p.comment as { created_at?: string })?.created_at,
  pull_request_review_comment: p => (p.comment as { created_at?: string })?.created_at,
  pull_request_review: p => (p.review as { submitted_at?: string })?.submitted_at,
  issues: p => (p.issue as { updated_at?: string })?.updated_at,
  pull_request: p => (p.pull_request as { updated_at?: string })?.updated_at,
};

/**
 * Extract the start timestamp from the GitHub event payload.
 *
 * Uses the timestamp of the triggering event to measure the total time from
 * user action to completion.
 *
 * @param deps - Module dependencies.
 * @returns The start instant, or `undefined` if it cannot be determined.
 */
export function getStartTimeFromContext(deps: GitHubModuleDeps): Temporal.Instant | undefined {
  const { eventName, payload } = deps.context;

  // Record-based dispatch: event name → timestamp field extractor
  const extractor = TIMESTAMP_SOURCES[eventName];
  if (!extractor) {
    deps.logger.debug(`[getStartTimeFromContext] No timestamp source for event type: ${eventName}`);
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
export type {
  IssueOrPullRequestContext,
  IssueOrPRThread,
  ThreadComment,
  ReviewComment,
  GetIssueOrPRThreadParams,
} from './types';

/**
 * Extracts an {@link IssueOrPullRequestContext} from a GitHub event payload
 * keyed by context type ('issue' or 'pull_request').
 */
const CONTEXT_EXTRACTORS: Record<
  'issue' | 'pull_request',
  (payload: Record<string, unknown>) => IssueOrPullRequestContext | undefined
> = {
  issue: payload => {
    const issue = payload.issue as { title?: string; number?: number; body?: string } | undefined;
    if (!issue?.title || issue.number === undefined) {
      return undefined;
    }
    return {
      title: issue.title,
      number: issue.number,
      ...(issue.body !== undefined ? { body: issue.body } : {}),
    };
  },
  pull_request: payload => {
    const pr = payload.pull_request as
      | { title?: string; number?: number; body?: string }
      | undefined;
    if (!pr?.title || pr.number === undefined) {
      return undefined;
    }
    return {
      title: pr.title,
      number: pr.number,
      ...(pr.body !== undefined ? { body: pr.body } : {}),
    };
  },
};

export function getIssueOrPullRequestContext(
  deps: GitHubModuleDeps
): IssueOrPullRequestContext | undefined {
  const contextType = getContextType(deps);
  if (!contextType) {
    return undefined;
  }

  const extractor = CONTEXT_EXTRACTORS[contextType];
  if (!extractor) {
    return undefined;
  }

  return extractor(deps.context.payload);
}

/**
 * Enrich a prompt string with issue/PR context when available.
 *
 * @param deps - Module dependencies.
 * @param instruction - The raw instruction text.
 * @param label - Label for the instruction section (e.g. "Comment/Instruction" or "Instruction").
 * @returns The enriched prompt, or the original instruction if no context is available.
 */
function enrichWithContext(deps: GitHubModuleDeps, instruction: string, label: string): string {
  const issueOrPrContext = getIssueOrPullRequestContext(deps);
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
 * @param deps - Module dependencies.
 * @param promptInput - Optional explicit prompt input override.
 * @returns The assembled prompt string, or `undefined` if no prompt source was
 *          found.
 */
export async function getPrompt(
  deps: GitHubModuleDeps,
  promptInput?: string
): Promise<string | undefined> {
  // Prefer explicit prompt input over comment-based extraction
  if (promptInput) {
    const trimmed = promptInput.trim();
    if (!trimmed) {
      deps.logger.notice('prompt input is empty, skipping');
      return undefined;
    }
    return enrichWithContext(deps, trimmed, 'Instruction');
  }

  // Fall back to comment-based prompt
  const comment = await getComment(deps);
  if (!comment) {
    deps.logger.notice('no comment found in context, skipping');
    return undefined;
  }

  const prompt = comment.body;
  if (!prompt) {
    deps.logger.notice('no prompt found in comment, skipping');
    return undefined;
  }

  return enrichWithContext(deps, prompt, 'Comment/Instruction');
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

async function getComment(deps: GitHubModuleDeps): Promise<TriggeringComment | undefined> {
  const { payload } = deps.context;
  const comment = payload.comment as { id?: number; body?: string } | undefined;
  const review = payload.review as { id?: number; body?: string } | undefined;

  // For pull_request_review events, the body is on the review object, not comment
  if (!comment && review) {
    if (!review.body || review.id === undefined) {
      return;
    }

    const body = review.body.replace(getTrigger(deps), '').trim();
    return { id: review.id, body };
  }

  if (comment?.id === undefined) {
    return;
  }

  const body = (comment.body as string).replace(getTrigger(deps), '').trim();
  return { id: comment.id, body };
}

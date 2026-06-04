/**
 * @file GitHub comment creation utilities.
 *
 * Provides wrappers around Octokit endpoints for creating comments on issues/PRs
 * and replies to PR review comments. Supports appending an action-run link to the
 * final comment posted by the Pi agent.
 *
 * All functions accept a {@link GitHubModuleDeps} parameter for explicit
 * dependency injection — no module-level singletons or `@actions/*` imports.
 */

import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import { Temporal } from '@js-temporal/polyfill';
import type { GitHubModuleDeps } from './types';
import type { CommentMetadata } from '@alexanderfortin/pi-orchestrator';

/**
 * Metadata to include in the comment footer.
 *
 * Re-exported from `@alexanderfortin/pi-orchestrator` so consumers of this
 * module can import `CommentMetadata` from either package. The canonical
 * definition lives in the orchestrator to keep a single source of truth.
 */
export type { CommentMetadata } from '@alexanderfortin/pi-orchestrator';

export type CreateCommentType =
  | RestEndpointMethodTypes['issues']['createComment']['response']
  | RestEndpointMethodTypes['pulls']['createReplyForReviewComment']['response'];

/**
 * Check if the current comment is a pull request review comment (inline comment).
 *
 * PR review comments have a `pull_request_review_id` field in the payload.
 *
 * @param deps - Module dependencies.
 * @returns `true` if the comment is a PR review comment, `false` otherwise.
 */
function isPullRequestReviewComment(deps: GitHubModuleDeps): boolean {
  const comment = deps.context.payload.comment as { pull_request_review_id?: number } | undefined;
  return comment?.pull_request_review_id !== undefined;
}

/**
 * Create a comment on the current issue or pull request, or reply to an inline PR review comment.
 *
 * For inline PR review comments, creates a threaded reply. For regular comments,
 * creates a top-level comment on the issue/PR.
 *
 * @param deps - Module dependencies.
 * @param body - The Markdown body of the comment.
 * @returns The Octokit response, or `undefined` if `body` is empty.
 */
async function createComment(
  deps: GitHubModuleDeps,
  body: string
): Promise<CreateCommentType | undefined> {
  if (!body) {
    return;
  }

  const issueNumber = deps.context.issue.number;
  if (!issueNumber) {
    deps.logger.debug('[comments] no issue/PR number in context, skipping comment creation');
    return undefined;
  }

  const octokit = deps.octokit;
  const { owner, repo } = deps.context.repo;

  // Check if this is a reply to a PR review comment (inline comment)
  if (isPullRequestReviewComment(deps)) {
    const comment = deps.context.payload.comment as { id?: number } | undefined;
    if (comment?.id === undefined) {
      deps.logger.debug('[comments] no comment found for review reply');
      return undefined;
    }

    deps.logger.debug('[comments] creating reply to PR review comment');
    return octokit.rest.pulls.createReplyForReviewComment({
      owner,
      repo,
      pull_number: issueNumber,
      comment_id: comment.id,
      body,
    });
  } else {
    deps.logger.debug('[comments] creating top-level issue/PR comment');
    return octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  }
}

/**
 * Format a Temporal Duration to a human-readable string, rounded to the nearest second.
 *
 * Shows only non-zero units of hours, minutes, and seconds.
 *
 * @param duration - Execution time as Temporal.Duration
 * @returns Formatted string (e.g., "1s", "1m 30s", "1h 5m 30s")
 *
 * @internal Exported for testing purposes only.
 */
export function formatExecutionTime(duration: Temporal.Duration): string {
  const rounded = duration.round({ largestUnit: 'hour', smallestUnit: 'second' });
  const parts: string[] = [];

  const hours = rounded.hours;
  const minutes = rounded.minutes;
  const seconds = rounded.seconds;

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
}

/**
 * Format a number with appropriate suffix (K for thousands, M for millions).
 *
 * @param value - Number to format
 * @returns Formatted string (e.g., "1.2K", "1.5M", "500")
 *
 * @internal Exported for testing purposes only.
 */
export function formatNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return String(value);
}

/**
 * Post the final result (or error) comment on the current issue or pull request.
 *
 * Automatically appends a "View action run" link pointing to the GitHub Actions
 * run that produced the comment, along with optional Pi metadata.
 *
 * @param deps - Module dependencies.
 * @param body - The Markdown body of the comment.
 * @param metadata - Optional metadata to include in the footer.
 * @returns The Octokit response, or `undefined` if `body` is empty.
 */
export async function createFinalComment(
  deps: GitHubModuleDeps,
  body: string,
  metadata?: CommentMetadata
): Promise<CreateCommentType | undefined> {
  if (!body) {
    return;
  }

  // Build the action run URL
  const serverUrl = deps.context.serverUrl || 'https://github.com';
  const { owner, repo } = deps.context.repo;
  const runId = deps.context.runId;

  let finalBody = body;
  if (owner && repo && runId) {
    const actionRunUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

    // Build metadata parts
    const metadataParts: string[] = [`[View action run](${actionRunUrl})`];

    if (metadata?.provider && metadata.model) {
      let modStr = `Model: ${metadata.provider}/${metadata.model}`;
      if (metadata?.thinkingLevel && metadata.thinkingLevel !== 'off') {
        modStr = `${modStr} (thinking: ${metadata.thinkingLevel})`;
      }
      metadataParts.push(modStr);
    }

    if (metadata?.executionDuration !== undefined) {
      metadataParts.push(`Time: ${formatExecutionTime(metadata.executionDuration)}`);
    }

    // Add token usage if available
    if (metadata?.sessionStats) {
      const { totalTokens, cost } = metadata.sessionStats;
      metadataParts.push(`Tokens: ${formatNumber(totalTokens)}`);

      // some pay-as-you-go providers (e.g. ppq.ai) may represent spending cost as
      // negative (to maybe avoid confusing the user for the account-balance left?)
      const sessionCost = Math.abs(cost);

      if (sessionCost > 0) {
        metadataParts.push(`Cost: $${sessionCost.toFixed(2)}`);
      }
    }

    if (metadata?.sessionStats?.version) {
      metadataParts.push(`Pi SDK v${metadata.sessionStats.version}`);
    }

    if (metadata?.actionVersion) {
      metadataParts.push(`Action v${metadata.actionVersion}`);
    }

    finalBody = `${body}\n\n---\n\n${metadataParts.join(' | ')}`;
  }

  return createComment(deps, finalBody);
}

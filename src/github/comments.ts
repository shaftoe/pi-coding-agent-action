/**
 * @file GitHub comment creation utilities.
 *
 * Provides a thin wrapper around the Octokit `issues.createComment` endpoint
 * with support for appending an action-run link to the final comment posted by
 * the Pi agent.
 */

import * as github from '@actions/github';
import RestEndpointMethodTypes from '@octokit/plugin-rest-endpoint-methods';
import { Temporal } from '@js-temporal/polyfill';
import { getOctokit } from './octokit.js';

const octokit = getOctokit();

/**
 * Metadata to include in the comment footer.
 */
export interface CommentMetadata {
  /** LLM provider (e.g., "anthropic", "openai") */
  provider?: string;
  /** Model identifier (e.g., "claude-sonnet-4-5") */
  model?: string;
  /** Thinking/reasoning level (e.g., "off", "low", "medium", "high") */
  thinkingLevel?: string;
  /** Total execution time as a Temporal Duration */
  executionDuration?: Temporal.Duration;
}

export type CreateCommentType =
  RestEndpointMethodTypes.RestEndpointMethodTypes['issues']['createComment']['response'];

/**
 * Format a Temporal Duration to a human-readable string, rounded to the nearest second.
 *
 * Shows only non-zero units of hours, minutes, and seconds.
 *
 * @param duration - Execution time as Temporal.Duration
 * @returns Formatted string (e.g., "1s", "1m 30s", "1h 5m 30s")
 */
function formatExecutionTime(duration: Temporal.Duration): string {
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
 * Create a comment on the current issue or pull request.
 *
 * @param body - The Markdown body of the comment.
 * @returns The Octokit response, or `undefined` if `body` is empty.
 */
async function createComment(body: string): Promise<CreateCommentType | undefined> {
  if (!body) {
    return;
  }

  return octokit.rest.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: github.context.issue.number,
    body,
  });
}

/**
 * Post the final result (or error) comment on the current issue or pull request.
 *
 * Automatically appends a "View action run" link pointing to the GitHub Actions
 * run that produced the comment, along with optional Pi metadata.
 *
 * @param body - The Markdown body of the comment.
 * @param metadata - Optional metadata to include in the footer.
 * @returns The Octokit response, or `undefined` if `body` is empty.
 */
export async function createFinalComment(
  body: string,
  metadata?: CommentMetadata
): Promise<CreateCommentType | undefined> {
  if (!body) {
    return;
  }

  // Build the action run URL
  const serverUrl = github.context.serverUrl || 'https://github.com';
  const { owner, repo } = github.context.repo;
  const runId = github.context.runId;

  let finalBody = body;
  if (owner && repo && runId) {
    const actionRunUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

    // Build metadata parts
    const metadataParts: string[] = [`[View action run](${actionRunUrl})`];

    if (metadata?.provider && metadata.model) {
      metadataParts.push(`Model: ${metadata.provider}/${metadata.model}`);
    }

    if (metadata?.thinkingLevel && metadata.thinkingLevel !== 'off') {
      metadataParts.push(`Thinking: ${metadata.thinkingLevel}`);
    }

    if (metadata?.executionDuration !== undefined) {
      metadataParts.push(`Time: ${formatExecutionTime(metadata.executionDuration)}`);
    }

    finalBody = `${body}\n\n---\n\n${metadataParts.join(' | ')}`;
  }

  return createComment(finalBody);
}

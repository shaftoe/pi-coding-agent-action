/**
 * @file GitHub comment creation utilities.
 *
 * Provides wrappers around Octokit endpoints for creating comments on issues/PRs
 * and replies to PR review comments. Supports appending an action-run link to the
 * final comment posted by the Pi agent.
 *
 * Structure:
 *   - Pure helpers (`buildActionRunUrl`, `formatModelMetadata`,
 *     `formatSessionStatsLine`, `buildMetadataFooter`) — exported for direct
 *     unit testing.
 *   - `createComment` — internal helper; dispatches to the right Octokit
 *     endpoint (issue comment vs PR review-thread reply).
 *   - `createFinalComment` — the entry point. Composes the metadata footer
 *     then delegates the actual API call to `createComment`.
 *
 * All functions accept a {@link GitHubModuleDeps} parameter for explicit
 * dependency injection — no module-level singletons or `@actions/*` imports.
 */

import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import { Temporal } from '@js-temporal/polyfill';
import type { GitHubModuleDeps } from './types';
import type { CommentMetadata } from '@alexanderfortin/pi-orchestrator';
import { formatActionVersion, formatCost } from '@alexanderfortin/pi-orchestrator';

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

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Build the GitHub/Forgejo Actions run URL from a deps context, or return
 * `undefined` when any required field is missing.
 *
 * URL formats differ by platform:
 * - **GitHub** (incl. GitHub Enterprise): `{server}/{owner}/{repo}/actions/runs/{runId}`
 * - **Forgejo / Codeberg / Gitea**: `{server}/{owner}/{repo}/actions/runs/{runNumber}`
 *
 * Forgejo serves an action run at the **per-repo run NUMBER**, not the global
 * run id — the two are different values, and `GITHUB_RUN_ID` (what `runId`
 * holds) 404s when substituted into Forgejo's URL. The canonical `html_url`
 * Forgejo's own API returns is the bare run URL with no job/attempt suffix.
 *
 * GitHub itself uses `GITHUB_RUN_ID` in its URLs, so the runNumber override is
 * scoped to the Forgejo/Codeberg branch only. When `runNumber` is missing on a
 * Forgejo-like platform, we fall back to `runId` as a best-effort baseline.
 */
// fallow-ignore-next-line complexity
export function buildActionRunUrl(deps: GitHubModuleDeps): string | undefined {
  const serverUrl = deps.context.serverUrl || 'https://github.com';
  const { owner, repo } = deps.context.repo;
  const runId = deps.context.runId;
  if (!owner || !repo || !runId) {
    return undefined;
  }
  const baseUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;

  // Forgejo/Codeberg serve the run at the per-repo run NUMBER, not the
  // global run id. Using runId here would 404; the canonical URL has no
  // job/attempt suffix.
  const isForgejoLike = deps.platformType === 'forgejo' || deps.platformType === 'codeberg';
  if (isForgejoLike) {
    const runNumber = deps.context.runNumber;
    if (!runNumber) {
      // Graceful fallback: runNumber missing — emit the runId baseline.
      // Only correct for GitHub, but better than suppressing the footer.
      return baseUrl;
    }
    return `${serverUrl}/${owner}/${repo}/actions/runs/${runNumber}`;
  }

  return baseUrl;
}

/**
 * Format the `Model: provider/model (thinking: <level>)` line, or return
 * `undefined` when provider or model is missing. Thinking-level is
 * omitted when it's `'off'` or absent.
 */
// fallow-ignore-next-line complexity
export function formatModelMetadata(metadata: CommentMetadata): string | undefined {
  if (!metadata.provider || !metadata.model) {
    return undefined;
  }
  let line = `Model: ${metadata.provider}/${metadata.model}`;
  if (metadata.thinkingLevel && metadata.thinkingLevel !== 'off') {
    line = `${line} (thinking: ${metadata.thinkingLevel})`;
  }
  return line;
}

/**
 * Format the "Tokens: N · Cost: $X.XX" line, plus the "Pi SDK v…" line
 * when a version is present. Returns an empty array when there are no
 * session stats at all.
 *
 * Cost formatting (absolute value, zero omission) is handled by the shared
 * {@link formatCost} helper so this surface stays in lockstep with the
 * action-log report.
 */
export function formatSessionStatsLines(metadata: CommentMetadata): string[] {
  const stats = metadata.sessionStats;
  if (!stats) {
    return [];
  }
  const lines: string[] = [];
  lines.push(`Tokens: ${formatNumber(stats.totalTokens)}`);
  const cost = formatCost(stats.cost, 2);
  if (cost) {
    lines.push(`Cost: $${cost}`);
  }
  if (stats.version) {
    lines.push(`Pi SDK v${stats.version}`);
  }
  return lines;
}

/**
 * Build the metadata footer (everything after the `---` separator) for a
 * final comment. Returns `undefined` when no action-run URL is available
 * (in which case the caller should post the bare body without a footer).
 *
 * Order of parts: action run link · model · time · tokens · cost · SDK
 * version · action version.
 */
// fallow-ignore-next-line complexity
export function buildMetadataFooter(
  deps: GitHubModuleDeps,
  metadata: CommentMetadata | undefined
): string | undefined {
  const actionRunUrl = buildActionRunUrl(deps);
  if (!actionRunUrl) {
    return undefined;
  }

  const parts: string[] = [`[View action run](${actionRunUrl})`];

  if (metadata) {
    const modelLine = formatModelMetadata(metadata);
    if (modelLine) {
      parts.push(modelLine);
    }
    if (metadata.executionDuration !== undefined) {
      parts.push(`Time: ${formatExecutionTime(metadata.executionDuration)}`);
    }
    parts.push(...formatSessionStatsLines(metadata));
    if (metadata.actionVersion) {
      parts.push(`Action v${formatActionVersion(metadata.actionVersion)}`);
    }
  }

  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Comment dispatch (issue vs PR review-thread reply)
// ---------------------------------------------------------------------------

/**
 * Check if the current comment is a pull request review comment (inline comment).
 *
 * PR review comments have a `pull_request_review_id` field in the payload.
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
 * @returns The Octokit response, or `undefined` if `body` is empty or no
 *   issue/PR number is in context.
 */
// fallow-ignore-next-line complexity
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

// ---------------------------------------------------------------------------
// Number / time formatting (kept exported; pre-existing API)
// ---------------------------------------------------------------------------

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
// fallow-ignore-next-line complexity
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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

  const footer = buildMetadataFooter(deps, metadata);
  const finalBody = footer ? `${body}\n\n---\n\n${footer}` : body;

  return createComment(deps, finalBody);
}

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
// Comment finding + update (optional overwrite behaviour)
// ---------------------------------------------------------------------------

/** Marker for the bot's own top-level issue/PR comments. */
const BOT_COMMENT_MARKER = '<!-- pi-coding-agent-comment -->';

/**
 * Maximum number of list-comments pages to fetch when searching for a prior bot
 * comment. Each page returns up to MAX_COMMENTS_PER_PAGE entries.
 *
 * We cap pagination to avoid unbounded API cost on PRs with an extraordinarily
 * long comment thread. In practice the bot's marker is unique enough that the
 * relevant comment is almost always on the first page; this safety bound simply
 * prevents older markers from being invisible in pathological cases while still
 * being correct for any realistic CI thread.
 */
const MAX_COMMENT_PAGES = 5;

/**
 * Number of comments to request per page from the list-comments endpoints.
 * 100 is the GitHub API maximum and minimises the number of page requests.
 */
const MAX_COMMENTS_PER_PAGE = 100;

/**
 * Marker used for replies to PR review comments (inline review comments).
 *
 * Top-level issue/PR comments and PR review-comment replies live in separate
 * GitHub comment namespaces (issue comments vs. review comments) and are
 * fetched/updated through different REST endpoints, so they need distinct
 * markers. This marker lets us identify -- and overwrite on re-runs -- the
 * bot's previous reply to an inline review comment instead of creating a
 * duplicate reply every time `/pi` is re-invoked on the same comment.
 */
const BOT_REVIEW_COMMENT_MARKER = '<!-- pi-coding-agent-review-comment -->';

/** A minimal projection of a GitHub issue/PR comment. */
export interface CommentRef {
  id: number;
  body: string;
}

interface CommentWithUser {
  id: number | bigint;
  body?: string | null;
  user?: {
    type?: string | null;
    login?: string | null;
  } | null;
}

/**
 * Recognise a comment as authored by this action, regardless of which
 * namespace (issue comment vs. PR review-comment reply) it lives in.
 *
 * Both {@link BOT_COMMENT_MARKER} and {@link BOT_REVIEW_COMMENT_MARKER} are
 * accepted so that review replies authored *before* the dedicated review
 * marker existed (still tagged with the issue marker) are recognised on the
 * next run and migrated onto the correct marker instead of spawning a
 * duplicate reply.
 *
 * Also verifies that the comment author is a Bot user (`user.type === 'Bot'`).
 */
function isBotAuthored(comment: CommentWithUser): boolean {
  const body = comment.body;
  if (!body) {
    return false;
  }
  if (comment.user?.type !== 'Bot') {
    return false;
  }
  return body.startsWith(BOT_COMMENT_MARKER) || body.startsWith(BOT_REVIEW_COMMENT_MARKER);
}

/**
 * Fetch all issue/PR comments across multiple pages.
 *
 * GitHub's `listComments` endpoint returns comments sorted by **ascending ID**
 * (oldest first) by default and does not support `sort`/`direction` params —
 * those are silently dropped. We paginate up to {@link MAX_COMMENT_PAGES}
 * pages to avoid silently dropping older bot comments on PRs with 100+ total
 * comments (the API returns at most MAX_COMMENTS_PER_PAGE results per page).
 *
 * The returned array is ordered oldest-first (the endpoint's native order);
 * callers must select the highest-id match to find the most recent prior bot
 * comment.
 *
 * @returns Array of comment objects, oldest-first.
 */
async function listAllIssueComments(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<RestEndpointMethodTypes['issues']['listComments']['response']['data']> {
  const allComments: NonNullable<
    RestEndpointMethodTypes['issues']['listComments']['response']['data']
  > = [];
  let page = 1;
  while (page <= MAX_COMMENT_PAGES) {
    const comments = await deps.octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: MAX_COMMENTS_PER_PAGE,
      page,
    });
    allComments.push(...comments.data);
    if (comments.data.length < MAX_COMMENTS_PER_PAGE) {
      break;
    }
    page++;
  }
  return allComments;
}

/**
 * Fetch all PR review comments (top-level inline comments + their replies)
 * across multiple pages, newest-first.
 *
 * Same pagination + ordering rationale as {@link listAllIssueComments}: GitHub
 * defaults to ascending ID order (oldest first), so we request
 * `sort: 'created', direction: 'desc'` and walk up to
 * {@link MAX_COMMENT_PAGES} pages.
 *
 * @returns Array of review-comment objects, newest-first.
 */
async function listAllReviewComments(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<RestEndpointMethodTypes['pulls']['listReviewComments']['response']['data']> {
  const allComments: NonNullable<
    RestEndpointMethodTypes['pulls']['listReviewComments']['response']['data']
  > = [];
  let page = 1;
  while (page <= MAX_COMMENT_PAGES) {
    const reviewComments = await deps.octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: issueNumber,
      per_page: MAX_COMMENTS_PER_PAGE,
      sort: 'created',
      direction: 'desc',
      page,
    });
    allComments.push(...reviewComments.data);
    if (reviewComments.data.length < MAX_COMMENTS_PER_PAGE) {
      break;
    }
    page++;
  }
  return allComments;
}

/**
 * Find the most recent comment authored by this action on the current issue/PR.
 *
 * We identify our own comments by embedding one of the bot markers
 * ({@link BOT_COMMENT_MARKER} for issue/PR comments or
 * {@link BOT_REVIEW_COMMENT_MARKER} for PR review-comment replies) at the
 * start of the body — this is resilient to footer changes and avoids matching
 * unrelated bot comments in this (issue-comment) namespace.
 *
 * GitHub's `listComments` endpoint returns comments sorted by **ascending ID**
 * (oldest first) by default and does not support `sort`/`direction` params.
 * We therefore cannot request descending order; instead we collect every
 * bot-authored match and pick the highest-id one, which is the most recent.
 *
 * @returns The most recent matching comment (or `undefined` if none found).
 */
export async function findPreviousBotComment(
  deps: GitHubModuleDeps
): Promise<CommentRef | undefined> {
  const issueNumber = deps.context.issue.number;
  if (!issueNumber) {
    return undefined;
  }

  const { owner, repo } = deps.context.repo;
  const allComments = await listAllIssueComments(deps, owner, repo, issueNumber);

  // Collect all bot-authored matches (oldest-first in this endpoint) and pick
  // the highest id = most recent prior bot comment.
  const matches = allComments.filter(c => isBotAuthored(c));
  if (matches.length === 0) {
    return undefined;
  }
  // matches is guaranteed non-empty here.
  const found = matches.reduce((max, c) => (c.id > max.id ? c : max), matches[0]!);
  return { id: Number(found.id), body: found.body ?? '' };
}

/**
 * Update an existing comment authored by this action, identified by `commentId`.
 *
 * @param commentId - The GitHub comment id to update.
 * @returns The Octokit response, or `undefined` if `body` is empty.
 */
export async function updateBotComment(
  deps: GitHubModuleDeps,
  commentId: number,
  body: string
): Promise<RestEndpointMethodTypes['issues']['updateComment']['response'] | undefined> {
  if (!body) {
    return;
  }

  const { owner, repo } = deps.context.repo;
  return deps.octokit.rest.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
}

/**
 * Find the most recent reply authored by this action to the inline review
 * comment that triggered the current run.
 *
 * PR review-comment replies live in a separate namespace from issue/PR
 * comments: they're fetched via `pulls.listReviewComments` (not
 * `issues.listComments`), and replies are identified by an `in_reply_to_id`
 * that points at the parent (top-level) review comment. We therefore look for
 * the bot's previous reply whose `in_reply_to_id` matches the id of the
 * comment we're replying to, and whose body is prefixed with a bot marker —
 * {@link BOT_REVIEW_COMMENT_MARKER}, or — for backward compatibility —
 * {@link BOT_COMMENT_MARKER} on replies authored before the review marker existed.
 *
 * GitHub's `listReviewComments` endpoint, like `listComments`, defaults to
 * ascending ID order (oldest first). We request `direction: 'desc'` via
 * {@link listAllReviewComments} so the first match is the most recent prior reply.
 *
 * @returns The most recent matching reply (or `undefined` if none found).
 */
export async function findPreviousBotReviewComment(
  deps: GitHubModuleDeps
): Promise<CommentRef | undefined> {
  const issueNumber = deps.context.issue.number;
  if (!issueNumber) {
    return undefined;
  }

  // We only ever reply to a specific inline review comment; if there isn't
  // one in the payload, there's nothing to match against.
  const commentId = (deps.context.payload.comment as { id?: number } | undefined)?.id;
  if (commentId === undefined) {
    return undefined;
  }

  const { owner, repo } = deps.context.repo;
  const allReviewComments = await listAllReviewComments(deps, owner, repo, issueNumber);

  // Newest-first: the first match is the most recent prior reply in this thread.
  // `in_reply_to_id` needs no Number() coercion here: `bigint` can only come
  // from the v18 typings, never from runtime REST responses — both sides of
  // this comparison are plain numbers at runtime.
  const found = allReviewComments.find(c => c.in_reply_to_id === commentId && isBotAuthored(c));
  if (!found) {
    return undefined;
  }
  return { id: Number(found.id), body: found.body ?? '' };
}

/**
 * Update an existing reply authored by this action to a PR review comment,
 * identified by `commentId` (the reply's own review-comment id).
 *
 * Uses `pulls.updateReviewComment` (PATCH on `/repos/{owner}/{repo}/pulls/comments/{comment_id}`),
 * which updates the body of any review comment — including replies to a
 * top-level review comment — identified by that comment's own id.
 *
 * @param commentId - The review-comment id of the reply to update.
 * @returns The Octokit response, or `undefined` if `body` is empty.
 */
export async function updateBotReviewComment(
  deps: GitHubModuleDeps,
  commentId: number,
  body: string
): Promise<RestEndpointMethodTypes['pulls']['updateReviewComment']['response'] | undefined> {
  if (!body) {
    return;
  }

  const { owner, repo } = deps.context.repo;
  return deps.octokit.rest.pulls.updateReviewComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
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
 * When `deps.updateComment` is true, the function first attempts to find and
 * update the bot's previous comment so it doesn't leave a duplicate behind on
 * re-runs. The lookup is namespace-aware because GitHub stores the two kinds
 * of comments in separate endpoints:
 *
 * - For top-level issue/PR comments it searches `issues.listComments` for a
 *   comment prefixed with {@link BOT_COMMENT_MARKER} and updates it via
 *   `issues.updateComment`.
 * - For replies to inline PR review comments it searches
 *   `pulls.listReviewComments` for a reply (with an `in_reply_to_id` matching
 *   the comment we're replying to) prefixed with
 *   {@link BOT_REVIEW_COMMENT_MARKER} and updates it via
 *   `pulls.updateReviewComment`. (Older replies authored before the review
 *   marker existed — still tagged with {@link BOT_COMMENT_MARKER} — are also
 *   recognised here so the upgrade transition leaves no duplicates behind.)
 *
 * If no prior comment is found, or when `updateComment` is false, it creates a
 * new comment (or review-comment reply) with the appropriate marker embedded
 * in the body so a future run can find + overwrite it.
 *
 * @param deps - Module dependencies.
 * @param body - The Markdown body of the comment.
 * @param metadata - Optional metadata to include in the footer.
 * @returns The Octokit response, or `undefined` if `body` is empty or the
 *   context has no issue/PR number.
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

  // Pick the marker (and matching update strategy) for the comment namespace
  // we're operating in: review-comment replies vs. top-level issue/PR comments.
  const isReviewComment = isPullRequestReviewComment(deps);
  const marker = isReviewComment ? BOT_REVIEW_COMMENT_MARKER : BOT_COMMENT_MARKER;

  // Optionally overwrite the bot's previous comment instead of creating a new one.
  if (deps.updateComment) {
    if (isReviewComment) {
      const prev = await findPreviousBotReviewComment(deps);
      if (prev) {
        deps.logger.debug(`[comments] updating previous bot review comment ${prev.id}`);
        const updatedBody = `${marker}\n${finalBody}`;
        try {
          await updateBotReviewComment(deps, prev.id, updatedBody);
          return;
        } catch (err) {
          // If the update fails (e.g. transient 5xx, permissions issue),
          // fall through to createComment so the comment is not lost entirely.
          deps.logger.warning(
            `[comments] failed to update bot review comment ${prev.id}, falling back to create: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    } else {
      const prev = await findPreviousBotComment(deps);
      if (prev) {
        deps.logger.debug(`[comments] updating previous bot comment ${prev.id}`);
        const updatedBody = `${marker}\n${finalBody}`;
        try {
          await updateBotComment(deps, prev.id, updatedBody);
          return;
        } catch (err) {
          // If the update fails (e.g. transient 5xx, permissions issue),
          // fall through to createComment so the comment is not lost entirely.
          deps.logger.warning(
            `[comments] failed to update bot comment ${prev.id}, falling back to create: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }
  }

  // Embed the marker so subsequent runs can find + overwrite this comment.
  const markedBody = `${marker}\n${finalBody}`;
  return createComment(deps, markedBody);
}

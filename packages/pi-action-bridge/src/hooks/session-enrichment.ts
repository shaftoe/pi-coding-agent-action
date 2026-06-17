/**
 * @file Session enrichment (Phase 4 / §6 / §2.8).
 *
 * On the first turn of a session (`before_agent_start`, one-shot guard), if the
 * current branch is linked to an open PR, inject a compact *persistent* session
 * message: PR metadata + the most recent few comments. This gives the agent
 * immediate awareness of current state (latest review, latest CI result
 * comment) without a manual fetch; `get_thread` remains the depth escape hatch.
 *
 * ⚠️ Oldest-first gotcha (§6): the GitHub comments API paginates oldest-first,
 * and `getIssueOrPRThread({ max_comments: N })` returns the *oldest* N — which
 * is exactly wrong for "recent state". We fetch unbounded and slice the LAST N
 * locally (`.slice(-count)`), so injected comments are the most recent.
 */

import type { BeforeAgentStartEventResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';
// Shared pure render helpers (§2.9) — keep the metadata format identical to the
// `get_thread` tool so the agent sees consistent formatting.
import {
  formatPRFields,
  formatThreadHeader,
  formatThreadLabels,
} from '@alexanderfortin/pi-orchestrator/pi/tools/common';
import type { IssueOrPRThread, ThreadComment } from '@alexanderfortin/pi-orchestrator';
import type { Bridge } from '../bridge.js';

/** Number of recent comments to inject (§6 / Q5: N = 3). */
export const RECENT_COMMENT_COUNT = 3;

/** `customType` for the injected persistent message (namespaced). */
export const ENRICHMENT_CUSTOM_TYPE = 'pi-action-bridge:pr-context';

/** Details attached to the injected message (typed metadata for tests/logs). */
export interface EnrichmentDetails {
  pr_number: number;
  /** How many comments were actually injected (min(count, total)). */
  injected_comments: number;
  /** Total issue-level comments on the thread. */
  total_comments: number;
}

/** A ready-to-inject message: the `{ message }` shape + its typed details. */
export interface EnrichmentResult {
  message: BeforeAgentStartEventResult['message'] & { details?: EnrichmentDetails };
  details: EnrichmentDetails;
}

/**
 * Render a slice of comments as numbered blocks, mirroring the per-comment
 * shape of the shared `formatThreadComments` helper. Kept local (not shared)
 * because the surrounding header is different here: we label it as a *recent
 * slice* ("last N of M"), which the shared helper's `Comments (N):` header
 * would misrepresent. See §2.9 (shared helpers shared; distinct presentations
 * not force-shared).
 *
 * Timestamps are emitted raw (GitHub already returns ISO 8601) rather than
 * re-normalized through the Temporal polyfill the shared helper uses — avoids
 * pulling a polyfill into the extension just to re-format an ISO timestamp.
 */
function formatRecentComments(comments: ThreadComment[]): string[] {
  const lines: string[] = [];
  comments.forEach((comment, i) => {
    const botMark = comment.author_type === 'bot' ? ' (bot)' : '';
    const triggerMark = comment.is_triggering_comment ? ' [📍 triggering comment]' : '';
    lines.push(
      `  ${i + 1}. @${comment.author}${botMark}${triggerMark}`,
      `     ${comment.created_at}`,
      `     ${comment.body}`
    );
  });
  return lines;
}

/**
 * Build the enrichment message text from a thread: metadata (via the shared
 * render helpers) + the most recent `count` comments, labelled with their
 * position so the model knows they're a recent slice, not the whole thread.
 *
 * Pure + deterministic — the unit-test target for the slice-last-N behaviour.
 */
export function buildEnrichmentMessage(
  thread: IssueOrPRThread,
  count: number = RECENT_COMMENT_COUNT
): string {
  const total = thread.comments.length;
  const recent = total > count ? thread.comments.slice(-count) : [...thread.comments];

  const headerLine =
    recent.length > 0
      ? `Recent comments (last ${recent.length} of ${total}):`
      : 'Recent comments: none yet.';

  const lines: string[] = [
    ...formatThreadHeader(thread),
    ...formatPRFields(thread),
    ...formatThreadLabels(thread),
    '',
    headerLine,
    ...formatRecentComments(recent),
    '',
    'Tip: call the `get_thread` tool for the full thread (older comments, reviews, CI results).',
  ];

  return lines.join('\n');
}

/**
 * Resolve the current PR and build the enrichment message. Returns
 * `undefined` when there's nothing to inject (no linked PR, thread missing, or
 * fetch error). **Never throws** — enrichment is best-effort background context
 * and must not break the user's session (the caller also try/catches, but
 * keeping this pure-ish aids testing).
 *
 * Separated from the hook registration so it's testable with a mock bridge
 * (same pattern as the read-only tools).
 */
export async function enrichThread(
  bridge: Bridge,
  count: number = RECENT_COMMENT_COUNT
): Promise<EnrichmentResult | undefined> {
  const prNumber = await bridge.resolveCurrentPR();
  if (!prNumber) {
    return undefined; // not on a PR branch — §6: silent, no action
  }

  // Fetch unbounded (up to the provider's MAX_COMMENTS) then slice the LAST N
  // locally — see the file header / §6 gotcha. `max_comments` would give the
  // oldest N, which is the opposite of "recent state".
  const thread = await bridge.provider.getIssueOrPRThread({
    owner: bridge.context.repo.owner,
    repo: bridge.context.repo.repo,
    issue_number: prNumber,
  });
  if (!thread) {
    return undefined;
  }

  const text = buildEnrichmentMessage(thread, count);
  const details: EnrichmentDetails = {
    pr_number: thread.number,
    injected_comments: Math.min(count, thread.comments.length),
    total_comments: thread.comments.length,
  };

  return {
    details,
    message: {
      customType: ENRICHMENT_CUSTOM_TYPE,
      content: text,
      display: true,
      details,
    },
  };
}

/**
 * Register the `before_agent_start` enrichment hook.
 *
 * The one-shot guard (`injected`) is closure-scoped to this call, so it resets
 * naturally per session: the extension factory — and thus the `session_start`
 * gate that calls this — is re-invoked for every new / resumed / forked session
 * (docs/extensions.md: session replacement "reloads and rebinds extensions for
 * the new session"). Consistent with §2.2 (no persisted state) and §2.8.
 *
 * The guard is set *before* the fetch attempt: a failed enrichment shouldn't
 * retry on every subsequent turn (that'd be a failing network call per turn).
 * If it fails, the user still has `get_thread`. The returned `reset()` clears
 * the guard (intended for tests).
 *
 * @returns `{ reset }` — call `reset()` to re-arm the guard.
 */
export function registerSessionEnrichment(
  pi: ExtensionAPI,
  bridge: Bridge,
  opts: { autoSync?: boolean; count?: number } = {}
): { reset: () => void } {
  const autoSync = opts.autoSync ?? true;
  const count = opts.count ?? RECENT_COMMENT_COUNT;
  let injected = false;

  pi.on('before_agent_start', async (): Promise<BeforeAgentStartEventResult | void> => {
    if (!autoSync || injected) {
      return;
    }
    // Set first: one attempt per session, success or failure.
    injected = true;
    try {
      const result = await enrichThread(bridge, count);
      if (!result) {
        return;
      }
      return { message: result.message };
    } catch {
      // Best-effort — never break the session over background context.
      return;
    }
  });

  return { reset: () => void (injected = false) };
}

/**
 * @file `/pickup` command — the inverse of `/handoff` (§5).
 *
 * Whereas `/handoff` pushes local work out to GitHub, `/pickup` pulls GitHub
 * state *into* the local agent: it resolves the PR linked to the current
 * branch (or an explicit `<number>`), then sends a single user-message prompt
 * that directs the agent to get oriented (call the read-only tools, summarize
 * where things stand + what's left).
 *
 * Deliberately tiny — no `complete()` call, no Octokit writes, no editor. The
 * entire command is: resolve a PR number → build a string →
 * `pi.sendUserMessage(string)`. The LLM does the actual orienting; this just
 * seeds it with the right target and framing.
 *
 * **Relationship to §6 auto-enrichment:** supplement, not replace. Enrichment
 * is one-shot-per-session (its guard re-arms only on a new/resumed/forked
 * session) and only fires when `auto_sync: true`. `/pickup` covers the gaps:
 * mid-session branch switch (PR A → PR B), `auto_sync: false` users with no
 * on-ramp, and the explicit `/pickup <number>` form for a PR not on the
 * current branch (notably fork PRs checked out via `gh pr checkout`, which
 * `resolveCurrentPR()`'s same-owner `head` filter can't match).
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Bridge } from './bridge.js';

/**
 * The prompt template sent to the agent. Kept as an exported pure builder so
 * the wording is unit-testable independently of the Bridge/SDK plumbing.
 *
 * Framing is *active* (a directive to respond with a summary), not silent
 * context injection — that's the whole point of a dedicated command vs. §6
 * enrichment. The agent is pointed at the two read-only tools (`get_thread`,
 * `get_pr_diff`) so it pulls depth on demand rather than relying on whatever
 * §6 injected (possibly stale, possibly absent).
 */
export function buildPickupPrompt(prNumber: number, branch: string | undefined): string {
  const branchLine = branch ? ` (branch \`${branch}\`)` : '';
  return [
    `We're picking up work on PR #${prNumber}${branchLine}.`,
    '',
    'Get oriented:',
    '- call `get_thread` for the latest comments, reviews, and CI results,',
    '- call `get_pr_diff` for the current state of the changes.',
    '',
    'Then give me a brief summary of where things stand and what is left to do.',
  ].join('\n');
}

/**
 * Parse an explicit PR number from the command args. Accepts a bare number or
 * a `#`-prefixed one, optionally with leading/trailing whitespace:
 *   `123`   → 123
 *   `#123`  → 123
 *   ` #42 ` → 42
 *   ``      → undefined  (no explicit target — resolve from the branch)
 *   `abc`   → undefined  (not a number — fall back to branch resolution)
 *
 * Returns `undefined` rather than throwing on garbage so the caller can fall
 * back to `resolveCurrentPR()` and surface a clear "no PR on this branch"
 * message, rather than erroring on a typo. Exported for unit testing.
 */
export function parsePRNumber(args: string): number | undefined {
  const m = /^\s*#?(\d+)\s*$/.exec(args);
  if (!m?.[1]) {
    return undefined;
  }
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Register the `/pickup` command against a live {@link Bridge}. Registered
 * inside the `session_start` gate (like `/handoff`) since it needs the Bridge
 * for branch → PR resolution.
 */
export function registerPickupCommand(pi: ExtensionAPI, bridge: Bridge): void {
  pi.registerCommand('pickup', {
    description:
      'Orient the agent on the PR checked out in the current dir (inverse of /handoff). ' +
      'Resolves the PR from the current branch (or takes an explicit <number>/#<number>), ' +
      'then asks the agent to read the thread + diff and summarize where things stand.',
    handler: async (args, ctx) => {
      // Guard: TUI mode only. sendUserMessage triggers a turn, which needs the
      // interactive loop — same guard as /handoff (§2.1 step 2).
      if (ctx.mode !== 'tui') {
        ctx.ui.notify('/pickup requires interactive (TUI) mode.', 'error');
        return;
      }

      // Resolve the target PR: explicit arg wins, else the branch.
      const explicit = parsePRNumber(args);
      const branch = await bridge.getCurrentBranch();
      const prNumber = explicit ?? (await bridge.resolveCurrentPR());

      if (!prNumber) {
        const hint = branch
          ? `No open PR linked to branch '${branch}'. Pass one explicitly: /pickup <number>`
          : 'No current branch (detached HEAD). Pass one explicitly: /pickup <number>';
        ctx.ui.notify(hint, 'warning');
        return;
      }

      // sendUserMessage always triggers a turn; it throws when the agent is
      // streaming unless deliverAs is set. /pickup is a user-initiated
      // orientation request, so we gate on idle rather than steer/interrupt
      // an in-flight turn (mirrors the /ask example in the SDK).
      if (!ctx.isIdle()) {
        ctx.ui.notify('Agent is busy — finish or interrupt the current turn first.', 'warning');
        return;
      }

      pi.sendUserMessage(buildPickupPrompt(prNumber, branch));
    },
  });
}

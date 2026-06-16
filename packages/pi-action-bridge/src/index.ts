/**
 * @file pi-action-bridge — Pi TUI extension entry point.
 *
 * Bridges a local Pi session and the `pi-coding-agent-action` CI agent. The
 * agent is read-only (two tools, Phase 2); `/handoff` is the sole write path
 * (Phase 3). See `CONSTITUTION.md` for the full design.
 *
 * Phase 1 (this file) wires the {@link session_start} gate (§2.3 Option C):
 * cheap factory load — registers `/handoff` only, no I/O — and at session
 * start does the one git-remote + token check. When the cwd is a known forge
 * repo AND a token resolves, it builds the provider/Octokit (ready for Phase 2
 * to register `get_thread` / `get_pr_diff` against); otherwise the bridge goes
 * inert with one info line and registers nothing. This keeps `pi --list-models`
 * / `--version` fast (no factory I/O) and keeps non-forge repos clean (no forge
 * tools in the agent's tool surface).
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Bridge } from './bridge.js';
import { getThreadToolFactory } from './tools/get-thread.js';
import { getPRDiffToolFactory } from './tools/get-pr-diff.js';

export default function piActionBridge(pi: ExtensionAPI): void {
  // `/handoff` is registered at load (cheap, no I/O). Commands don't pollute
  // the tool surface or the system prompt, so this is safe to do unconditionally
  // — even in a non-forge repo the only cost is a `/handoff` entry in the
  // command list, which fails clearly if invoked without a forge+token.
  // Phase 3 replaces this stub with the full orchestration (constitution §2.1).
  pi.registerCommand('handoff', {
    description: 'Push branch, open/update PR, post a /pi handoff comment for CI (Phase 3 — stub)',
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        '/handoff is not implemented yet (Phase 3). See packages/pi-action-bridge/CONSTITUTION.md',
        'info'
      );
    },
  });

  // The Q1/Option-C gate: detect forge + token at session start (real sessions
  // only — never `--list-models`/`--version`/print mode), build the provider if
  // active, and (Phase 2) register the two read-only tools against it.
  pi.on('session_start', async (_event, ctx) => {
    const bridge = await Bridge.create({
      cwd: ctx.cwd,
      onUnknownHost: serverUrl => {
        ctx.ui.notify(
          `pi-action-bridge: '${serverUrl}' isn't a known GitHub/Codeberg/Forgejo host — staying inert.`,
          'info'
        );
      },
      onNoToken: () => {
        ctx.ui.notify(
          'pi-action-bridge: no GITHUB_TOKEN/GH_TOKEN (and gh has no token) — staying inert. Set one to enable forge tools.',
          'info'
        );
      },
    });

    if (!bridge) {
      // Not a forge repo, unknown host, or no token — inert. No tools to
      // register. This is the correct state for non-forge repos, tokenless
      // shells, and `pi --list-models` (which doesn't fire session_start anyway).
      return;
    }

    // Register the two read-only tools against the live provider. Source-
    // verified (_refreshToolRegistry): tools registered at session_start are
    // auto-activated and added to the system prompt's active tool set — no
    // setActiveTools() call needed — and since session_start runs before
    // before_agent_start, they're live for turn 1.
    pi.registerTool(getThreadToolFactory(bridge));
    pi.registerTool(getPRDiffToolFactory(bridge));

    ctx.ui.notify(
      `pi-action-bridge: active on ${bridge.discovery.parsed.serverUrl} (${bridge.discovery.platformType}).`,
      'info'
    );
  });
}

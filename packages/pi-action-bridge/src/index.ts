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
import { registerHandoffCommand } from './handoff.js';

export default function piActionBridge(pi: ExtensionAPI): void {
  // The `/handoff` command needs a Bridge (provider + git + Octokit), which is
  // only available after the `session_start` gate has run. So we defer
  // registration: the gate registers `/handoff` once the bridge is live. In a
  // non-forge / tokenless repo, `/handoff` is simply not registered (the user
  // would get "unknown command" — cleaner than a stub that always errors).

  // The Q1/Option-C gate: detect forge + token at session start (real sessions
  // only — never `--list-models`/`--version`/print mode), build the provider if
  // active, and register the two read-only tools + the /handoff command.
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
      return;
    }

    // Register the two read-only tools + the /handoff command against the
    // live bridge. Source-verified (_refreshToolRegistry): tools registered at
    // session_start are auto-active for turn 1.
    pi.registerTool(getThreadToolFactory(bridge));
    pi.registerTool(getPRDiffToolFactory(bridge));
    registerHandoffCommand(pi, bridge);

    ctx.ui.notify(
      `pi-action-bridge: active on ${bridge.discovery.parsed.serverUrl} (${bridge.discovery.platformType}).`,
      'info'
    );
  });
}

/**
 * @file pi-action-bridge — Pi TUI extension entry point.
 *
 * Bridges a local Pi session and the `pi-coding-agent-action` CI agent. The
 * agent is read-only (two tools); `/handoff` is the sole write path. See
 * `CONSTITUTION.md` for the full design.
 *
 * This file wires the {@link session_start} gate (§2.3 Option C): a cheap
 * factory (no I/O) that, at session start (real sessions only — never
 * `pi --list-models` / `--version` / print mode), does the one git-remote +
 * token check. When the cwd is a known forge repo AND a token resolves, it
 * builds the provider/Octokit and registers the two read-only tools
 * (`get_thread`, `get_pr_diff`) plus the `/handoff` command against it;
 * otherwise the bridge goes inert with one info line and registers nothing.
 * This keeps `pi --list-models` / `--version` fast (no factory I/O) and keeps
 * non-forge repos clean (no forge tools in the agent's tool surface).
 *
 * Session auto-enrichment (Phase 4, §6) is wired separately via the
 * {@link before_agent_start} hook in `hooks/session-enrichment.ts`.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Bridge } from './bridge.js';
import { loadBridgeConfig } from './config.js';
import { getThreadToolFactory } from './tools/get-thread.js';
import { getPRDiffToolFactory } from './tools/get-pr-diff.js';
import { registerHandoffCommand } from './handoff.js';
import { registerPickupCommand } from './pickup.js';
import { registerSessionEnrichment } from './hooks/session-enrichment.js';

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
    registerPickupCommand(pi, bridge);

    // Session enrichment (Phase 4 / §6): load config once per session here (sync
    // read of a tiny file) and gate the before_agent_start hook on `auto_sync`.
    // The hook's one-shot guard is closure-scoped to this session_start call,
    // so it re-arms naturally on new/resume/fork.
    const config = loadBridgeConfig({ cwd: ctx.cwd, isTrusted: ctx.isProjectTrusted() });
    registerSessionEnrichment(pi, bridge, { autoSync: config.auto_sync });

    // Show rich status: platform + branch + PR (if on a PR branch).
    const [branch, currentPR] = await Promise.all([
      bridge.getCurrentBranch(),
      bridge.resolveCurrentPR(),
    ]);
    const branchLabel = branch ?? 'detached HEAD';
    const prLabel = currentPR ? ` (#${currentPR})` : '';
    const statusText = `${bridge.discovery.parsed.serverUrl} (${bridge.discovery.platformType}) · ${branchLabel}${prLabel}`;
    // Persistent status line (visible in the TUI status bar).
    ctx.ui.setStatus('pi-action-bridge:active', statusText);
    // One-shot startup notification.
    ctx.ui.notify(`pi-action-bridge: active on ${statusText}.`, 'info');
  });
}

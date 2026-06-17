# @alexanderfortin/pi-action-bridge

A [Pi](https://pi.dev) TUI extension that bridges local sessions and the `pi-coding-agent-action` CI agent. GitHub threads (issues, PRs, reviews) become the persistent memory and coordination layer between local work and remote CI.

## Design at a glance

- **The agent is read-only.** Two tools (`get_thread`, `get_pr_diff`) fetch GitHub context to help you work locally. The agent never writes to GitHub.
- **`/handoff` is the sole write path** — a deterministic command that pushes your branch, opens/updates the PR, drafts a `## Done` / `## Next` summary, and posts it as a `/pi ` comment the CI action picks up.
- **Auto-enrichment** — on a PR branch, the first turn injects PR metadata + recent comments so the agent starts aware.

See [`CONSTITUTION.md`](./CONSTITUTION.md) for the full design and decision log.

## Install

```bash
pi install ./packages/pi-action-bridge
```

Requires the `git` binary on PATH (push uses the developer's existing credential helpers) and a `GITHUB_TOKEN` / `GH_TOKEN` env var (or a logged-in `gh` CLI) for the forge API.

## Status

Phases 1–4 are implemented and tested: the scaffold + `session_start` gate (Phase 1), the two read-only tools `get_thread` / `get_pr_diff` (Phase 2), the `/handoff` command (Phase 3), and first-turn session auto-enrichment (Phase 4). Phase 5 (Codeberg) is already handled by the shared `detectPlatform` + `apiBaseUrlFromServerUrl` detection and has no dedicated tests yet — see [`CONSTITUTION.md`](./CONSTITUTION.md) §8.

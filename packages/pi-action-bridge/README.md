# @alexanderfortin/pi-action-bridge

A [Pi](https://github.com/earendil-works/pi-coding-agent) TUI extension that bridges local sessions and the `pi-coding-agent-action` CI agent. GitHub threads (issues, PRs, reviews) become the persistent memory and coordination layer between local work and remote CI.

## Design at a glance

- **The agent is read-only.** Two tools (`get_thread`, `get_pr_diff`) fetch GitHub context to help you work locally. The agent never writes to GitHub.
- **`/handoff` is the sole write path** — a deterministic command that pushes your branch, opens/updates the PR, drafts a `## Done` / `## Next` summary, and posts it as a `/pi` comment the CI action picks up.
- **Auto-enrichment** — on a PR branch, the first turn injects PR metadata + recent comments so the agent starts aware.

See [`CONSTITUTION.md`](./CONSTITUTION.md) for the full design and decision log.

## Install

```bash
pi install npm:@alexanderfortin/pi-action-bridge
# or from the monorepo workspace
pi install ./packages/pi-action-bridge
```

Requires the `git` binary on PATH (push uses the developer's existing credential helpers) and a `GITHUB_TOKEN` / `GH_TOKEN` env var (or a logged-in `gh` CLI) for the forge API.

## Status

Scaffolded (Phase 1). `/handoff` and the read-only tools are implemented in later phases — see the constitution's roadmap.

# @alexanderfortin/pi-action-bridge

A [Pi](https://pi.dev) TUI extension that bridges local sessions and the `pi-coding-agent-action` CI agent. GitHub threads (issues, PRs, reviews) become the persistent memory and coordination layer between local work and remote CI.

## Install

```bash
pi install ./packages/pi-action-bridge
```

Requires:

- the `git` binary on PATH, and
- a `GITHUB_TOKEN` / `GH_TOKEN` env var for the forge API (Octokit auth for the custom tools).

No `gh` CLI is needed: `/handoff` posts comments and `/pickup` reads the PR thread through Octokit-backed tools (`post_pr_comment`, `read_pr_thread`). `git` is still used for the actual pull in `/pickup`.

## Prompts

- `/handoff [PR-number]` — post a structured handoff comment to a PR.
- `/pickup [PR-number]` — pull the PR and summarise the last handoff comment.

The `[PR-number]` argument is **optional**: when omitted, the agent first calls
`detect_pull_request` to resolve the PR from the currently checked-out branch.
Pass an explicit number to target a PR that isn't checked out locally.

## Custom tools

### `detect_pull_request`

Detects the GitHub pull request (if any) checked out in the current working
directory, by inspecting the local git branch and querying the forge REST API.

Zero arguments: it reads the `origin` remote and looks up **open** PRs. If
`origin` is the wrong remote or the PR is already merged, the result carries the
branch, repo, and a `reason` so the agent can recover on its own (e.g. via its
`bash` tool).

Typical result (returned to the LLM as text):

```
github.com repo `owner/repo`, branch `feature-x` (clean, ahead 0, behind 1, tracking origin/feature-x) → PR #42 "Add foo" [open] https://github.com/owner/repo/pull/42
```

When no PR is resolved, the structured `details` includes a `reason`:
`not_a_git_repo` · `detached_head` · `no_remote` · `unrecognized_remote` ·
`no_pr_for_branch` · `aborted`.

> **Sandbox note:** the git inspector isolates git's global/system config
> (`GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`) **only** inside
> sandboxed agents where the user's `~/.gitconfig` is unreadable (otherwise git
> aborts even read-only commands with `fatal: unable to access '~/.gitconfig'`).
> In a normal local TUI the config is left untouched, so `insteadOf` URL
> rewrites (SSH aliases, GHE mirrors, credential-helper remaps) apply as usual.
> An explicit `GIT_CONFIG_GLOBAL` already in the environment is always respected.

#### Supported forges

GitHub, GitHub Enterprise, Codeberg, Forgejo and Gitea — the REST base URL is
derived via `apiBaseUrlFromServerUrl` (reused from `pi-platform-github`).

#### Fork limitation (single-repo MVP)

Correct for the common case where local work and the CI agent run on the
**same** repo. The tool reads the `origin` remote (falling back to the first
remote if there is no `origin`) and never consults a remote named `upstream`.

Contributor-from-fork workflows (where `origin` points at the fork and the PR
lives in the upstream/base repo) are a documented follow-up: such branches
resolve to `no_pr_for_branch`, with the branch/repo visible so the agent can
recover on its own.

### `post_pr_comment`

Posts a top-level comment to a PR (or issue) via the REST API. PRs share the
issues comment endpoint, so it posts to the pull request directly. The
`/pi 🤖 Handoff` Markdown template and marker are owned by the `/handoff`
prompt; this tool is a generic comment poster.

Params: `owner`, `repo`, `number`, `body` (Markdown), optional `server_url`
(default `https://github.com`). `number` is a typebox `Integer`, so there is
no shell-injection surface (the prompt's `^\d+$` guard is defence-in-depth).

### `read_pr_thread`

Reads a PR/issue thread — metadata plus issue-level comments — via the REST
API. Returns the comment bodies (capped per-comment in the text output; full
bodies in `details`) so `/pickup` can locate the last `/pi 🤖 Handoff` marker.
Inline review comments are intentionally excluded (a handoff thread lives in
issue-level comments).

Params: `owner`, `repo`, `number`, optional `max_comments` (default 100,
max 100), optional `server_url` (default `https://github.com`).

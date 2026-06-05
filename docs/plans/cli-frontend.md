# RFC: `pi-cli` — A CLI Frontend for the Pi Orchestrator

**Status:** Draft
**Issue:** #233 (Pivot to reusable Pi orchestrator app)
**Depends on:** Phases 1–3 of the refactor (provider injection, host adapter, monorepo split) — all merged.

---

## 1. Goal

Provide a `pi-cli` package that lets a developer run the same agent + tool set
that powers the GitHub Action **from a local terminal**, against any
GitHub-compatible repository (GitHub, Codeberg, Forgejo), without needing
a workflow run.

Secondary goals:

- Prove the orchestrator abstractions (`Logger`, `OutputSink`, `PlatformProvider`,
  `PiAgentFactory`) are truly frontend-agnostic by exercising them from a second
  frontend alongside `pi-action`.
- Give contributors a fast inner-loop for testing prompt, tool, and orchestrator
  changes against real repos without pushing commits that trigger CI.


## 3. Package layout

```
packages/
├── pi-orchestrator/          ← unchanged
├── pi-platform-github/       ← unchanged (CLI consumes it)
├── pi-action/                ← unchanged
└── pi-cli/                   ← NEW
    ├── package.json
    ├── README.md
    ├── src/
    │   ├── index.ts          ← bin entry: parses argv, dispatches commands
    │   ├── commands/
    │   │   ├── run.ts        ← `pi-cli run "<prompt>"` (free-form prompt)
    │   │   ├── review.ts     ← `pi-cli review [--pr N]` (PR review)
    │   │   └── thread.ts     ← `pi-cli thread [--issue N | --pr N]` (read-only)
    │   ├── auth.ts           ← resolve GitHub token from --token / GITHUB_TOKEN / gh CLI / keychain
    │   ├── octokit.ts        ← build Octokit directly via @octokit/rest (no @actions/github)
    │   ├── context.ts        ← build PlatformContext from CLI args + git remote inspection
    │   ├── adapters/
    │   │   ├── logger.ts     ← Logger impl: pino or console-based, with --verbose/--quiet
    │   │   ├── output-sink.ts← OutputSink impl: writes outputs to stdout JSON, files, or /dev/null
    │   │   └── pi-agent.ts   ← PiAgentFactory: wires AgentEvents → stdout (TTY-aware)
    │   └── version.ts
    └── tests/
        ├── auth.spec.ts
        ├── context.spec.ts
        ├── commands/
        └── adapters/
```

### 3.1 `package.json` sketch

```json
{
  "name": "@alexanderfortin/pi-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "pi-cli": "./src/index.ts"
  },
  "main": "./src/index.ts",
  "dependencies": {
    "@alexanderfortin/pi-orchestrator": "workspace:*",
    "@alexanderfortin/pi-platform-github": "workspace:*",
    "@actions/github": "^9.1.1",
    "@octokit/rest": "^22.0.0",
    "@earendil-works/pi-coding-agent": "^0.78.0",
    "@earendil-works/pi-ai": "^0.78.0",
    "@earendil-works/pi-agent-core": "^0.78.0",
    "@js-temporal/polyfill": "^0.5.1"
  },
  "devDependencies": {
    "commander": "^14.0.0"
  }
}
```

Notes:

- We import `@actions/github` only for the **type** of `getOctokit()`'s return
  value (matches `GitHubPlatformDeps.octokit` structurally). We never call into
  `@actions/github` at runtime — we build the Octokit directly via `@octokit/rest`
  so the CLI works on plain Node/Bun installs without the GH Actions runner.
- `commander` is the only new runtime dep we propose. Alternatives (`clipanion`,
  `citty`, hand-rolled) work too — pick what fits the project's style.

### 3.2 Workspace wiring

- Add `"@alexanderfortin/pi-cli": "workspace:*"` references where needed (the
  CLI depends on the orchestrator + github platform packages, which are already
  workspace siblings).
- `pi-cli` does **not** need a build step for development. It can ship as raw
  TS like the other workspace packages; users install via
  `bunx @alexanderfortin/pi-cli` or `npx @alexanderfortin/pi-cli`, which
  resolves through the published `bin` field.
- For npm publish we'll need a small esbuild bundle step similar to
  `packages/pi-action/scripts/package.ts` — to be added in milestone 4.

---

## 4. CLI surface

Inspired by `gh` and `pi`, but **scoped to what the orchestrator already
supports**. The two foundational commands are `run` (free-form prompt) and
`review` (PR review that posts back). Build on top of Bun runtime.

### 4.1 `pi-cli run "<prompt>"`

The generic entry point. Mirrors what the GitHub Action does when triggered
with a `/pi <prompt>` comment.

```
pi-cli run "fix the failing tests in tests/e2e/pi-agent.spec.ts" \
  --repo shaftoe/pi-coding-agent-action \
  --issue 233 \
  --post-comment
```

Flags:

| Flag                                  | Type   | Default                                  | Description                                                                    |
| ------------------------------------- | ------ | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `--repo <owner/repo>`                 | string | derived from `git remote get-url origin` | Target repository                                                              |
| `--issue <N>`                         | int    | _none_                                   | If set, prompt is appended as a comment; orchestrator runs in issue context    |
| `--pr <N>`                            | int    | _none_                                   | If set, runs in PR context (enables PR-diff, review, CI tools)                 |
| `--post-comment`                      | bool   | `false`                                  | Post the agent's final reply as a comment on the issue/PR                      |
| `--add-reaction`                      | bool   | `false`                                  | Add 👀 reaction before running, remove it after (mirrors the action)           |
| `--token <tok>`                       | string | see [§6](#6-authentication)              | GitHub token                                                                   |
| `--provider <id>`                     | string | required                                 | LLM provider id (same as action input)                                         |
| `--model <id>`                        | string | required                                 | LLM model id                                                                   |
| `--thinking <off\|low\|medium\|high>` | string | `off`                                    | Thinking level                                                                 |
| `--extensions <list>`                 | string | _none_                                   | Comma- or newline-separated extension sources (same semantics as action input) |
| `--load-builtin-extensions <bool>`    | bool   | `true`                                   | Load the built-in PR/review/CI tools                                           |
| `--loaded-tools <list>`               | string | _all_                                    | Restrict tool allowlist (same semantics as action input)                       |
| `--base-url <url>`                    | string | _none_                                   | Override provider base URL                                                     |
| `--export-session-html <path>`        | path   | _none_                                   | Write session HTML to file                                                     |
| `--export-session-jsonl <path>`       | path   | _none_                                   | Write session JSONL to file                                                    |
| `--auto-compaction`                   | bool   | `false`                                  | Enable Pi auto-compaction                                                      |
| `--diff-max-lines N`                  | int    | _SDK default_                            | Diff truncation                                                                |
| `--diff-max-bytes N`                  | int    | _SDK default_                            | Diff truncation                                                                |
| `--diff-ignore-patterns <list>`       | string | _none_                                   | Diff ignore patterns                                                           |
| `--system-prompt <text\|@file>`       | string | _CLI default_                            | Override system prompt; `@file` reads from disk                                |
| `--cwd <path>`                        | path   | `process.cwd()`                          | Working directory for the agent                                                |
| `--server-url <url>`                  | string | derived from repo URL                    | GitHub/Codeberg/Forgejo server URL (drives `detectPlatform`)                   |
| `--trigger <cmd>`                     | string | `/pi`                                    | Trigger prefix (used by the platform provider when stripping it from comments) |
| `--branch-name-template <tpl>`        | string | _default_                                | Override the branch name template                                              |
| `--out <stdout\|json\|none>`          | string | `stdout`                                 | How to emit orchestrator outputs (response, tokens, cost)                      |
| `--verbose` / `--quiet`               | bool   | _default_                                | Log level                                                                      |

### 4.2 `pi-cli review [--pr N]`

Convenience command for "review this PR" — equivalent to:

```
pi-cli run "Review this pull request" --pr N --post-comment
```

but with a CLI-specific system prompt focused on PR review and defaults that
make sense for local use (e.g. `--post-comment` defaults to `false`, so the
review lands on stdout unless the user explicitly opts in).

### 4.3 `pi-cli thread [--pr N | --issue N]`

Read-only helper that fetches and prints the issue/PR thread (the same data
the agent consumes via `get_issue_or_pr_thread`). Useful for debugging prompts
without spending tokens.

### 4.4 Global flags

```
pi-cli --help
pi-cli --version
pi-cli --repo owner/repo ...      # applies to all subcommands
pi-cli --token <tok> ...           # applies to all subcommands
```

### 4.5 Defaults and derivation

The CLI is designed to "just work" with no flags when run from inside a git
checkout:

- `--repo`: parsed from `git remote get-url origin`.
- `--server-url`: derived from the remote URL's host (github.com → github,
  codeberg.org → codeberg, etc., using the existing `detectPlatform()` helper).
- `--token`: see §6.
- `--cwd`: current working directory.

When invoked outside a git repo, `--repo` becomes mandatory and the CLI exits
with a clear error.

---

## 5. PlatformProvider construction

The CLI builds the deps bag that `pi-action/run.ts` currently constructs
around `github.context`. Concretely:

```ts
// packages/pi-cli/src/context.ts
import { detectPlatform } from '@alexanderfortin/pi-platform-github';
import type { PlatformContext } from '@alexanderfortin/pi-orchestrator';

export interface CliContextArgs {
  repo: { owner: string; repo: string }; // from --repo or git remote
  issueOrPr: { number: number; isPr: boolean }; // from --issue / --pr
  eventName: string; // 'cli' or 'issue_comment' if posting
  serverUrl: string; // from --server-url or remote
  workspace: string; // from --cwd
  actor?: string; // current git user.name or $GITHUB_USER
  sha?: string; // current HEAD
  payload: Record<string, unknown>; // minimal stub for context-utils
}

export function buildPlatformContext(args: CliContextArgs): PlatformContext {
  return {
    repo: args.repo,
    issue: { number: args.issueOrPr.number },
    eventName: args.eventName,
    payload: args.payload,
    serverUrl: args.serverUrl,
    runId: process.pid, // CLI has no runId; use pid as opaque token
    workspace: args.workspace,
    ...(args.actor !== undefined ? { actor: args.actor } : {}),
    ...(args.sha !== undefined ? { sha: args.sha } : {}),
  };
}
```

`PlatformContext.eventName` is consumed by `getContextType()` in
`pi-platform-github/src/context-utils.ts` to decide whether we're in issue or
PR mode. The CLI sets it to either:

- `'issue_comment'` when `--issue` is passed (or `--pr` with intent to comment),
- `'pull_request_review_comment'` when reviewing a PR inline comment,
- `'cli'` (new) — needs a tiny tweak in `getContextType()` to treat `'cli'`
  like the appropriate context based on whether `--pr` or `--issue` was given.

**Note:** We propose adding `'cli'` support to `getContextType()` in
`pi-platform-github` as a small prerequisite change. Alternatively, the CLI
can simply map to the closest existing event name (`issue_comment` or
`pull_request`) so no library change is required. We prefer the explicit
`'cli'` route because it makes audit logs unambiguous.

The provider is then constructed exactly as in `pi-action/run.ts`:

```ts
const provider = createGitHubPlatformProvider({
  octokit,
  context: buildPlatformContext(args),
  logger,
  platformType: detectPlatform(args.serverUrl),
  trigger: args.trigger,
  branchNameTemplate: args.branchNameTemplate,
});
```

---

## 6. Authentication

The CLI resolves a GitHub token in this order (first match wins):

1. `--token <tok>` on the command line.
2. `PI_CLI_GITHUB_TOKEN` env var (CLI-specific, avoids clashing with the
   GitHub Action's `INPUT_GITHUB_TOKEN`).
3. `GITHUB_TOKEN` env var (standard convention).
4. `gh auth token` — shell out to the GitHub CLI if installed. This is what
   most local devs will rely on.
5. Fail with a clear error: "No GitHub token found. Pass `--token`, set
   `GITHUB_TOKEN`, or run `gh auth login`."

Tokens need at minimum `repo` scope for `--post-comment`, `--add-reaction`,
PR creation, and review posting. For read-only commands (`thread`, `run`
without posting) `public_repo` is enough for public repos.

The resolved token is never logged. The CLI calls `logger.setSecret()` (or
just `console.warn`s on debug builds) if the user passes `--token` on the
command line, since argv is visible to other users on the host via `ps`.

### 6.1 Octokit construction

The CLI builds the Octokit directly from `@octokit/rest` + the
`@octokit/plugin-rest-endpoint-methods` plugin that the rest of the
codebase relies on:

```ts
// packages/pi-cli/src/octokit.ts
import { Octokit } from '@octokit/rest';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

export function createCliOctokit(token: string, baseUrl?: string) {
  const OctokitWithRest = Octokit.plugin(restEndpointMethods);
  return new OctokitWithRest({
    auth: token,
    ...(baseUrl ? { baseUrl } : {}),
  });
}
```

`GitHubPlatformDeps.octokit` is typed as
`ReturnType<typeof import('@actions/github').getOctokit>`, which itself
returns an Octokit with `restEndpointMethods` plugin applied. The structurally
compatible `@octokit/rest`-built instance will satisfy the type at the
boundary (TS uses structural typing). If TS complains in practice, we can
either:

- widen `GitHubPlatformDeps.octokit` to the actual `@octokit/rest` Octokit
  type (small library tweak in `pi-platform-github`), or
- cast at the boundary (uglier but no library change).

**Recommendation:** widen the type in `pi-platform-github` — it's a minor
breaking change confined to one type alias and removes the last
`@actions/github` import (even if type-only) from the library.

---

## 7. Adapters

The CLI ships three small adapter files, mirroring `pi-action/adapters/`:

### 7.1 `Logger` — `adapters/logger.ts`

```ts
export class CliLogger implements Logger {
  constructor(private level: 'debug' | 'info' | 'warn' | 'error') {}
  debug(msg: string) {
    if (this.level === 'debug') console.error(`[debug] ${msg}`);
  }
  info(msg: string) {
    console.error(msg);
  } // to stderr, doesn't pollute --out stdout
  warning(msg: string) {
    console.error(`⚠ ${msg}`);
  }
  notice(msg: string) {
    console.error(msg);
  }
  error(msg: string) {
    console.error(`✖ ${msg}`);
  }
  startGroup?(t: string) {
    console.error(`▸ ${t}`);
  }
  endGroup?() {
    /* no-op, or print an empty line */
  }
}
```

All logging goes to **stderr** so it doesn't pollute the JSON/stdout output
of the orchestrator. `startGroup`/`endGroup` print a simple `▸ Title` header
without ANSI escape sequences when not in a TTY.

### 7.2 `OutputSink` — `adapters/output-sink.ts`

```ts
export class CliOutputSink implements OutputSink {
  private outputs: Record<string, string | number | boolean> = {};
  private failed?: Error;

  setOutput(name: string, value: string | number | boolean) {
    this.outputs[name] = value;
  }
  setFailed(error: Error) {
    this.failed = error;
  }
  getExportDirectory(format: 'html' | 'jsonl'): string {
    return path.join(os.tmpdir(), `pi-cli-${format}-${process.pid}`);
  }

  /** Called by the CLI after orchestrator.execute() to render results. */
  flush(mode: 'stdout' | 'json' | 'none') {
    if (this.failed) {
      console.error(`✖ ${this.failed.message}`);
      process.exitCode = 1;
      return;
    }
    if (mode === 'none') return;
    if (mode === 'json') {
      console.log(JSON.stringify(this.outputs, null, 2));
    } else {
      // stdout: only the `response` field, plain text
      if (typeof this.outputs.response === 'string') console.log(this.outputs.response);
    }
  }
}
```

### 7.3 `PiAgentFactory` — `adapters/pi-agent.ts`

Almost identical to `packages/pi-action/src/adapters/pi-agent-adapter.ts`,
with two differences:

1. **No `PI_PACKAGE_DIR` manipulation.** The CLI runs from a normal
   `node_modules/` layout so the SDK finds its own package directory.
2. **AgentEvents routed to stderr when not a TTY** (so piping works) or to
   a styled spinner when a TTY is available. We can start with the simpler
   "always stderr" approach and add TUX/spinner polish later.

### 7.4 `GitAdapter`

We reuse the same approach as `pi-action/adapters/git-adapter.ts` — a thin
adapter that delegates the four `GitAdapter` methods
(`addReaction`, `deleteReaction`, `createFinalComment`, `getPrompt`,
`getStartTime`) to the injected `PlatformProvider`. Since `PlatformProvider`
already implements all of those, the CLI's `GitAdapter` is a one-liner proxy
identical to the action's. Worth factoring out into a shared helper in
`pi-orchestrator` (see §11.1).

---

## 8. System prompt

The default system prompt in `pi-orchestrator/src/pi/prompt.ts` is tuned for
GitHub Actions: "non-interactive assistant running in GitHub Actions CI/CD
environment... output will be sent back as comment".

For the CLI we ship a sibling default prompt that reflects the local context:

```
You are an AI coding assistant invoked from a developer's terminal. The
current working directory is a git checkout; you have access to the same
PR/issue/CI tools as the GitHub Action version of this agent. Output will be
printed to the terminal by default; if --post-comment was set it will also
be posted as a comment on the referenced issue or PR. Be concise: the user
is reading your output in a terminal, not a browser.
```

The user can pass `--system-prompt <text|@file>` to override it. The
override flows through the existing `ResourceLoaderConfig.systemPrompt`
plumbing, so no library change is needed.

---

## 9. Integration with the orchestrator

Wiring everything together looks like:

```ts
// packages/pi-cli/src/commands/run.ts
import { ActionOrchestrator } from '@alexanderfortin/pi-orchestrator';
import { createGitHubPlatformProvider, detectPlatform } from '@alexanderfortin/pi-platform-github';
import { CliLogger } from '../adapters/logger.js';
import { CliOutputSink } from '../adapters/output-sink.js';
import { createCliPiAgent } from '../adapters/pi-agent.js';
import { createCliOctokit } from '../octokit.js';
import { buildPlatformContext } from '../context.js';
import { resolveToken } from '../auth.js';
import { GitAdapterFromProvider } from '../adapters/git-adapter.js';
import { buildConfig } from '../config.js';

export async function runCommand(args: CliArgs) {
  const token = resolveToken(args);
  const octokit = createCliOctokit(token, args.baseUrl);
  const logger = new CliLogger(args.logLevel);
  const outputSink = new CliOutputSink();
  const context = buildPlatformContext(args);
  const provider = createGitHubPlatformProvider({
    octokit,
    context,
    logger,
    platformType: detectPlatform(args.serverUrl),
    trigger: args.trigger,
    branchNameTemplate: args.branchNameTemplate,
  });
  const git = new GitAdapterFromProvider(provider);
  const config = buildConfig(args); // builds a plain PiConfig from CLI args
  const orchestrator = new ActionOrchestrator(
    config,
    logger,
    outputSink,
    git,
    createCliPiAgent,
    provider
  );
  try {
    await orchestrator.execute();
  } finally {
    outputSink.flush(args.outMode);
  }
}
```

`buildConfig(args)` produces a `PiConfig` with `promptInput` populated from
the positional prompt argument. If `--issue`/`--pr` is given, the
`PlatformProvider.getPrompt()` flow still runs (so the orchestrator can
resolve the latest comment body), and the positional prompt is passed as
`config.promptInput` override — matching the action's behavior when both an
issue context and an input prompt are present.

---

## 10. Distribution

### 10.1 Initial: workspace-only

For the first milestone, the package is `private: true` and used only via
`bun run` / `bunx` from the monorepo. No npm publish.

### 10.3 Versioning

Same versioning as the action.

---

## 11. Prerequisite and opportunistic library changes

These are not strictly required for v0.1, but they fall out naturally from
this work and are worth calling out:

### 11.1 Promote `GitAdapterFromProvider` into `pi-orchestrator`

Both `pi-action/adapters/git-adapter.ts` and the new `pi-cli` adapter are
identical thin proxies from `PlatformProvider` to `GitAdapter`. This is dead
code duplication. Move a single `createGitAdapterFromProvider(provider):
GitAdapter` helper into `pi-orchestrator` and have both frontends use it.

### 11.2 Widen `GitHubPlatformDeps.octokit` type

Replace
`ReturnType<typeof import('@actions/github').getOctokit>` with the underlying
`@octokit/rest` Octokit type (with `restEndpointMethods` plugin applied). This
removes the last `@actions/github` import — even type-only — from
`pi-platform-github`, and lets the CLI build the Octokit directly without a
cast.

### 11.3 Promote `CliOutputSink`/`CliLogger` to a shared `frontends/` helper

module?

Probably not worth it yet. The two frontends (`pi-action`, `pi-cli`) differ
enough that sharing concrete classes is brittle. Keep the implementations
duplicated but the interfaces shared (which they already are).

---

## 12. Open questions

These are decisions for the maintainer / review:

1. **Command framework.** `commander` vs `citty` vs `clipanion` vs hand-rolled.
   Suggested default: `commander` (most familiar, smallest).
  => choose the most popular
2. **Stdin prompt input.** Should `pi-cli run -` read the prompt from stdin?
   Useful for piping; trivial to add. Suggest yes.
3. **`--dry-run` semantics.** Should it disable both `--post-comment` and
   PR creation, or just comment posting? The action already has a per-tool
   `dryRun` flag; we should align with it.
4. **Multi-issue mode.** Should `pi-cli run "..." --issue 1 --issue 2` fan
   out to multiple issues? => not for now
5. **Config file.** `~/.pi/cli.toml`
6. **Streaming output.** Should agent thinking deltas stream to stderr in
   real time (action behavior) or be suppressed unless `--verbose`? Suggest
   stream by default when stderr is a TTY, suppress when piped.
7. **Where does `pi-cli` advertise its relationship to the action?** README
   of the package should link to the action's README and vice versa.

---

## 13. Implementation milestones

Each milestone is independently mergeable and leaves the repo green.

| #      | Milestone                                                                                                                                                                                           | Deliverable                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **M1** | Package skeleton + `pi-cli run` end-to-end against a real repo with a personal token, no flags beyond `--repo`, `--provider`, `--model`, `--token`. Output to stdout.                               | `pi-cli run "hello"` works.               |
| **M2** | Full flag matrix: `--pr`, `--issue`, `--post-comment`, `--add-reaction`, `--system-prompt`, `--export-session-*`, all diff flags, `--verbose`/`--quiet`, `--out`.                                   | All action inputs reachable from the CLI. |
| **M3** | `review` and `thread` subcommands; remote URL auto-detection; `gh auth token` fallback; widen Octokit type in `pi-platform-github`; promote shared `GitAdapterFromProvider` into `pi-orchestrator`. | Local dev UX parity with the action.      |
| **M4** | Bundling via esbuild; `private: false`; npm publish as `@alexanderfortin/pi-cli`; README; Homebrew tap optional.                                                                                    | First public release.                     |

Estimated effort (rough): M1 + M2 ~ 1.5 days, M3 ~ 1 day, M4 ~ 0.5 day.

---

## 14. Risks

1. **`PlatformContext.eventName` assumptions.** The orchestrator and
   `context-utils.ts` switch on event names like `'issue_comment'` and
   `'pull_request'`. Adding `'cli'` is low risk but needs explicit handling
   - a test. Alternatively, the CLI can pass the canonical GH event name
     that best matches the operation (no library change).
2. **Octokit type drift.** If `@actions/github.getOctokit` and a hand-built
   `@octokit/rest` Octokit drift apart structurally in future versions, the
   boundary cast/widening in §6.1 might need rework. Widening the library
   type up front (§11.2) eliminates this risk.
3. **Token leakage.** Tokens on the command line are visible via `ps`. The
   CLI should warn loudly when `--token` is used and prefer env var / `gh`
   auth.
4. **Footprint.** Bringing in `commander` + `@octokit/rest` adds bundle size
   to the CLI; since the CLI is published as a separate package this does
   not affect the action's `dist/index.js`.
5. **Feature drift.** Two frontends means every new orchestrator input needs
   to be surfaced in three places: action `action.yml`, CLI flags, and
   `PiConfig`. Acceptable cost; could be reduced with a schema-driven config
   generator later.

---

## 15. Out of scope (follow-up RFCs)

- Interactive REPL (`pi-cli chat`).
- GitHub App / webhook frontend (`packages/pi-app`).
- Web UI for streaming agent runs.
- Schema-driven flag generation from a single declarative config definition
  shared between `action.yml` and the CLI.

---

## 16. Acceptance criteria for this RFC

This RFC is accepted when:

- [ ] Maintainer signs off on the package layout (§3), CLI surface (§4), and
      distribution plan (§10).
- [x] Open questions in §12 have a resolution recorded inline.
- [ ] A sub-issue is filed for M1 with concrete file list and test plan.

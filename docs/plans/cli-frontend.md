# RFC: `pi-cli` — A CLI Frontend for the Pi Orchestrator

**Status:** M1 shipped (this branch). M2–M4 planned.
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

Actual M1 layout (shipped):

```
packages/
├── pi-orchestrator/          ← unchanged
├── pi-platform-github/       ← §11.2 type widening shipped as part of M1
├── pi-action/                ← unchanged
└── pi-cli/                   ← NEW
    ├── package.json
    ├── README.md
    ├── src/
    │   ├── index.ts                ← bin entry: parses argv with `commander`, dispatches commands
    │   ├── commands/
    │   │   └── run.ts              ← `pi-cli run "<prompt>"` (M1)
    │   │   ├── review.ts           ← M3
    │   │   └── thread.ts           ← M3
    │   ├── auth.ts                 ← env-var-only token resolution (GitHub + provider)
    │   ├── octokit.ts              ← build Octokit via @octokit/core + rest-endpoint-methods plugin
    │   ├── context.ts              ← parseRepoFlag + buildPlatformContext (eventName: 'cli' sentinel)
    │   ├── config.ts               ← gatherCliConfig → PiConfig
    │   ├── pi/
    │   │   └── default-system-prompt.ts ← CLI_DEFAULT_SYSTEM_PROMPT (terminal-tuned)
    │   └── adapters/
    │       ├── logger.ts           ← CliLogger: level-filtered, all → stderr
    │       ├── output-sink.ts      ← CliOutputSink: stdout/json/none modes
    │       ├── pi-agent.ts         ← PiAgentFactory: AgentEvents → stderr
    │       └── git-adapter.ts      ← thin proxy over PlatformProvider (duplicated from action)
    └── tests/
        ├── auth.spec.ts            ← 16 tests: token resolution + provider→env table
        ├── context.spec.ts         ← 16 tests: parseRepoFlag + buildPlatformContext
        └── adapters/
            └── logger.spec.ts      ← 7 tests: level filtering + stderr routing
        ├── context.spec.ts
        ├── commands/
        └── adapters/
```

### 3.1 `package.json` sketch

What shipped in M1:

```json
{
  "name": "@alexanderfortin/pi-cli",
  "version": "2.19.3",
  "private": true,
  "description": "Terminal frontend for the Pi orchestrator...",
  "type": "module",
  "bin": {
    "pi-cli": "./src/index.ts"
  },
  "main": "./src/index.ts",
  "dependencies": {
    "@alexanderfortin/pi-orchestrator": "workspace:*",
    "@alexanderfortin/pi-platform-github": "workspace:*",
    "@earendil-works/pi-coding-agent": "^0.78.1",
    "@earendil-works/pi-ai": "^0.78.1",
    "@earendil-works/pi-agent-core": "^0.78.1",
    "@js-temporal/polyfill": "^0.5.1",
    "@octokit/core": "^7.0.3",
    "@octokit/plugin-rest-endpoint-methods": "^17.0.0",
    "commander": "^14.0.0"
  }
}
```

Notes:

- Version is kept in lockstep with the other workspace packages (all currently
  `2.19.3`). `bun run sync-versions` keeps them aligned on release.
- The CLI uses `@octokit/core` directly (not `@octokit/rest`), which is the
  minimum needed since `pi-platform-github`'s widened `OctokitInstance` type is
  derived from `Octokit.plugin(restEndpointMethods)`.
- `@actions/github` is **not** a dependency of `pi-cli`. The §11.2 type widening
  (shipped in M1) removed the last `@actions/github` import from
  `pi-platform-github`, so the CLI builds Octokit directly.
- `commander` is a runtime dep (not devDep) since it ships with the bin.
  Resolution of open question §12.1: chose `commander` as the most popular
  Node CLI framework.

### 3.2 Workspace wiring

- Add `"@alexanderfortin/pi-cli": "workspace:*"` references where needed (the
  CLI depends on the orchestrator + github platform packages, which are already
  workspace siblings).
- Root `package.json` gets a `"pi-cli": "bun packages/pi-cli/src/index.ts"`
  script so contributors can run `bun pi-cli run "hello" ...` from the repo
  root without `bunx --filter`.
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
  --post-comment          # --issue and --post-comment land in M2
```

**M1 flags shipped** (the only ones that exist today):

| Flag                       | Type   | Default             | Description                                                                 |
| -------------------------- | ------ | ------------------- | --------------------------------------------------------------------------- |
| `<prompt>` (positional)    | string | _required_          | The instruction to send to the agent.                                       |
| `--repo <owner/repo>`      | string | _required_ (M3: derived from `git remote get-url origin`) | Target repository                            |
| `--provider <id>`          | string | _required_          | LLM provider id — see [provider env table](#6-authentication)               |
| `--model <id>`             | string | _required_          | LLM model id                                                                |
| `--cwd <path>`             | path   | `process.cwd()`     | Working directory for the agent                                             |
| `--server-url <url>`       | string | `https://github.com` | Git host URL. Drives `detectPlatform()` and Octokit base URL              |
| `--verbose`                | bool   | off                 | Show debug-level logs on stderr. Mutually exclusive with `--quiet`.         |
| `--quiet`                  | bool   | off                 | Suppress all logs except errors on stderr. Mutually exclusive with `--verbose`. |

**M2 will add**: `--pr`, `--issue`, `--post-comment`, `--add-reaction`,
`--system-prompt`, `--thinking`, `--extensions`, `--load-builtin-extensions`,
`--loaded-tools`, `--base-url`, `--export-session-html`, `--export-session-jsonl`,
`--auto-compaction`, `--diff-max-lines`, `--diff-max-bytes`, `--diff-ignore-patterns`,
`--trigger`, `--branch-name-template`, `--out <stdout|json|none>`.

**Auth is env-var-only** — there is no `--token` flag. See §6.

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
pi-cli --version        # M2 (currently inferred from package.json)
pi-cli run --help
```

Note: `--verbose` and `--quiet` are declared on each subcommand (only `run`
in M1) rather than the parent program, because `commander` doesn't propagate
parent options to subcommands by default.

### 4.5 Defaults and derivation

The CLI is designed to "just work" with no flags when run from inside a git
checkout — but in M1, `--repo` is **mandatory** (auto-detection from
`git remote get-url origin` lands in M3).

- `--repo`: M3 will parse it from `git remote get-url origin`. M1: required flag.
- `--server-url`: M3 will derive from the remote URL's host. M1: defaults to
  `https://github.com`.
- GitHub token: `GITHUB_TOKEN` → `GH_TOKEN` (no flag, no `gh auth` fallback).
- Provider token: provider-specific env var (see §6 table).
- `--cwd`: current working directory.

---

## 5. PlatformProvider construction

The CLI builds the deps bag that `pi-action/run.ts` currently constructs
around `github.context`. What shipped in M1 (`packages/pi-cli/src/context.ts`):

```ts
export const CLI_EVENT_NAME = 'cli';  // sentinel — see note below

export interface CliContextArgs {
  repo: RepoRef;                  // from parseRepoFlag(--repo)
  workspace: string;              // from --cwd
  serverUrl: string;              // from --server-url
  actor?: string;                 // current git user.name (M3)
  sha?: string;                   // current HEAD (M3)
}

export function buildPlatformContext(args: CliContextArgs): PlatformContext {
  return {
    repo: args.repo,
    issue: { number: 0 },          // sentinel: createComment() no-ops on falsy
    eventName: CLI_EVENT_NAME,     // sentinel: see §14.1
    payload: {},                   // empty: addReaction() no-ops
    serverUrl: args.serverUrl,
    runId: process.pid,            // CLI has no runId; use pid as opaque token
    workspace: args.workspace,
    ...(args.actor !== undefined ? { actor: args.actor } : {}),
    ...(args.sha !== undefined ? { sha: args.sha } : {}),
  };
}
```

`PlatformContext.eventName` is consumed by `getContextType()` in
`pi-platform-github/src/context-utils.ts` to decide whether we're in issue or
PR mode.

**M1 implementation:** the CLI passes `eventName: 'cli'` as a sentinel. No
library change is needed because the platform provider already defends against
unknown event names:

- `addReaction()` no-ops when `payload.comment?.id` is missing.
- `createComment()` no-ops when `issue.number` is falsy (M1 uses `0`).
- `getStartTimeFromContext()` returns `undefined` for unknown event names.
- `getContextType()` returns `undefined` for unknown event names, which also
  disables prompt enrichment.

A later milestone (likely M3, alongside `--pr`/`--issue` support) may promote
`'cli'` to a first-class event name in `getContextType()` so audit logs become
unambiguous. Until then, the sentinel approach lets M1 ship with zero
library changes to `context-utils.ts`.

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

**Two distinct tokens, both env-var-only, no flags, no `gh auth token`
fallback.** This diverges from the original draft (which proposed `--token`
and `gh auth` fallback) — see §12.3 for the resolution.

| Concern              | Env var precedence (first match wins)                     |
| -------------------- | --------------------------------------------------------- |
| **GitHub API**       | `GITHUB_TOKEN` → `GH_TOKEN`                               |
| **LLM provider API** | provider-specific (see table below)                       |

### 6.1 GitHub token

Resolved from `GITHUB_TOKEN` first, then `GH_TOKEN`. Missing both throws:

```
✖ Missing GitHub token. Set GITHUB_TOKEN (or GH_TOKEN) in your environment and retry.
```

Tokens need at minimum `repo` scope for `--post-comment` (M2), `--add-reaction`
(M2), PR creation, and review posting. For read-only commands (`thread` in M3,
or `run` without posting) `public_repo` is enough for public repos.

### 6.2 LLM provider token

Resolved from a provider-specific env var. The mapping is the canonical table
from `pi/docs/providers.md` → "Authentication":

| Provider id                | Env var                  |
| -------------------------- | ------------------------ |
| `anthropic`                | `ANTHROPIC_API_KEY`      |
| `openai`                   | `OPENAI_API_KEY`         |
| `google`                   | `GEMINI_API_KEY`         |
| `deepseek`                 | `DEEPSEEK_API_KEY`       |
| `groq`                     | `GROQ_API_KEY`           |
| `zai`                      | `ZAI_API_KEY`            |
| `mistral`                  | `MISTRAL_API_KEY`        |
| `xai`                      | `XAI_API_KEY`            |
| `openrouter`               | `OPENROUTER_API_KEY`     |
| `huggingface`              | `HF_TOKEN`                |
| `together`                 | `TOGETHER_API_KEY`       |
| `fireworks`                | `FIREWORKS_API_KEY`      |
| `cerebras`                 | `CEREBRAS_API_KEY`       |
| `nvidia`                   | `NVIDIA_API_KEY`         |
| `azure-openai-responses`   | `AZURE_OPENAI_API_KEY`   |
| `cloudflare-ai-gateway`    | `CLOUDFLARE_API_KEY`     |
| `cloudflare-workers-ai`    | `CLOUDFLARE_API_KEY`     |
| `vercel-ai-gateway`        | `AI_GATEWAY_API_KEY`     |
| `opencode`, `opencode-go`  | `OPENCODE_API_KEY`       |
| `kimi-coding`              | `KIMI_API_KEY`           |
| `minimax`                  | `MINIMAX_API_KEY`        |
| `minimax-cn`               | `MINIMAX_CN_API_KEY`     |
| `xiaomi`                   | `XIAOMI_API_KEY`         |
| `xiaomi-token-plan-cn`     | `XIAOMI_TOKEN_PLAN_CN_API_KEY` |
| `ant-ling`                 | `ANT_LING_API_KEY`       |
| `zai-coding-cn`            | `ZAI_CODING_CN_API_KEY`  |

(Full table lives in `packages/pi-cli/src/auth.ts` as `PROVIDER_ENV_VARS`.)

Missing env var throws:

```
✖ Missing API token for provider 'anthropic'. Set ANTHROPIC_API_KEY in your environment and retry.
```

Unknown provider id throws:

```
✖ Unknown provider 'bogus'. Check the supported list at https://docs.pi.dev/providers.
```

### 6.3 Octokit construction

The CLI builds the Octokit directly from `@octokit/core` + the
`@octokit/plugin-rest-endpoint-methods` plugin. See the §6.1 code in the
shipped `packages/pi-cli/src/octokit.ts`.

The §11.2 widening (shipped as part of M1) lets the hand-built Octokit
satisfy `GitHubPlatformDeps.octokit` structurally with no cast.

---

## 7. Adapters

The CLI ships three small adapter files, mirroring `pi-action/adapters/`:

### 7.1 `Logger` — `adapters/logger.ts`

Level filtering uses a numeric severity ranking:

```
error   = 0
warning = 1
notice  = 2
info    = 3
debug   = 4
```

A message is emitted iff `messageSeverity <= configuredLevel`. Default level
is **`warning`** so the orchestrator's startup banner (`running action v...`)
and session `════` separators are invisible unless `--verbose` is passed.

```ts
export class CliLogger implements Logger {
  constructor(level: 'error' | 'warning' | 'notice' | 'info' | 'debug') { /* ... */ }

  debug(msg)   { /* emitted only if level >= debug */ }
  info(msg)    { /* emitted only if level >= info  */ }
  warning(msg) { /* emitted only if level >= warning (default) */ }
  notice(msg)  { /* emitted only if level >= notice */ }
  error(msg)   { /* always emitted */ }
  startGroup?(t) { process.stderr.write(`▸ ${t}\n`); }
  endGroup?()    { /* no-op: keep output compact for terminal use */ }
}
```

All logging goes to **stderr** so it doesn't pollute the response on stdout.
`startGroup`/`endGroup` print a simple `▸ Title` header without ANSI escape
sequences so the output is safe to pipe.

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

What shipped in M1 (`packages/pi-cli/src/commands/run.ts`, slightly simplified):

```ts
import { ActionOrchestrator } from '@alexanderfortin/pi-orchestrator';
import { createGitHubPlatformProvider, detectPlatform } from '@alexanderfortin/pi-platform-github';
import { CliGitAdapter } from '../adapters/git-adapter.js';
import { CliLogger } from '../adapters/logger.js';
import { CliOutputSink } from '../adapters/output-sink.js';
import { createCliPiAgent } from '../adapters/pi-agent.js';
import { resolveGitHubToken, resolveProviderToken } from '../auth.js';
import { buildPlatformContext, parseRepoFlag } from '../context.js';
import { gatherCliConfig } from '../config.js';
import { createCliOctokit } from '../octokit.js';

export async function runCommand(args: RunCommandArgs): Promise<void> {
  const level = resolveLogLevel(args);             // verbose/quiet mutex check
  const logger = new CliLogger(level);
  const outputSink = new CliOutputSink();

  // --- Auth (env-var-only) ------------------------------------------------
  const githubToken = resolveGitHubToken();
  const providerToken = resolveProviderToken(args.provider);

  // --- Octokit + platform provider (eventName: 'cli' sentinel) ------------
  const repo = parseRepoFlag(args.repo);
  const octokit = createCliOctokit(githubToken, args.serverUrl);
  const platformContext = buildPlatformContext({
    repo, workspace: args.cwd, serverUrl: args.serverUrl,
  });
  const provider = createGitHubPlatformProvider({
    octokit, context: platformContext, logger,
    platformType: detectPlatform(args.serverUrl),
  });
  const git = new CliGitAdapter(provider);

  // --- Config + orchestrator ----------------------------------------------
  const config = gatherCliConfig(
    { prompt: args.prompt, provider: args.provider, model: args.model, cwd: args.cwd },
    providerToken,
  );
  const orchestrator = new ActionOrchestrator(
    config, logger, outputSink, git, createCliPiAgent, provider,
  );

  // finally (not catch+rethrow): orchestrator errors are routed via the
  // OutputSink, which sets process.exitCode. Setup errors (auth, --repo
  // validation, mutex) throw before this block and bubble to main()'s
  // outer catch.
  try {
    await orchestrator.execute();
  } finally {
    outputSink.flush('stdout');
  }
}
```

M2 will pass `trigger` and `branchNameTemplate` into `createGitHubPlatformProvider`
when the corresponding flags land. M1 leaves both at library defaults.

`gatherCliConfig(args, providerToken)` produces a `PiConfig` with `promptInput`
populated from the positional prompt argument, `systemPrompt` set to
`CLI_DEFAULT_SYSTEM_PROMPT` (see §8), and M2-controlled fields
(`extensions`, `loadedTools`, `exportSession*`, `thinkingLevel`, etc.) defaulted
to M1-safe values.

---

## 10. Distribution

### 10.1 Initial: workspace-only

For the first milestone, the package is `private: true` and used only via
`bun run` / `bunx` from the monorepo. No npm publish.

### 10.3 Versioning

Same versioning as the action.

---

## 11. Prerequisite and opportunistic library changes

### 11.1 Promote `GitAdapterFromProvider` into `pi-orchestrator`

Both `pi-action/adapters/git-adapter.ts` and the new `pi-cli` adapter are
identical thin proxies from `PlatformProvider` to `GitAdapter`. This is dead
code duplication. Move a single `createGitAdapterFromProvider(provider):
GitAdapter` helper into `pi-orchestrator` and have both frontends use it.

**Status:** deferred to M3. M1 ships with a duplicated adapter (~30 lines);
promoting a shared helper before having two concrete instances to design the
signature against would be premature.

### 11.2 Widen `GitHubPlatformDeps.octokit` type — ✅ done in M1

Replaced `ReturnType<typeof import('@actions/github').getOctokit>` with
`InstanceType<typeof Octokit.plugin(restEndpointMethods)>` in
`pi-platform-github/src/types.ts:46` and `provider.ts:90`. `@actions/github`
moved from `peerDependencies` to `devDependencies` of `pi-platform-github`.
`@octokit/core` added as a direct dep.

This removes the last `@actions/github` import — even type-only — from
`pi-platform-github`, and lets the CLI build the Octokit directly without
a cast. Originally scoped for M3; folded into M1 because the cast alternative
was uglier than the 5-line prerequisite change.

### 11.3 Promote `CliOutputSink`/`CliLogger` to a shared `frontends/` helper module?

Probably not worth it yet. The two frontends (`pi-action`, `pi-cli`) differ
enough that sharing concrete classes is brittle. Keep the implementations
duplicated but the interfaces shared (which they already are).

---

## 12. Open questions — resolutions

1. **Command framework.** ✅ Resolved: **`commander`** (M1 ships with it as a
   runtime dep). Chose it as the most popular Node CLI framework; alternatives
   (`citty`, `clipanion`, hand-rolled) work too but `commander`'s familiarity
   wins.
2. **Stdin prompt input.** Deferred to M3. M1 keeps prompts strictly
   positional. `pi-cli run -` to read stdin is trivial to add later.
3. **`--dry-run` semantics.** Open. Will align with the action's existing
   per-tool `dryRun` flag (each tool that posts to GitHub accepts its own
   `dryRun` param) when M2 lands `--post-comment`.
4. **Multi-issue mode.** ✅ Resolved: **not for now.** `--issue` and `--pr`
   will be single-valued when M2 adds them.
5. **Config file.** Open. `~/.pi/cli.toml` is a sensible M3+ follow-up but not
   blocking.
6. **Streaming output.** ✅ Resolved: thinking deltas stream to **stderr
   unconditionally** (M1 implementation). The action writes them to stdout
   because GitHub Actions surfaces stdout as log lines; in a terminal,
   stdout-pollution would break piping. TTY-aware spinners are a polish item
   for later.
7. **Cross-link from README.** ✅ Resolved: the `pi-cli` README links back to
   the action's README, and the action README will gain a reciprocal link in a
   follow-up commit.

**Additional resolutions made during M1 grilling** (not in the original §12):

- **Auth is env-var-only** (overrides §6's original `--token` proposal). No
  `--token` flag, no `gh auth token` fallback, no keychain reads. Two distinct
  env vars: `GITHUB_TOKEN`/`GH_TOKEN` for GitHub, provider-specific for LLM.
- **Default log level is `warning`** (not `info`). Hides the orchestrator's
  startup banner and session separators unless `--verbose` is passed.
- **All workspace packages share the same version** (`2.19.3` at M1) rather
  than the CLI starting at `0.1.0`. `bun run sync-versions` keeps them aligned.
- **Package name + bin name**: `@alexanderfortin/pi-cli` / `pi-cli`. Invoked
  from a checkout via `bun pi-cli ...` (root npm script).
- **`--verbose` / `--quiet` are mutually exclusive.** Commander doesn't enforce
  this natively; `resolveLogLevel()` in `commands/run.ts` throws on conflict.

---

## 13. Implementation milestones

Each milestone is independently mergeable and leaves the repo green.

| #      | Milestone                                                                                                                                                                                                                                                                                                       | Deliverable                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **M1** ✅ | Package skeleton + `pi-cli run` end-to-end with env-var-only auth. Flags shipped: `<prompt>`, `--repo`, `--provider`, `--model`, `--cwd`, `--server-url`, `--verbose`, `--quiet`. §11.2 Octokit type widening folded in. Output to stdout (final response), thinking deltas to stderr. 38 new tests.            | `bun pi-cli run "hello" ...` works.          |
| **M2** | Full flag matrix: `--pr`, `--issue`, `--post-comment`, `--add-reaction`, `--system-prompt`, `--thinking`, `--extensions`, `--load-builtin-extensions`, `--loaded-tools`, `--base-url`, `--export-session-*`, `--auto-compaction`, all diff flags, `--out <stdout\|json\|none>`. First-class `'cli'` event name. | All action inputs reachable from the CLI.    |
| **M3** | `review` and `thread` subcommands; `git remote get-url origin` auto-detection for `--repo` and `--server-url`; `pi-cli run -` stdin input; promote shared `GitAdapterFromProvider` into `pi-orchestrator` (§11.1); possibly `~/.pi/cli.toml` config file.                                                          | Local dev UX parity with the action.         |
| **M4** | Bundling via esbuild; `private: false`; npm publish as `@alexanderfortin/pi-cli`; Homebrew tap optional.                                                                                                                                                                                                        | First public release.                        |

Estimated effort (rough): M1 ✅ shipped (~half a day). M2 ~ 1 day, M3 ~ 1 day, M4 ~ 0.5 day.

---

## 14. Risks

1. **`PlatformContext.eventName` assumptions.** The orchestrator and
   `context-utils.ts` switch on event names like `'issue_comment'` and
   `'pull_request'`. M1 mitigates this by using `'cli'` as an unknown event
   name, which all platform guards already defend against (no-ops for missing
   `comment.id`, falsy `issue.number`, etc.). M2 will need to add `'cli'` as
   a first-class event when `--pr`/`--issue` support lands.
2. **Octokit type drift.** ✅ Mitigated in M1 via §11.2 widening.
   `GitHubPlatformDeps.octokit` is now typed from `@octokit/core` directly,
   not from `@actions/github`'s wrapper. The two can no longer drift apart.
3. **Token leakage.** ✅ Eliminated in M1: no `--token` flag exists, so argv
   never carries a secret. Auth is env-var-only.
4. **Footprint.** `commander` + `@octokit/core` + `@octokit/plugin-rest-endpoint-methods`
   are the only new runtime deps. Since the CLI is published as a separate
   package this doesn't affect the action's `dist/index.js`.
5. **Feature drift.** Two frontends means every new orchestrator input needs
   to be surfaced in three places: action `action.yml`, CLI flags, and
   `PiConfig`. Acceptable cost; could be reduced with a schema-driven config
   generator later (§15).

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

- [x] Maintainer signs off on the package layout (§3), CLI surface (§4), and
      distribution plan (§10).
- [x] Open questions in §12 have a resolution recorded inline.
- [x] A sub-issue is filed for M1 with concrete file list and test plan.
      (M1 has shipped on this branch; see §13.)

---

## 17. Implementation log

### M1 (this branch)

**Shipped:**

- `packages/pi-cli/` (16 files, ~1.2k LOC, 38 new tests, all green).
- Root `package.json` script `"pi-cli": "bun packages/pi-cli/src/index.ts"`.
- §11.2 prerequisite: `@octokit/core` type widening in `pi-platform-github`,
  `@actions/github` moved from `peerDependencies` to `devDependencies`.
- README in `packages/pi-cli/` with usage, flag table, env-var auth table,
  and roadmap.

**Not shipped (deliberately deferred):**

- All M2 flags (`--pr`, `--issue`, `--post-comment`, `--add-reaction`, exports,
  diff limits, etc.).
- `review` and `thread` subcommands (M3).
- Git-remote auto-detection for `--repo` (M3).
- §11.1 `GitAdapter` promotion (M3).
- esbuild bundle and npm publish (M4).

**Verified:**

- `bun run validate` clean (lint + type-check + format).
- `bun test`: 1302 pass / 0 fail (was 1264 pre-M1; +38 new).
- All 7 error paths smoke-tested: missing required flag, mutex violation,
  missing GitHub token, missing provider token, unknown provider, bad
  `--repo`, malformed repo format. Each produces a clear `✖` message and
  `exit 1`.

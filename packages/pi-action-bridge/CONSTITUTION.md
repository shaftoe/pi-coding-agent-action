# Pi Action Extension — Constitution

> **Codename:** `pi-action-bridge` — bridging local TUI and CI/CD agent workflows
> **Repository:** `pi-coding-agent-action` (monorepo)
> **Date:** 2026-06-15
> **Status:** Design v0.6 — Resolved decisions + verified SDK anchors (review pass 9 incorporated); see §12 for open items

---

## 1. Vision

A Pi extension that makes **GitHub threads (issues, PRs, reviews) the persistent memory and coordination layer** between a developer's local Pi TUI sessions and the remote Pi CI/CD agent (running via `pi-coding-agent-action`).

The developer should be able to **start work locally, hand off to CI, pick it back up on mobile, and return to the terminal** — all without losing context. GitHub becomes the shared state machine; the extension is the local bridge.

> *"Write code locally, review on mobile, let CI finish the job."*

---

## 2. Core Design Decisions (Resolved)

These decisions are considered locked. Alternatives that were weighed and rejected carry a short rationale so they are not re-litigated.

### 2.1 Agent Model: Commands Steer, Tools Execute

- **Commands are the steering wheel, tools are the engine.** The human drives via a single command, `/handoff`. The agent acts autonomously for context injection (§6) and whenever the LLM invokes tools during a normal session.
- **`/handoff` is a `pi.registerCommand` that orchestrates deterministically and delegates exactly one LLM step.** Its handler is an imperative TS function (`(args, ctx) => …`, `docs/extensions.md`):

  1. Parse `args` → `--steer "…"` and `-y`/`--yes` flags.
  2. Guard `ctx.mode === "tui"` (needs `ctx.ui.confirm` / `ctx.ui.editor`) **and** `ctx.model` is defined — `ExtensionContext.model` is `Model<any> | undefined` (`dist/core/extensions/types.d.ts`); the `handoff.ts` precedent guards both. If either fails, `ctx.ui.notify(…, "error")` and return.
  3. Dirty-tree check; if dirty, `ctx.ui.confirm(…)` how to proceed.
  4. Resolve branch → PR via git + GitHub API.
  5. Push branch (`simple-git`) — idempotent (skip if remote already has it).
  6. Create / update PR via Octokit — handle 401/403 (§2.3).
  7. Fetch diff via `provider.getPRDiff()`.
  8. Gather session context **compaction-aware.** `ctx.sessionManager.getBranch()` returns the *full lineage including pre-compaction entries* (`session-manager.js` walks `leafId`→root via `parentId`). Feeding that naively to `complete()` duplicates pre-compaction messages against the compaction summary — redundant, potentially contradictory, token-bloat. Use a compaction-boundary filter: either replicate `getHandoffMessages()` from `examples/extensions/handoff.ts` (keeps `[compaction, …entries from firstKeptEntryId onward]`), or call the SDK-exported `prepareBranchEntries(entries, tokenBudget)` (`@earendil-works/pi-coding-agent`) which is token-budgeted and compaction-aware. Then `convertToLlm` → `serializeConversation` (both exported).
  9. **One** one-shot model call — `complete()` from `@earendil-works/pi-ai`, authed via `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)`, fed the diff + serialized conversation + `--steer`, with a strict prompt that returns the `## Done` / `## Next` prose (and a PR title/body draft). Uses `ctx.model`.
  10. **Human-in-the-loop review** of the draft via `ctx.ui.editor("Review handoff", draft)` → returns edited text or `undefined` (cancel).
  11. Post: if `-y`/`--yes` or the user confirms the edit, post the `/pi` comment via `create_comment` (§4). On cancel, the push/PR already happened (harmless — idempotent on retry) but no comment is posted.

  The only LLM-authored content is the Done/Next prose (and the PR title/body draft). Everything order-critical — push/PR/post ordering, idempotent retry, the format contract the CI agent depends on — is TS. **Precedent:** `examples/extensions/handoff.ts` in the Pi SDK is exactly this shape (command orchestrates + one `complete()` + `ctx.ui.editor` review + `ctx.ui.custom` loader).

- **Why a command, not a skill.** The deciding axis: a command runs an imperative `(args, ctx)` handler you control deterministically; a skill expands a SKILL.md into the user message and lets the LLM *judge* whether/when to act and whether to honor a format. `/handoff` has order-critical side effects (push → PR → comment) and a format contract the CI action depends on — delegating those to LLM judgment is fragile. A command also gets real arg parsing, dialog UX (`ctx.ui.confirm`, `ctx.ui.editor`), and requires **zero setup** (no `enableSkillCommands: true` in `settings.json`).

- **`--steer` is parsed by the command** from `args` and woven into the `complete()` prompt's `## Next` section (not a separate heading — §2.5). It never reaches the session agent; `pi.sendUserMessage()` is not used by `/handoff`.

- **Dropped: `/sync`.** Redundant. §6 auto-injects PR context on turn 1; mid-session refresh is "what's new on the PR?" in natural language → the agent calls `get_thread`. No dedicated trigger.

- **Dropped: `/review`.** Fetching review comments is "show me the PR reviews" in natural language → `get_thread`. Not in the MVP. (A thin `/review` render-command is a deferred nice-to-have.)

- **API note (correctness, not load-bearing).** `pi.sendUserMessage()` lives on `ExtensionAPI` (`pi`), not on `ExtensionCommandContext` (the command handler's `ctx`); it also exists on `ReplacedSessionContext`, but only inside `withSession()` callbacks. Verified in `dist/core/extensions/types.d.ts`. `/handoff` does not call it — recorded to prevent a future copy-paste from the docs landing on the wrong receiver.

### 2.2 Statelessness

- **No persisted state.** PR/session links are derived from git state on-the-fly. No `pi.appendEntry()` or similar persistence.
- Branch → PR resolution happens dynamically via git + GitHub API on every request.

### 2.3 Authentication (Split)

- **Git operations** (push, branch detection, remote queries via `simple-git`): the developer's existing git credentials — SSH keys, macOS Keychain, credential helpers. No env var.
- **Forge API operations** (threads, diffs, comments, PR creation via Octokit): requires `GITHUB_TOKEN` or `GH_TOKEN`. Fail fast if missing. No `gh` auth piggybacking, no first-run flows. (Whether `gh auth status` may be consulted as a token *discovery* source before erroring is an open item — §12.)
- **Token-check timing: OPEN (§12, Q1).** An earlier draft mandated an eager throw in the async factory. Verified against `dist/core/extensions/loader.js` (`loadExtension`, L296): a factory throw is **contained per-extension** — it returns `{ extension: null, error }` collected into `LoadExtensionsResult.errors[]` and does **not** crash the `pi` session. But eager-at-load is still rejected: it would disable the bridge (and emit `Failed to load extension: …`) in every non-Forge / tokenless repo, and factories "may run in invocations that never start a session" (`docs/extensions.md`) — so it slows `pi --list-models` / `--version` too. The leading alternative (Q1, Option C) is a `session_start`-gated design: register the command cheaply at load; in `session_start` (which fires only for real sessions) do the one git-remote + token check and dynamically `pi.registerTool()` the four tools only when remote-is-Forge ∧ token-present. **Decision pending.**
- **401/403 handling is unconditional, regardless of where the check lives.** In a long-lived TUI session a short-lived `GITHUB_TOKEN` can expire after the check passed, so `/handoff` and `create_pull_request` must catch **401/403 from `octokit.pulls.create`** with a clear "token may have expired — re-run after refreshing `GITHUB_TOKEN`" message. If push succeeds but PR creation fails for a *non-token* reason (network, permissions, branch protection), the pushed branch is a harmless feature branch — re-run `/handoff` (idempotent: detects the existing remote branch, skips push, retries PR create) or fall back to `gh pr create`.

### 2.4 No `gh` CLI Dependency

- **Native libraries only.** Octokit for the GitHub-compatible REST API, `simple-git` for git operations.
- `simple-git` is a TypeScript API over the real git binary. Push auth just works via the developer's existing credential helpers.
- **System requirement:** the `git` binary must be installed and on PATH. Documented as a peer dependency — the audience is developers, so git is assumed present.

### 2.5 Handoff Format

- **Structured prose — no hidden payload.** The handoff is a normal `/pi` comment whose body uses two Markdown headings (`## Done`, `## Next`):

```markdown
/pi 🤖 Handoff from local session

## Done
- added auth module
- wired up middleware

## Next
add tests — focus on error handling coverage
```

- **Why two headings, not three.** An earlier draft had `## Done` / `## Next` / `## Steering`. The distinction between "Next" (what to do) and "Steering" (how to do it) is artificial for an LLM consumer, and the real difference was *provenance* (agent-inferred tasks vs. user `--steer`), which the CI agent does not care about. Collapsing to a single `## Next` also removes a decision point for the drafting model. `--steer` remains valuable as *input* to the `complete()` call; it is woven into `## Next` naturally.
- **Why prose, not a hidden JSON payload.** An earlier design embedded a JSON blob in an HTML comment (`<!-- pi-handoff-payload … -->`). That does not work: `pi-platform-github`'s `sanitizeContent()` strips HTML comments (defense-in-depth against prompt injection) before the body reaches the CI agent — via `getPrompt()` and via thread reads alike. Markdown headings, lists, bold, and emoji survive; HTML comments do not.
- **Why prose, not a fenced ```` ```handoff ```` block.** A fenced block also survives sanitization and is machine-scan-friendly, but duplicates the prose. Pure headings are the default; fall back to a fenced block only if a future non-LLM consumer needs parseable structure.
- **No version field.** The `"v": 1` forward-compat field is dropped. The format is natural language; the CI agent adapts to whatever structure it reads. Revisit only if a non-LLM consumer ever needs a schema (YAGNI today).
- **`/pi` prefix preserved** so the CI action picks it up as a normal invocation — **zero changes to the action**.

### 2.6 No CI Observation Layer

- **No `get_ci_status`, `get_ci_logs`, `/ci`, `triggerWorkflow`.** CI results come back through the thread as comments — the action already writes them. Unless doing specific debugging, action job runs are not interesting to the local agent.
- The bridge reads CI state the same way it reads everything else: through `get_thread`.

### 2.7 Write Operations: Minimal Surface

- **No `create_review`.** The local agent reads reviews (via `get_thread`), doesn't write them. That's the CI action's job.
- **No separate `steer_ci` tool.** Steering is `create_comment` with a `/pi` prefix.
- **`create_comment` is first-class, not trivial.** It's the bridge's primary write path and the channel by which steering + handoff reach CI. The bridge owns it outright (a direct Octokit call, not shared): `pi-platform-github`'s `createFinalComment` is CI-coupled (dispatches on `payload.comment`, appends an action-run footer) and is not reusable locally. `create_comment` supports three modes (§4): **plain** (free-form Markdown), **steering** (`/pi <instruction>`), and **handoff** (`/pi` + structured-prose headings, §2.5). All are top-level issue/PR comments via `octokit.rest.issues.createComment`; the only shared convention is the `/pi` trigger prefix. (Whether `/handoff` is the sole writer of comments and "plain" mode is dropped from the tool surface is an open item — §12.)

### 2.8 Session Enrichment

- On the **first turn** (`before_agent_start`, with a one-shot guard), if the current branch is linked to a PR, **auto-inject PR metadata + recent comments** as a persistent session message.
- The agent gets immediate awareness of current state without full history. If it needs more, `get_thread` is available.
- No state tracking — just "most recent N comments."
- **One-shot guard:** a closure-scoped boolean set during the first `before_agent_start`; it resets when a new session / extension instance is created (consistent with §2.2).

### 2.9 Duplication Over Forced Abstraction

- The CI action and the bridge have **different `createPullRequest` implementations**. The CI action uses the Git Data API (blobs, trees, refs) because it has no real checkout. The bridge uses `simple-git` push + `octokit.pulls.create`. No forced sharing where the workflows are genuinely different.
- Shared code only where it's genuinely shared: thread fetching, diff fetching, types, pure helpers.

---

## 3. Architecture

### 3.1 Runtime Target

**The bridge is a Pi TUI extension.** It loads into `@earendil-works/pi-coding-agent` (the `pi` binary) via `pi install` (§3.7) and runs in the developer's interactive session. It does **not** run inside `pi-cli` or `pi-action`:

- **`pi-action`** (GitHub Action) has no local checkout and no developer at a keyboard — it already *is* the CI agent the bridge hands off *to*. Loading the bridge there would be circular.
- **`pi-cli`** is a proof-of-concept headless client (`AGENTS.md`) that wires a synthetic `PlatformContext` for one-shot prompts; it is not a Pi extension host and does not load installed extensions.

> **This resolves the tool-name collision outright.** `createToolsFactory()` (`pi-orchestrator/src/pi/tools/index.ts`) is the only code that registers `get_pr_diff`, `create_pull_request`, `update_pull_request`, `get_issue_or_pr_thread`, `create_pull_request_review`, `get_ci_status`, `get_workflow_run_logs`. That factory is wired in **exclusively** by `buildResourceLoaderOptions()` (`pi-orchestrator/src/pi/resource-loader.ts`), consumed only by `pi-cli` and `pi-action` — never by the Pi TUI. The TUI's built-in tool surface is `bash` / `read` / `edit` / `write` / `grep` / `find` / `ls` plus whatever installed extensions register. So when the bridge registers its own `get_thread`, `get_pr_diff`, `create_comment`, `create_pull_request` (§4), there is **no collision** — those names are not present in the TUI runtime.

> **The bridge must not call `createToolsFactory()`** nor depend on `pi-orchestrator`'s tool factories. It registers its own thin wrappers over the `pi-platform-github` provider (reads) and direct Octokit / `simple-git` (writes), per §2.7 / §2.9. (The bridge does transitively depend on `pi-orchestrator` via `pi-platform-github` — that's fine; the prohibition is on the *tool factories*.) Pulling in the orchestrator's tool layer would reintroduce the CI lifecycle coupling the §3.x reuse design explicitly avoids.

### 3.2 Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Pi TUI (local)                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │            pi-action-bridge Extension            │ │
│  │                                                  │ │
│  │  ┌──────────────────────┐  ┌──────────────────┐ │ │
│  │  │  Bridge Class        │  │    Command       │ │ │
│  │  │  - git discovery     │  │  /handoff        │ │ │
│  │  │  - Octokit (direct)  │  │  (--steer, -y)   │ │ │
│  │  │  - session enrich    │  │                  │ │ │
│  │  └──────────┬───────────┘  └──────────────────┘ │ │
│  │             │                                    │ │
│  │  ┌──────────▼───────────────────────────────────┐│ │
│  │  │         pi-platform-github (reused provider) ││ │
│  │  │  - createGitHubPlatformProvider() + synth ctx││ │
│  │  │  - reads: getIssueOrPRThread() / getPRDiff() ││ │
│  │  │  - CI-only methods no-op (addReaction, ...)  ││ │
│  │  │  - Codeberg/Forgejo = Octokit baseUrl swap   ││ │
│  │  └──────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
         ↕ Octokit (GITHUB_TOKEN for API, baseUrl per platform) + simple-git (git creds for push)
┌─────────────────────────────────────────────────────┐
│              GitHub / Codeberg / Forgejo              │
│  Issues · PRs · Comments · Reviews                    │
└─────────────────────────────────────────────────────┘
         ↕ /pi comments
┌─────────────────────────────────────────────────────┐
│           pi-coding-agent-action (CI/CD)              │
│  Reads same threads, writes results as comments       │
└─────────────────────────────────────────────────────┘
```

> **`/handoff` is a `pi.registerCommand`** (§2.1, §5), not a skill. `/sync` and `/review` were dropped — their jobs are covered by §6 auto-injection + `get_thread` in natural language.

### 3.3 Package Structure

```
pi-action-bridge/
├── package.json          # npm metadata + Pi manifest ("pi": { extensions }) — see §3.7
├── tsconfig.json
├── src/
│   ├── index.ts          # Extension entry point (async factory)
│   ├── bridge.ts         # Bridge class: git discovery → synth PlatformContext + provider + Octokit
│   ├── context.ts        # Build synthetic PlatformContext from git remote (mirrors pi-cli)
│   ├── detect.ts         # Normalize git remote → server URL; delegate to detectPlatform()
│   ├── handoff.ts        # /handoff command: orchestration + complete() + HITL review
│   ├── tools/
│   │   ├── get-thread.ts       # Wraps provider.getIssueOrPRThread() (issue_number from git/PR)
│   │   ├── get-pr-diff.ts      # Wraps provider.getPRDiff()
│   │   ├── create-comment.ts   # Post comment to issue/PR (direct Octokit)
│   │   └── create-pull-request.ts  # Push + create PR (simple-git + Octokit)
│   └── hooks/
│       └── session-enrichment.ts  # Auto-inject PR context on first turn (before_agent_start)
├── tests/
│   ├── bridge.spec.ts
│   ├── handoff.spec.ts
│   ├── platform/
│   │   └── detect.spec.ts
│   └── tools/
│       ├── get-thread.spec.ts
│       ├── get-pr-diff.spec.ts
│       ├── create-comment.spec.ts
│       └── create-pull-request.spec.ts
└── README.md
```

> No `skills/` directory and no `"skills"` manifest entry — the extension ships only the command and tools.

### 3.4 No new shared package — reuse `pi-platform-github`

An earlier draft proposed a `pi-forge-client` package exposing a platform-agnostic `ForgeClient` interface (a generic `request(path, options)`). Dropped:

- **Octokit already is the cross-platform client.** GitHub, Codeberg, Forgejo, and Gitea all speak the same GitHub-compatible REST API; the only per-platform switch is Octokit's `baseUrl` (`/api/v3` for GHE vs `/api/v1` for Codeberg/Forgejo/Gitea) — a small pure function `apiBaseUrlFromServerUrl(serverUrl)`, today implemented in `pi-cli/src/octokit.ts`. **`pi-cli` is `"private": true` and not a dependency of the bridge**, so that function is **reimplemented in the bridge** (mirroring the ~25-line reference), not imported. The same applies to `buildPlatformContext()` (`pi-cli/src/context.ts`, ~20 lines) — mirrored, not imported. `detectPlatform()` *is* importable (exported from `@alexanderfortin/pi-platform-github`, L130). Whether to instead **promote** `apiBaseUrlFromServerUrl`/`buildPlatformContext` into `pi-platform-github` (DRY, esp. since the baseUrl logic is platform-detection-adjacent to `detectPlatform`) is an open design choice — §12 Q9.
- **The generic `request()` signature threw away Octokit's typed `.rest.*` methods** (`issues.get`, `pulls.get`, `pulls.listReviewComments`, diff mediaType). Re-exposing the typed surface would make `ForgeClient` a re-skin of Octokit — a fictional abstraction.
- Honors §2.9 (duplication over forced abstraction).

**Instead:** the bridge depends on `@alexanderfortin/pi-platform-github` and calls `createGitHubPlatformProvider()` with a **synthetic `PlatformContext`** derived from the git remote (repo owner/name, server URL) — mirroring the pattern `pi-cli/src/context.ts` → `buildPlatformContext()` uses today (reimplemented locally since `pi-cli` is private — see the bullet above and §12 Q9).

The provider's CI-oriented methods (`addReaction`, `createFinalComment`, `getPrompt`, `getStartTime`) **no-op** when the synthetic context carries `payload: {}`, a falsy `issue.number`, and a sentinel `eventName` (documented in `pi-cli/src/context.ts`). So the bridge reuses the provider for reads (`getIssueOrPRThread`, `getPRDiff`) without dragging in CI lifecycle behavior.

**Bridge-specific writes** (`create_comment`, `create_pull_request`) stay in the bridge as direct Octokit / `simple-git` calls — per §2.7 / §2.9.

**Consequence:** no §7 extraction, no Phase 0, no new vocabulary ("forge"). One client concept (`PlatformProvider`), one noun ("platform").

### 3.5 Bridge Class

A single class (no interface hierarchy) that composes:
- **Git discovery** via `simple-git` — detect repo, branch, resolve branch → PR number.
- **Platform API** via `pi-platform-github`'s `createGitHubPlatformProvider()` with a synthetic `PlatformContext` — thread fetching (`getIssueOrPRThread`), diff fetching (`getPRDiff`).
- **Direct Octokit** — `create_comment`, `create_pull_request` (bridge-specific writes per §2.7 / §2.9).
- **Session enrichment** — auto-inject context on the first turn (`before_agent_start`).

> The bridge *uses* the existing `PlatformProvider` (`pi-orchestrator/src/platform/types.ts`) directly — there is no separate `PlatformClient` type. The provider is CI-oriented (it also exposes `addReaction`, `createFinalComment`, `getPrompt`, `getStartTime`), but those methods **no-op** against the bridge's synthetic context (`payload: {}`, falsy `issue.number`, sentinel `eventName`), as proven by `pi-cli`. One interface serves both CI and local.

### 3.6 Platform Detection

```typescript
// Auto-detect from git remote URL
function detectPlatformFromRemote(remoteUrl: string): PlatformType {
  const serverUrl = remoteUrlToServerUrl(remoteUrl); // normalize to https://github.com etc.
  return detectPlatform(serverUrl); // delegates to existing function in pi-platform-github
}
```

The existing `detectPlatform(serverUrl)` in `packages/pi-platform-github/src/provider.ts` handles platform detection from a server URL. The bridge normalizes the git remote URL (e.g. `git@github.com:owner/repo.git`) to a server URL (e.g. `https://github.com`) and delegates to the shared logic. This avoids duplicating the detection patterns (GitHub Enterprise `.github.`, Forgejo, Gitea).

### 3.7 Distribution & Installation

The package declares its Pi resources via the `"pi"` manifest key in `package.json` (per `docs/packages.md`):

```jsonc
{
  "name": "@alexanderfortin/pi-action-bridge",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

A workspace package is **not** auto-discovered by Pi. To load the bridge:

- **Dev / workspace** — local-path install: `pi install ./packages/pi-action-bridge`; or reference in `.pi/settings.json`: `{ "packages": ["./packages/pi-action-bridge"] }`.
- **Distributed** — publish to npm: `pi install npm:@alexanderfortin/pi-action-bridge`; or git: `pi install git:github.com/<org>/pi-coding-agent-action`.
- The `pi-package` keyword enables gallery discoverability.

No `"skills"` manifest key and no skill frontmatter — the extension exposes only the command (registered in `index.ts`) and the tools.

---

## 4. Tool Surface (MVP)

| Tool | Description | Implementation |
|------|-------------|----------------|
| `get_thread` | Fetch issue/PR thread with typed items (comment, review, inline_comment). Layered response: metadata + typed items. | `provider.getIssueOrPRThread()` |
| `get_pr_diff` | Fetch PR diff with truncation. | `provider.getPRDiff()` |
| `create_comment` | Post a top-level comment to an issue/PR via `octokit.rest.issues.createComment`. Three modes: **plain** (free-form Markdown), **steering** (`/pi <instruction>` — picked up by the CI action as a normal invocation), **handoff** (`/pi 🤖 Handoff…` + structured-prose headings, §2.5). Bridge-owned; no CI action-run footer locally. | Direct Octokit call |
| `create_pull_request` | Push branch via `simple-git` + create PR via Octokit. Agent composes title/body. | `simple-git` + Octokit |

> **Tool implementation pattern — factory closure + `AgentToolResult`.** A tool's `execute(toolCallId, params, signal, onUpdate, ctx)` receives `ctx: ExtensionContext`, which carries no provider/Octokit/git (verified in `dist/core/extensions/types.d.ts` → `ToolDefinition.execute`). So each tool factory closes over its dependencies from the factory scope and ignores `ctx` — the same pattern `pi-orchestrator/src/pi/tools/get-thread.ts` uses (`getIssueOrPRThreadToolFactory(provider)` captures `provider`). Each `execute` returns `AgentToolResult<TDetails>` — `{ content: [{ type: 'text', text }], details }` — built via `defineTool` (optionally wrapped in `withCancellation`), exactly as the orchestrator tools do today. The bridge's four tool factories capture the provider/Octokit/`simple-git` instance once at construction; the four `details` types are bridge-local.

> **Steering vs. handoff — both reach CI, different intent.** Steering is an ad-hoc mid-session directive ("focus on error handling") with no context payload — just `/pi <instruction>`. Handoff is the full state transfer: `## Done` / `## Next` headings. The `--steer` argument to `/handoff` is steering *input* that the drafting model weaves into the `## Next` section of the handoff comment — it does not get a separate heading (§2.5).

---

## 5. Command Surface (MVP)

| Command | Trigger | What the Handler Does |
|---------|---------|----------------------|
| `/handoff` | User types `/handoff [--steer "..."] [-y\|--yes]` | See §2.1 step list. HITL by default (`ctx.ui.editor` review); `-y`/`--yes` skips review and auto-posts. Idempotent on retry: if the remote branch already exists (a prior run pushed but PR creation failed), skips push and retries PR create. Manual fallback: `gh pr create`. |

No `/sync`, no `/review` (§2.1). Their jobs are covered by §6 auto-injection and natural-language `get_thread` calls respectively.

> **`complete()` uses `ctx.model`** — whatever model the user is on. The Done/Next summary does not need an expensive model, but pinning a cheaper one is deferred until cost complaints arise (§12). The summary call is authed via `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` and uses a `ctx.ui.custom()` loader (precedent: `examples/extensions/handoff.ts` + `BorderedLoader`).

---

## 6. Auto Behavior

On the **first turn** — via the `before_agent_start` event with a one-shot "already injected this session" guard:
1. Detect current branch via `simple-git`.
2. Resolve branch → PR number via GitHub API.
3. If linked PR found: return a persistent session message (`{ customType, content, display: true }`) with PR metadata + last N comments — stored in session, sent to the LLM.
4. If no linked PR: silent, no action.

> **Why `before_agent_start`, not `session_start`:** `session_start` handlers have no message-injection return shape and there is no pending turn to inject into at session creation. `before_agent_start` returns `{ message, systemPrompt }` (SDK type `BeforeAgentStartEventResult` — "Fired after user submits prompt, before agent loop. Can inject a message and/or modify the system prompt", `docs/extensions.md`) — the only message-injection point. A persistent *message* (not `systemPrompt`) is used so the thread context is contextual and compactable, rather than bloating every turn. **Why lazy (first prompt), not eager (session creation):** injecting eagerly would trigger an agent turn with no user prompt; deferring to the user's first `before_agent_start` avoids that, and a developer types their first prompt almost immediately in a TUI. The one-shot guard avoids re-injecting on subsequent turns.

> **N is OPEN (§12).** An earlier draft said "last 3–5 comments." Pick a fixed number with a stated token budget before implementing.

---

## 7. Refactoring Required

**None to `pi-platform-github` or `pi-orchestrator`.**

The earlier plan (extract a `pi-forge-client` package, refactor `pi-platform-github` to consume it) is **dropped** — see §3.4. The bridge reuses the existing provider unchanged.

> **Scope caveat — "no refactoring" means "not forced to," not "nothing duplicated."** The bridge *reimplements* two small pure helpers from private `pi-cli` because it cannot import them: `apiBaseUrlFromServerUrl()` (~25 lines, serverUrl→API baseUrl) and `buildPlatformContext()` (~20 lines, synthetic `PlatformContext`). This is consistent with §2.9 (duplication over forced abstraction) and does not contradict "no refactoring required" — no change to `pi-platform-github`/`pi-orchestrator` is *necessary*. The optional alternative — promoting those two helpers into `pi-platform-github` (where `detectPlatform` already lives) — is a DRY improvement tracked as §12 Q9, not a blocker.

The only prerequisite is confirming the provider's CI-only methods no-op against a synthetic `PlatformContext` — already true today (documented in `pi-cli/src/context.ts`). Verified for reads: `getIssueOrPRThread` resolves `owner`/`repo`/`issue_number` from `params ?? deps.context.*` (so the bridge passes explicit values and the synthetic context's zeroed `issue.number` is never read); `getPRDiff(owner, repo, pullNumber, ignoreFiles?)` takes explicit args. If a method turns out *not* to no-op cleanly from the local context, the fix is a small guard in `pi-platform-github` (widening an existing falsy-check), not a package extraction.

---

## 8. Implementation Roadmap

### Phase 1: Bridge Scaffold
- [ ] Create `packages/pi-action-bridge` — package.json, tsconfig, Pi manifest
- [ ] Bridge class with git discovery (`simple-git`) + synthetic `PlatformContext` + `createGitHubPlatformProvider()`
- [ ] Platform detection from git remote (delegating to `detectPlatform`)
- [ ] Auth gating per the §12 Q1 decision; git credentials for push
- [ ] Tests for platform detection and bridge class
- [ ] Update root `AGENTS.md` "Repository Layout" to include `pi-action-bridge`

### Phase 2: Tools
- [ ] `get_thread` tool (wraps `provider.getIssueOrPRThread()`)
- [ ] `get_pr_diff` tool (wraps `provider.getPRDiff()`)
- [ ] `create_comment` tool (direct Octokit)
- [ ] `create_pull_request` tool (`simple-git` + Octokit)
- [ ] Tests for all tools

### Phase 3: `/handoff` Command
- [ ] `/handoff` command: arg parsing (`--steer`, `-y`/`--yes`), orchestration, `complete()` summary, `ctx.ui.editor` HITL, post via `create_comment`
- [ ] Idempotent push/PR retry; 401/403 handling
- [ ] Tests for `/handoff`

### Phase 4: Session Enrichment
- [ ] Auto-detect branch → PR on first turn via `before_agent_start` (controlled by `auto_sync` config, §9)
- [ ] Inject PR metadata + last N comments as a persistent session message (one-shot guard)
- [ ] Tests for session enrichment

### Phase 5: Codeberg Support
- [ ] Codeberg: Octokit `baseUrl` swap (`/api/v1`) — `detectPlatform` imported from `pi-platform-github`; `apiBaseUrlFromServerUrl` reimplemented locally (or promoted per §12 Q9)
- [ ] Platform detection for Codeberg (already handled by `detectPlatform`)
- [ ] Tests for Codeberg support

---

## 9. Configuration

The bridge reads its **own** config files — never a slice of Pi's reserved `settings.json`. Pi owns `settings.json` and its schema is fixed and versioned; stashing an extension key there invites drift and silent breakage on SDK upgrades, and there is no SDK settings accessor on `ExtensionContext` to read it safely anyway. So the bridge owns co-located JSONC files that inherit the same scope + trust model:

| Scope | Path | Load rule |
|-------|------|-----------|
| Global | `~/.pi/agent/pi-action-bridge.json` | Always |
| Project | `.pi/pi-action-bridge.json` | Only when `ctx.isProjectTrusted()` — mirrors Pi's own gate for `.pi/settings.json` (`docs/settings.md`) |

```jsonc
// ~/.pi/agent/pi-action-bridge.json  (global)
//   or  .pi/pi-action-bridge.json    (project, trusted)
{
  "platform": "auto",      // "auto" | "github" | "codeberg" | "forgejo"
  "forgejo_url": "",       // Required when platform is "forgejo"
  "auto_sync": true        // Auto-inject thread context on first turn (see §6)
}
```

> **The extension reads this itself.** `ExtensionContext` exposes no settings accessor (`docs/extensions.md`), so the bridge reads its own files directly: global always; project only behind `ctx.isProjectTrusted()`. Merge: project overrides global, nested merge (same semantics Pi applies to `settings.json`, `docs/settings.md`). The files are **JSONC**, but **naive `//` stripping corrupts URLs** — a `forgejo_url: "https://forge.example"` value would be truncated at the first `//`. Parse with a **string-aware JSONC stripper** (e.g. [`strip-json-comments`](https://github.com/sindresorhus/strip-json-comments) — zero-dependency, the de-facto standard; or `jsonc-parser`), never a blind `//.*` regex. Defaults (`platform: "auto"`, `auto_sync: true`) apply when absent.

---

## 10. Naming

- **Extension package:** `@alexanderfortin/pi-action-bridge` (`packages/pi-action-bridge`) — depends on `@alexanderfortin/pi-platform-github` (reused, not wrapped).
- **Extension namespace:** `pi-action-bridge`.
- **Command:** `/handoff` (flags: `--steer`, `-y`/`--yes`).
- **Tools:** `get_thread`, `get_pr_diff`, `create_comment`, `create_pull_request`.

---

## 11. Interaction with `pi-coding-agent-action`

| Convention | Local Extension | CI Action |
|-----------|----------------|-----------|
| **Handoff comments** | Writes `/pi` comment with structured-prose handoff (Markdown headings; §2.5) | Reads it as a normal `/pi` invocation |
| **Thread context** | Reads threads via `pi-platform-github` provider | Reads threads via `pi-platform-github` provider |
| **CI results** | Reads action's result comments in the thread | Writes result comments |
| **`/pi` trigger** | Posts steering comments via `create_comment` | Detects and processes |

No changes to the CI action are required. The handoff works via the existing `/pi` comment convention.

---

## 12. Open Decisions

Resolved through v0.5; the following are still open and block implementation of the noted phases.

- **Q1 — Token-check timing (blocks Phase 1).** Eager-at-load rejected (noisy, too-wide scope, slows `--list-models`). Leading candidate: **Option C** — register `/handoff` cheaply at load; in `session_start` do the one git-remote + token check and dynamically `pi.registerTool()` the four tools only when remote-is-Forge ∧ token-present (`session_start` fires only for real sessions; `pi.registerTool()` post-startup is sanctioned — `examples/extensions/dynamic-tools.ts`). Decide: Option C, or lazy-check-at-first-call (simpler but leaks tools into non-Forge repos)?
- **Q2 — `gh auth` as a token *discovery* source (gated on Q1).** Currently "no `gh` piggybacking." Under Option C the `session_start` handler already does discovery — consulting `gh auth status` for a token before erroring is cheap and friendlier. Keep the hard rejection, or allow discovery-only?
- **Q3 — Token/git-account mismatch.** Push creds (account A) vs `GITHUB_TOKEN` (account B) produce a PR authored by B with commits bearing A. Warn at `session_start` (we already know the token identity), or stay silent?
- **Q4 — `create_comment` "plain" mode.** Keep it (general write tool) or drop it so `/handoff` is the sole writer of comments (smaller surface, less prompt budget)?
- **Q5 — Enrichment comment count N (blocks Phase 4).** Pick a fixed number with a stated token budget (draft said "3–5").
- **Q6 — PR body content.** `/handoff` creates the PR. Is the body a short pointer to the handoff comment, a full description drafted by the same `complete()` call, or a minimal template? Currently unspecified.
- **Q7 — Dirty-tree UX options (Phase 3).** `ctx.ui.confirm("Working tree dirty", …)` — what are the choices? (commit / stash / abort / proceed-anyway?) And does `/handoff` offer to run the commit/stash, or just refuse until clean?
- **Q8 — Summary model (Phase 3).** `complete()` uses `ctx.model`. Defer pinning a cheaper model until cost feedback, or pin now?
- **Q9 — Promote `apiBaseUrlFromServerUrl` / `buildPlatformContext` into `pi-platform-github`? (cross-cuts Phase 1 & 5.)** Today they live in private `pi-cli`; the bridge must either reimplement them (~45 lines total, honors §2.9) or a small PR promotes them into `pi-platform-github` (where `detectPlatform` already lives — the baseUrl logic is platform-detection-adjacent, so the DRY case is strongest for `apiBaseUrlFromServerUrl`; `buildPlatformContext` is more of a frontend concern, duplication more defensible). Reimplement now and revisit on the third consumer, or promote now?

---

*This constitution reflects resolved design decisions through v0.5 and incorporates SDK verification (pass 7) and the skills→commands rewrite (pass 8). Open items are tracked in §12; resolve before implementing the corresponding phase.*

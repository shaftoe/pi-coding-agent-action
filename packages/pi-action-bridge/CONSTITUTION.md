# Pi Action Extension — Constitution

> **Codename:** `pi-action-bridge` — bridging local TUI and CI/CD agent workflows
> **Repository:** `pi-coding-agent-action` (monorepo)
> **Date:** 2026-06-15
> **Status:** Design v0.17 — review pass 11 incorporated (`/handoff` uses local `simple-git` diff, not `provider.getPRDiff`; truncation via imported `truncateDiff`)

---

## 1. Vision

A Pi extension that makes **GitHub threads (issues, PRs, reviews) the persistent memory and coordination layer** between a developer's local Pi TUI sessions and the remote Pi CI/CD agent (running via `pi-coding-agent-action`).

The developer should be able to **start work locally, hand off to CI, pick it back up on mobile, and return to the terminal** — all without losing context. GitHub becomes the shared state machine; the extension is the local bridge.

> *"Write code locally, review on mobile, let CI finish the job."*

---

## 2. Core Design Decisions (Resolved)

These decisions are considered locked. Alternatives that were weighed and rejected carry a short rationale so they are not re-litigated.

### 2.1 Agent Model: The Agent Reads, `/handoff` Writes

- **The agent is read-only.** Its two tools (`get_thread`, `get_pr_diff`) fetch GitHub context so it can help the developer work locally — pull the thread, read the diff, stay aware of CI results that came back as comments. The agent **never writes to GitHub**: no comment posting, no PR creation, no steering. The only way work leaves the developer's machine is `/handoff`, a deterministic command. This matches the actual workflow: **start a session** (context auto-injected if on a PR branch, §6) → **work locally, add commits** → **`/handoff`** to push + open/update the PR + post the handoff comment.
- **`/handoff` is a `pi.registerCommand` that orchestrates deterministically and delegates exactly one LLM step.** Its handler is an imperative TS function (`(args, ctx) => …`, `docs/extensions.md`):

  Steps are in true execution order (forced by data dependencies: `complete()` needs the diff + conversation; the PR title comes from `complete()`; the account-mismatch check needs `pulls.create`'s response):

  1. Parse `args` → `-y`/`--yes` flag (the only flag).
  2. Guard `ctx.mode === "tui"` (needs `ctx.ui.confirm` / `ctx.ui.editor`) **and** `ctx.model` is defined — `ExtensionContext.model` is `Model<any> | undefined` (`dist/core/extensions/types.d.ts`); the `handoff.ts` precedent guards both. If either fails, `ctx.ui.notify(…, "error")` and return.
  3. **Dirty-tree check (Q7).** `simple-git` `.status()` — if anything is uncommitted (modified/not_added/staged but uncommitted), `ctx.ui.notify("Working tree is dirty — commit or stash first, then re-run /handoff", "warning")` and **abort**. `/handoff` never mutates the working tree: no auto-commit (commit message ≠ handoff prose — category error), no auto-stash (silent mutation). The user handles it however they prefer — a `/commit` prompt, a terminal tab, whatever — then re-runs `/handoff` (idempotent on retry per step 8). If the tree is clean, proceed silently (no prompt).
  4. Resolve branch → PR via git + GitHub API (does a PR already exist for this branch? create vs. update).
  5. Gather session context **compaction-aware.** `ctx.sessionManager.getBranch()` returns the *full lineage including pre-compaction entries* (`session-manager.js` walks `leafId`→root via `parentId`). Feeding that naively to `complete()` duplicates pre-compaction messages against the compaction summary — redundant, potentially contradictory, token-bloat. Use a compaction-boundary filter: either replicate `getHandoffMessages()` from `examples/extensions/handoff.ts` (keeps `[compaction, …entries from firstKeptEntryId onward]`), or call the SDK-exported `prepareBranchEntries(entries, tokenBudget)` (`@earendil-works/pi-coding-agent`) which is token-budgeted and compaction-aware. Then `convertToLlm` → `serializeConversation` (both exported).
  6. Fetch the **local** diff via `simple-git` (`git diff origin/<base>...HEAD`, triple-dot so it captures everything on the feature branch since divergence) and truncate it via `truncateDiff(diff, 1000, 102_400)` (imported from `@alexanderfortin/pi-orchestrator/pi/tools/get-pr-diff` — same 1000-line / 100KB budget the `get_pr_diff` tool uses). **Why local, not `provider.getPRDiff()` (review pass 11):** the provider's `fetchPRDiff(deps, owner, repo, pullNumber: number, …)` calls `octokit.rest.pulls.get({ pull_number })` — a PR *must exist*. For the create case (step 4 found no PR) there's no `pullNumber`, so the provider call is a chicken-and-egg against the step ordering. The local diff has no such dependency, is offline/fast, and summarizes *your* work (on update the remote PR may include others' commits). It also bypasses the provider's lack of truncation — truncation lives in the orchestrator *tool wrapper*, not `fetchPRDiff`, so `/handoff` must truncate itself (hence the imported `truncateDiff`). The `<base>` is the upstream default branch; on an update it matches the PR's `base.ref` (read directly from the PR record, zero extra API calls — never guessed); on a create it's resolved authoritatively via `octokit.rest.repos.get({ owner, repo }).default_branch`, with local `origin/HEAD` heuristics as a fallback for offline/network-error cases (so a stale symbolic-ref can never produce an empty or wrong diff base). (The `get_pr_diff` **tool** still uses `provider.getPRDiff()` — §4 — that's a different consumer reading an existing PR mid-session, no chicken-and-egg.)
  7. **One** one-shot model call — `complete()` from `@earendil-works/pi-ai`, authed via `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)`, fed the diff + serialized conversation, with a strict prompt that returns the `## Done` / `## Next` prose **and a one-line PR title**. Uses `ctx.model`. (The PR body is *not* drafted by `complete()` — it's a static template, step 9.) **Response format:** the exact prompt + output contract is an implementation detail iterated in `handoff.ts` against real model output (pre-writing a prompt in a spec is counterproductive). **Fail-soft:** if the response doesn't parse (e.g. title not cleanly separable), dump the raw `complete()` output into the `ctx.ui.editor` review step (step 11) for the human to clean up — don't hard-fail the handoff over a parsing detail.
  8. Push branch (`simple-git`) — idempotent (skip if remote already has it).
  9. Create / update PR via Octokit — title from step 7; body = minimal template (Q6): two visible lines, a branch pointer (`**Branch:** feat-x → main`) and a handoff pointer (`**Handoff:** see the /pi 🤖 Handoff comment`), no LLM-authored body content. Handle 401/403 (§2.3). For an *update*, the title can be left unchanged or re-drafted; the body is always overwritten to the template.
  10. **Passive account-mismatch check (free).** `pulls.create`/`update` returns the PR's author as `result.user.login`; `simple-git` gives the local committer as `git config user.name`. Both values are now in hand, so comparing them costs no extra API call. If they differ (e.g. a shared/service-account token), the mismatch is surfaced at step 11's review. No `session_start` call, no warning for the common case (dev's own token → A == B, silent). See §2.3 account-mismatch note.
  11. **Human-in-the-loop review** of the draft via `ctx.ui.editor("Review handoff", draft)` → returns edited text or `undefined` (cancel). If the step-10 mismatch check fired, show one info line: *"PR will be authored by `<token-account>`; commits are by `<local git identity>`."* `-y`/`--yes` skips this review.
  12. Post: if `-y`/`--yes` or the user confirms the edit, post the `/pi` comment via **direct Octokit** (`octokit.rest.issues.createComment`) — a command-internal write, not an agent tool (the agent is read-only, §2.7). On cancel, the push/PR already happened (harmless — idempotent on retry) but no comment is posted.

  The only LLM-authored content is the Done/Next prose and the one-line PR title. The PR body is a static template (no LLM content, Q6). Everything order-critical — push/PR/post ordering, idempotent retry, the format contract the CI action depends on — is TS. **Precedent:** `examples/extensions/handoff.ts` in the Pi SDK is exactly this shape (command orchestrates + one `complete()` + `ctx.ui.editor` review + `ctx.ui.custom` loader).

- **Why a command, not a skill.** The deciding axis: a command runs an imperative `(args, ctx)` handler you control deterministically; a skill expands a SKILL.md into the user message and lets the LLM *judge* whether/when to act and whether to honor a format. `/handoff` has order-critical side effects (push → PR → comment) and a format contract the CI action depends on — delegating those to LLM judgment is fragile. A command also gets real arg parsing, dialog UX (`ctx.ui.confirm`, `ctx.ui.editor`), and requires **zero setup** (no `enableSkillCommands: true` in `settings.json`).

- **Guidance for CI has two channels, neither is `--steer` (dropped v0.16).** Before drafting: say it in the session conversation — `complete()` already consumes the serialized conversation (step 5), so intent spoken in-session is input to the draft. At review: edit `## Next` directly in the HITL step (step 11) — direct authoring of the final text, strictly more precise than asking a model to weave in a flag. `--steer` was redundant with both and internally inconsistent with §2.5 (which collapsed the Next/Steering output distinction, then kept a `--steer` input). See §12 Q10.

- **Dropped: `/sync`.** Redundant. §6 auto-injects PR context on turn 1; mid-session refresh is "what's new on the PR?" in natural language → the agent calls `get_thread`. No dedicated trigger.

- **Dropped: `/review`.** Fetching review comments is "show me the PR reviews" in natural language → `get_thread`. Not in the MVP. (A thin `/review` render-command is a deferred nice-to-have.)

- **API note (correctness, not load-bearing).** `pi.sendUserMessage()` lives on `ExtensionAPI` (`pi`), not on `ExtensionCommandContext` (the command handler's `ctx`); it also exists on `ReplacedSessionContext`, but only inside `withSession()` callbacks. Verified in `dist/core/extensions/types.d.ts`. `/handoff` does not call it — recorded to prevent a future copy-paste from the docs landing on the wrong receiver.

### 2.2 Statelessness

- **No persisted state.** PR/session links are derived from git state on-the-fly. No `pi.appendEntry()` or similar persistence.
- Branch → PR resolution happens dynamically via git + GitHub API on every request.

### 2.3 Authentication (Split)

- **Git operations** (push, branch detection, remote queries via `simple-git`): the developer's existing git credentials — SSH keys, macOS Keychain, credential helpers. No env var.
- **Forge API operations** (threads, diffs, comments, PR creation via Octokit): requires a token, discovered in this order: `GITHUB_TOKEN` env var → `GH_TOKEN` env var → `gh auth token` (best-effort, only if `gh` is on PATH and the env vars are both absent) → **hard error** if none. Fail fast if missing. **No first-run flows** — the bridge never invokes `gh auth login` or any interactive prompt; it only *reads* a token `gh` already has stored. All forge operations stay Octokit; `gh` is **discovery-only, never a write path** (no `gh pr create`, no shelling out).
- **Token-check timing: `session_start`-gated dynamic registration (Option C).** The async factory is a no-op stub (no I/O). **Both** `/handoff` and the read-only tools are registered inside the `session_start` handler — which fires only for real sessions, never for `pi --list-models` / `--version` / print mode (`docs/extensions.md`). This is a refinement of the original Q1 design (which described the factory as registering `/handoff` eagerly): `/handoff` needs a `Bridge` instance (provider + git + Octokit), which is only constructed inside the gate after the forge + token check passes. Registering an inert `/handoff` stub in the factory was considered but rejected — a stub that always errors with "bridge not ready" is worse UX than simply not registering the command in non-forge repos (the user gets "unknown command," which is honest). In the `session_start` handler the bridge does the one git-remote + token check:
  - `simple-git` `git remote get-url origin` (try/catch the not-a-git-repo case → treat as inert-skip, same as non-Forge).
  - Normalize the remote → `detectPlatform()` (imported from `pi-platform-github`).
  - **If remote-is-Forge ∧ `GITHUB_TOKEN`/`GH_TOKEN` present:** build the provider/Octokit and dynamically `pi.registerTool()` the two read-only tools (`get_thread`, `get_pr_diff`). Source-verified (`dist/core/agent-session.js` → `_refreshToolRegistry`): a tool registered via `pi.registerTool()` is **auto-activated and added to the system prompt's active tool set** — no `pi.setActiveTools()` call needed — and since `session_start` runs before `before_agent_start`, the tools are live for turn 1. (This is the same pattern `examples/extensions/dynamic-tools.ts` uses, registering at `session_start` and working bare.)
  - **Else (non-Forge, or Forge-but-no-token):** emit one info line and register **nothing**. The bridge is inert; `/handoff` still exists but will fail clearly if invoked in a non-Forge repo or with no token.

  This was chosen over the rejected alternatives:
  - **Eager throw in the factory** — rejected. Verified against `dist/core/extensions/loader.js` (`loadExtension`, L296): a factory throw is *contained* per-extension (returns `{ extension: null, error }` into `LoadExtensionsResult.errors[]`, doesn't crash the session), but it still disables the bridge (emitting `Failed to load extension: …`) in every non-Forge / tokenless repo, and runs even for `pi --list-models` / `--version` (factories "may run in invocations that never start a session"), slowing those invocations.
  - **Lazy check inside each tool's `execute()`** — rejected. Source-confirmed consequence: any `registerTool`'d tool is auto-active and lands in the tool surface, so in a GitLab repo the agent would see `get_thread`/`get_pr_diff` in its tool list and could attempt them pointlessly (wasted prompt budget + false affordance). Registering nothing in non-Forge repos is strictly better.
- **401/403 handling is unconditional, regardless of where the check lives.** In a long-lived TUI session a short-lived `GITHUB_TOKEN` can expire after the check passed, so `/handoff` (at its PR-create step) must catch **401/403 from `octokit.pulls.create`** with a clear "token may have expired — re-run after refreshing `GITHUB_TOKEN`" message. If push succeeds but PR creation fails for a *non-token* reason (network, permissions, branch protection), the pushed branch is a harmless feature branch — re-run `/handoff` (idempotent: detects the existing remote branch, skips push, retries PR create) or fall back to `gh pr create`.
- **Account-mismatch behavior (Q3, resolved v0.9).** Locally-pushed commits are authored by the developer's normal git identity (`git config user.name`/`user.email`) — the bridge uses `simple-git push`, not the Git Data API, so the CI-action `Co-authored-by` trailer (`appendCoAuthoredBy` in `pi-platform-github/src/git/commit-creator.ts`, which reads `deps.context.actor` populated from GitHub Actions' `GITHUB_ACTOR`) does **not apply**. The PR's "created by" is the token's account (via `octokit.pulls.create`). With the dev's own token these match (A == B). With a shared/org/service-account token they differ — that is almost always **intentional and expected** (the point of a team token), so there is no warning or `session_start` call. Instead, `/handoff` shows a free passive info line at the HITL review step when they differ (§2.1 step 10, shown at step 11) — amortized into calls `/handoff` already makes, surfaced at the decision point. (Detecting the token's identity eagerly at `session_start` was rejected: it costs an `octokit.users.getAuthenticated()` call on every session for a rare, usually-intentional mismatch. `github_pat_` tokens encode a user_id but classic `ghp_` are opaque, so `/user` is the only universal resolver.)

### 2.4 No *Hard* `gh` CLI Dependency

- **Native libraries are the core.** Octokit for the GitHub-compatible REST API, `simple-git` for git operations.
- **`gh` is an optional, best-effort token-discovery source — nothing more.** §2.3 may consult `gh auth token` as a fallback when `GITHUB_TOKEN`/`GH_TOKEN` are absent, because the developer already trusts `gh` with that token and the common local-dev case is "`gh` configured, env var not exported." If `gh` isn't installed, discovery silently fails and the bridge errors normally — there is no hard dependency.

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

- **Why two headings, not three.** An earlier draft had `## Done` / `## Next` / `## Steering`. The distinction between "Next" (what to do) and "Steering" (how to do it) is artificial for an LLM consumer, and the real difference was *provenance* (agent-inferred tasks vs. user guidance), which the CI agent does not care about. Collapsing to a single `## Next` also removes a decision point for the drafting model. (This reasoning later killed the matching `--steer` input flag too — §12 Q10: the input had reintroduced the exact distinction the output had rejected.)
- **Why prose, not a hidden JSON payload.** An earlier design embedded a JSON blob in an HTML comment (`<!-- pi-handoff-payload … -->`). That does not work: `pi-platform-github`'s `sanitizeContent()` strips HTML comments (defense-in-depth against prompt injection) before the body reaches the CI agent — via `getPrompt()` and via thread reads alike. Markdown headings, lists, bold, and emoji survive; HTML comments do not.
- **Why prose, not a fenced ```` ```handoff ```` block.** A fenced block also survives sanitization and is machine-scan-friendly, but duplicates the prose. Pure headings are the default; fall back to a fenced block only if a future non-LLM consumer needs parseable structure.
- **No version field.** The `"v": 1` forward-compat field is dropped. The format is natural language; the CI agent adapts to whatever structure it reads. Revisit only if a non-LLM consumer ever needs a schema (YAGNI today).
- **`/pi` prefix preserved** so the CI action picks it up as a normal invocation — **zero changes to the action**.

### 2.6 No CI Observation Layer

- **No `get_ci_status`, `get_ci_logs`, `/ci`, `triggerWorkflow`.** CI results come back through the thread as comments — the action already writes them. Unless doing specific debugging, action job runs are not interesting to the local agent.
- The bridge reads CI state the same way it reads everything else: through `get_thread`.

### 2.7 Write Operations: `/handoff` Only (Agent Is Read-Only)

- **The agent never writes to GitHub.** Its two tools (`get_thread`, `get_pr_diff`, §4) are read-only. There is no `create_comment` tool, no `create_pull_request` tool, no `create_review`. The local agent reads reviews/threads/diffs to help the developer work; writing reviews and result comments is the CI action's job, and the only local-origin write is the developer's `/handoff` gesture.
- **`/handoff` is the sole write path**, and it owns all three writes directly (no agent involvement): push (`simple-git`), PR create/update (`octokit.pulls.create`/`update`), and the `/pi` handoff comment (`octokit.rest.issues.createComment`). These are command-internal functions, not registered tools — the LLM cannot invoke them, which is the point: heavyweight, order-critical writes with a format contract should not be autonomous.
- **Dropped: `create_comment` tool (v0.11).** Its only rationale was mid-session "steering" (the agent posting a `/pi focus on error handling` comment while CI runs). But steering is a *human* decision, never an agent one — the agent doesn't know you want to steer until you tell it, at which point you're mediating your own intent through a tool you don't need. For a lightweight mid-run steer, `gh pr comment` or the GitHub UI suffices. (A future `/steer` command — deterministic TS, not an agent tool — is the right shape if steering is ever wanted; deferred, YAGNI.)
- **Demoted: `create_pull_request` (v0.11).** Was a tool; now a `/handoff`-internal function (`src/pull-request.ts`). Opening a PR is a deliberate handoff gesture with a format contract — not something the agent does autonomously mid-session.

### 2.8 Session Enrichment

- On the **first turn** (`before_agent_start`, with a one-shot guard), if the current branch is linked to a PR, **auto-inject PR metadata + recent comments** as a persistent session message.
- The agent gets immediate awareness of current state without full history. If it needs more, `get_thread` is available.
- No state tracking — just "most recent 3 comments" (Q5).
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

> **This resolves the tool-name collision outright.** `createToolsFactory()` (`pi-orchestrator/src/pi/tools/index.ts`) is the only code that registers `get_pr_diff`, `create_pull_request`, `update_pull_request`, `get_issue_or_pr_thread`, `create_pull_request_review`, `get_ci_status`, `get_workflow_run_logs`. That factory is wired in **exclusively** by `buildResourceLoaderOptions()` (`pi-orchestrator/src/pi/resource-loader.ts`), consumed only by `pi-cli` and `pi-action` — never by the Pi TUI. The TUI's built-in tool surface is `bash` / `read` / `edit` / `write` / `grep` / `find` / `ls` plus whatever installed extensions register. So when the bridge registers its own `get_thread`, `get_pr_diff` (§4), there is **no collision** — those names are not present in the TUI runtime.

> **The bridge must not call `createToolsFactory()`** nor depend on `pi-orchestrator`'s tool factories. It registers thin **read-only** wrappers over the `pi-platform-github` provider for its two tools; all writes are command-internal to `/handoff` (direct Octokit / `simple-git`, §2.7). (The bridge does transitively depend on `pi-orchestrator` via `pi-platform-github` — that's fine; the prohibition is on the *tool factories*.) Pulling in the orchestrator's tool layer would reintroduce the CI lifecycle coupling the §3.x reuse design explicitly avoids.

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
│  │  │  - Octokit (direct)  │  │  (-y)            │ │ │
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
│   ├── index.ts          # Extension entry point (async factory + session_start gate)
│   ├── bridge.ts         # Bridge class: git discovery → synth PlatformContext + provider + Octokit (incl. inline buildPlatformContext)
│   ├── config.ts         # Bridge-owned JSONC config (§9): global/project scopes, trust gate, string-aware stripJsonc
│   ├── detect.ts         # Normalize git remote → server URL; delegate to detectPlatform()
│   ├── handoff.ts        # /handoff command: orchestration + complete() + HITL review
│   ├── pull-request.ts   # /handoff-internal: push (simple-git) + create/update PR (Octokit)
│   ├── tools/
│   │   ├── get-thread.ts       # Wraps provider.getIssueOrPRThread() (issue_number from git/PR) — read-only
│   │   └── get-pr-diff.ts      # Wraps provider.getPRDiff() — read-only
│   └── hooks/
│       └── session-enrichment.ts  # Auto-inject PR context on first turn (before_agent_start)
├── tests/
│   ├── bridge.spec.ts
│   ├── config.spec.ts
│   ├── detect.spec.ts
│   ├── pull-request.spec.ts
│   ├── session-enrichment.spec.ts
│   └── tools.spec.ts
└── README.md
```

> No `skills/` directory and no `"skills"` manifest entry — the extension ships only the command and tools.

### 3.4 No new shared package — reuse `pi-platform-github`

An earlier draft proposed a `pi-forge-client` package exposing a platform-agnostic `ForgeClient` interface (a generic `request(path, options)`). Dropped:

- **Octokit already is the cross-platform client.** GitHub, Codeberg, Forgejo, and Gitea all speak the same GitHub-compatible REST API; the only per-platform switch is Octokit's `baseUrl` (`/api/v3` for GHE vs `/api/v1` for Codeberg/Forgejo/Gitea). The pure function `apiBaseUrlFromServerUrl(serverUrl)` and `detectPlatform(serverUrl)` (both in `pi-platform-github`, co-located per Q9) are a **natural pair**: both pure functions of `serverUrl`, both pattern-match forge host substrings (`codeberg`/`forgejo`/`gitea`/`github.com`), answering complementary questions about the same platform (*what type* vs *what API URL*). They are not redundant — `detectPlatform` collapses github.com and self-hosted GHE both to `'github'`, while `apiBaseUrlFromServerUrl` distinguishes them (github.com → default; GHE → `/api/v3`) — so neither derives from the other. Keeping them split across two packages was a concrete drift risk: adding a forge host meant editing both. **Q9 decision (v0.12): promote `apiBaseUrlFromServerUrl` into `pi-platform-github`** (done in this PR) — colocating the natural pair, overriding rule-of-three on cohesion grounds.
- **`buildPlatformContext` is different: stay inlined.** It carries no platform logic or pattern-matching — it just assembles a `PlatformContext` from caller args (`repo`, `workspace`, `serverUrl`, …) with sentinel values. Its two callers (`pi-cli` from CLI flags; the bridge from a git remote) gather inputs differently, so promoting it earns ~nothing. It's ~10 lines, inlined in the bridge's `bridge.ts`. Rule-of-three says wait for a third consumer before abstracting.
- **The generic `request()` signature threw away Octokit's typed `.rest.*` methods** (`issues.get`, `pulls.get`, `pulls.listReviewComments`, diff mediaType). Re-exposing the typed surface would make `ForgeClient` a re-skin of Octokit — a fictional abstraction.
- Honors §2.9 (duplication over forced abstraction).

**Instead:** the bridge depends on `@alexanderfortin/pi-platform-github` and calls `createGitHubPlatformProvider()` with a **synthetic `PlatformContext`** derived from the git remote (repo owner/name, server URL) — assembled by a small inline `buildPlatformContext` in `bridge.ts` (pattern mirrored from `pi-cli/src/context.ts`, ~10 lines, kept inlined per Q9).

The provider's CI-oriented methods (`addReaction`, `createFinalComment`, `getPrompt`, `getStartTime`) **no-op** when the synthetic context carries `payload: {}`, a falsy `issue.number`, and a sentinel `eventName` (documented in `pi-cli/src/context.ts`). So the bridge reuses the provider for reads (`getIssueOrPRThread`, `getPRDiff`) without dragging in CI lifecycle behavior.

**Bridge-specific writes** (push, PR create/update, handoff comment) are `/handoff`-internal direct `simple-git` / Octokit calls — not agent tools (§2.7).

**Consequence:** no §7 extraction, no Phase 0, no new vocabulary ("forge"). One client concept (`PlatformProvider`), one noun ("platform").

### 3.5 Bridge Class

A single class (no interface hierarchy) that composes:
- **Git discovery** via `simple-git` — detect repo, branch, resolve branch → PR number.
- **Platform API** via `pi-platform-github`'s `createGitHubPlatformProvider()` with a synthetic `PlatformContext` — thread fetching (`getIssueOrPRThread`), diff fetching (`getPRDiff`).
- **Direct Octokit + `simple-git`** — used **only by the `/handoff` command** (push, PR create/update, handoff comment post). The agent's tools are read-only (§2.7).
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
| `get_thread` | Fetch issue/PR thread with typed items (comment, review, inline_comment). Layered response: metadata + typed items. **Read-only.** | `provider.getIssueOrPRThread()` |
| `get_pr_diff` | Fetch PR diff with truncation. **Read-only.** | `provider.getPRDiff()` |

> **Tool implementation pattern — factory closure + `AgentToolResult`.** A tool's `execute(toolCallId, params, signal, onUpdate, ctx)` receives `ctx: ExtensionContext`, which carries no provider/Octokit/git (verified in `dist/core/extensions/types.d.ts` → `ToolDefinition.execute`). So each tool factory closes over its dependencies from the factory scope and ignores `ctx` — the same pattern `pi-orchestrator/src/pi/tools/get-thread.ts` uses (`getIssueOrPRThreadToolFactory(provider)` captures `provider`). Each `execute` returns `AgentToolResult<TDetails>` — `{ content: [{ type: 'text', text }], details }` — built via `defineTool` (optionally wrapped in `withCancellation`), exactly as the orchestrator tools do today. The bridge's two tool factories capture the provider instance once at construction; the two `details` types are bridge-local.

> **Both tools are read-only (v0.11).** The agent fetches context to help the developer work locally; it never writes to GitHub. The only writes are `/handoff`-internal (§2.7). There is no `create_comment` or `create_pull_request` tool — opening PRs and posting `/pi` comments are deliberate, format-contracted gestures owned by the `/handoff` command, not autonomous agent actions. (Mid-run steering, if ever wanted, is a future `/steer` command — deterministic TS, not an agent tool — deferred as YAGNI.)

---

## 5. Command Surface (MVP)

| Command | Trigger | What the Handler Does |
|---------|---------|----------------------|
| `/handoff` | User types `/handoff [-y\|--yes]` | See §2.1 step list. HITL by default (`ctx.ui.editor` review); `-y`/`--yes` skips review and auto-posts. Idempotent on retry: if the remote branch already exists (a prior run pushed but PR creation failed), skips push and retries PR create. Manual fallback: `gh pr create`. |

No `/sync`, no `/review` (§2.1). Their jobs are covered by §6 auto-injection and natural-language `get_thread` calls respectively.

> **`complete()` uses `ctx.model` (Q8 resolved v0.13).** The Done/Next summary steers an autonomous CI agent, so quality matters more than marginal token cost — a bad summary wastes far more CI compute than the summary call costs. `/handoff` is a deliberate, low-frequency gesture, so there's no volume to optimize against. Pinning a cheaper model is YAGNI until cost complaints arise; if they do, it's a one-line change (the `complete()` call already takes a `model` arg). The summary call is authed via `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` and uses a `ctx.ui.custom()` loader (precedent: `examples/extensions/handoff.ts` + `BorderedLoader`).

---

## 6. Auto Behavior

On the **first turn** — via the `before_agent_start` event with a one-shot "already injected this session" guard:
1. Detect current branch via `simple-git`.
2. Resolve branch → PR number via GitHub API.
3. If linked PR found: return a persistent session message (`{ customType, content, display: true }`) with PR metadata + last 3 comments (Q5) — stored in session, sent to the LLM.
4. If no linked PR: silent, no action.

> **Why `before_agent_start`, not `session_start`:** `session_start` handlers have no message-injection return shape and there is no pending turn to inject into at session creation. `before_agent_start` returns `{ message, systemPrompt }` (SDK type `BeforeAgentStartEventResult` — "Fired after user submits prompt, before agent loop. Can inject a message and/or modify the system prompt", `docs/extensions.md`) — the only message-injection point. A persistent *message* (not `systemPrompt`) is used so the thread context is contextual and compactable, rather than bloating every turn. **Why lazy (first prompt), not eager (session creation):** injecting eagerly would trigger an agent turn with no user prompt; deferring to the user's first `before_agent_start` avoids that, and a developer types their first prompt almost immediately in a TUI. The one-shot guard avoids re-injecting on subsequent turns.

> **N = 3, no per-comment truncation (Q5 resolved v0.14).** §6 injection is *automatic every session* (unlike `get_thread`, which the agent opts into when it needs depth), so frugality matters — favor the low end of the draft's "3–5." Three recent comments + PR metadata answers "what's the current state / what was last said / latest CI result?" — the stated purpose. Budget: ~500–1500 tokens typical (3 bodies + metadata). No per-comment truncation in the MVP: a `truncate(body, 500)` guard would bound the worst case (a CI log dump) but risks hiding the load-bearing line ("CI failed on test X"); revisit if token bloat shows up in practice. Because `get_thread` exists (up to 100 comments), §6 doesn't need to be exhaustive — it's a teaser that *prompts* a deeper fetch when relevant; over-injecting defeats that.
>
> **⚠️ Implementation gotcha (oldest-first).** `getIssueOrPRThread({ max_comments: N })` fetches the **oldest N**, not the most recent — `octokit.rest.issues.listComments` paginates oldest-first and `fetchThreadComments` (`pi-platform-github/src/tools/thread.ts`) fills chronologically up to `maxComments`. Passing `max_comments: 3` would inject the 3 *oldest* comments (wrong for "recent state"). The implementation must fetch-then-slice-last-N: one `listComments({ per_page: 100 })` call, `.slice(-3)`. (Or call `getIssueOrPRThread()` unbounded and slice the result locally.) Verify in Phase 4 tests that injected comments are the most-recent-three, not the oldest-three.

---

## 7. Refactoring Required

**None to `pi-orchestrator`; one small, optional-but-recommended PR to `pi-platform-github` (Q9, v0.12).**

The earlier plan (extract a `pi-forge-client` package, refactor `pi-platform-github` to consume it) is **dropped** — see §3.4. The bridge reuses the existing provider unchanged for reads.

> **The one `pi-platform-github` change (Q9).** `apiBaseUrlFromServerUrl(serverUrl)` was promoted from private `pi-cli/src/octokit.ts` into `pi-platform-github` (alongside `detectPlatform`) — done in this PR. It's a natural pair — same input, complementary output (platform *type* vs *API URL*) — and splitting them across packages was a drift risk. This was a ~25-line move + export, not a design change; `pi-cli` now imports it. `buildPlatformContext` was *not* promoted — it's frontend-specific assembly (~10 lines), inlined in the bridge. See §3.4.

> **Scope caveat — "no refactoring" means "not forced to," not "nothing duplicated."** Even if `apiBaseUrlFromServerUrl` is promoted, the bridge still inlines `buildPlatformContext` (~10 lines of context assembly) because `pi-cli` is private and that helper is too frontend-specific to abstract. This is consistent with §2.9 (duplication over forced abstraction).

The only prerequisite is confirming the provider's CI-only methods no-op against a synthetic `PlatformContext` — already true today (documented in `pi-cli/src/context.ts`). Verified for reads: `getIssueOrPRThread` resolves `owner`/`repo`/`issue_number` from `params ?? deps.context.*` (so the bridge passes explicit values and the synthetic context's zeroed `issue.number` is never read); `getPRDiff(owner, repo, pullNumber, ignoreFiles?)` takes explicit args. If a method turns out *not* to no-op cleanly from the local context, the fix is a small guard in `pi-platform-github` (widening an existing falsy-check), not a package extraction.

---

## 8. Implementation Roadmap

### Phase 1: Bridge Scaffold
- [x] **(Q9 prerequisite)** Promote `apiBaseUrlFromServerUrl(serverUrl)` from `pi-cli/src/octokit.ts` into `pi-platform-github` (alongside `detectPlatform`) and export it. Small ~25-line move; `pi-cli` imports it after the move. Run `bun run validate`. — *Done in this PR.*
- [x] Create `packages/pi-action-bridge` — package.json, tsconfig, Pi manifest
- [x] Async factory: no-op stub (no I/O) — `/handoff` + tools are registered inside the `session_start` gate (refinement of Q1; see §2.3)
- [x] `session_start` gate: git-remote check (`simple-git`, try/catch not-a-repo) → `detectPlatform` → if Forge ∧ token, build provider/Octokit and `pi.registerTool()` the two read-only tools + register `/handoff`; else register nothing + one info line (§2.3 Q1 decision)
- [x] Bridge class with git discovery (`simple-git`) + synthetic `PlatformContext` (inline `buildPlatformContext`, ~10 lines) + `createGitHubPlatformProvider()`
- [x] Platform detection from git remote (delegating to `detectPlatform` + `apiBaseUrlFromServerUrl`, both imported from `pi-platform-github`)
- [x] Git credentials for push (developer's existing helpers)
- [x] Tests for platform detection and bridge class
- [x] Update root `AGENTS.md` "Repository Layout" to include `pi-action-bridge`

### Phase 2: Read-Only Tools
- [x] `get_thread` tool (wraps `provider.getIssueOrPRThread()`) — read-only
- [x] `get_pr_diff` tool (wraps `provider.getPRDiff()`) — read-only
- [x] Tests for both tools

### Phase 3: `/handoff` Command
- [x] `/handoff` command: arg parsing (`-y`/`--yes`), orchestration, `complete()` summary, `ctx.ui.editor` HITL, post handoff comment via direct Octokit; PR create/update via command-internal `pull-request.ts`
- [x] Idempotent push/PR retry; 401/403 handling
- [x] Tests for `/handoff`

### Phase 4: Session Enrichment
- [x] Auto-detect branch → PR on first turn via `before_agent_start` (controlled by `auto_sync` config, §9)
- [x] Inject PR metadata + last 3 comments as a persistent session message (one-shot guard) — **fetch-then-slice-last-N** (see §6 gotcha: `max_comments` returns oldest, not most recent)
- [x] Tests for session enrichment

### Phase 5: Codeberg Support
- [ ] Codeberg: Octokit `baseUrl` swap (`/api/v1`) — via `detectPlatform` + `apiBaseUrlFromServerUrl` (both imported from `pi-platform-github` post-Q9)
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
- **Command:** `/handoff` (flag: `-y`/`--yes` only) — the sole write path.
- **Tools (read-only):** `get_thread`, `get_pr_diff`.


---

## 11. Interaction with `pi-coding-agent-action`

| Convention | Local Extension | CI Action |
|-----------|----------------|-----------|
| **Handoff comments** | Writes `/pi` comment with structured-prose handoff (Markdown headings; §2.5) | Reads it as a normal `/pi` invocation |
| **Thread context** | Reads threads via `pi-platform-github` provider | Reads threads via `pi-platform-github` provider |
| **CI results** | Reads action's result comments in the thread | Writes result comments |
| **`/pi` trigger** | `/handoff` posts the `/pi` handoff comment (direct Octokit) | Detects and processes |

No changes to the CI action are required. The handoff works via the existing `/pi` comment convention.

---

## 12. Decision Log

All design decisions are resolved as of v0.16. This section is a historical record of the grilling sessions (Q1–Q10) with rationale, kept so the reasoning isn't re-litigated. Resolved items are struck through; the relevant section is cross-referenced for the current spec.

- **~~Q1~~ — Token-check timing. ✅ Resolved v0.7 (refined in impl):** Option C — `session_start`-gated registration. The async factory is a no-op stub; **both** `/handoff` and the two read-only tools are registered inside the `session_start` handler after the forge + token check passes. (The original design text described the factory as registering `/handoff` eagerly and deferring only the tools; the implementation defers `/handoff` too, because it needs a `Bridge` instance that the gate constructs. An inert `/handoff` stub in the factory was rejected — "unknown command" in non-forge repos is cleaner than a stub that always errors.) Rejects eager-factory-throw (contained but noisy, too-wide scope, slows `--list-models`) and lazy-per-execute (leaks forge tools into non-Forge tool surface). See §2.3.
- **~~Q2~~ — `gh auth` as a token *discovery* source. ✅ Resolved v0.8:** discovery-only. Token resolution order: `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token` (best-effort if `gh` on PATH and env vars absent) → hard error. No `gh auth login` / interactive prompts ("no first-run flows" preserved). All forge operations stay Octokit — `gh` is discovery-only, **never** a write path. §2.4 reworded to "No *Hard* `gh` CLI Dependency." See §2.3.
- **~~Q3~~ — Token/git-account mismatch. ✅ Resolved v0.9:** no `session_start` call (corrected the false premise that identity is free — it costs `octokit.users.getAuthenticated()`, and `ghp_` tokens aren't locally decodable). Commits are authored by local git identity (bridge uses `simple-git`, not the Git Data API — CI's `appendCoAuthoredBy`/`actor` trailer doesn't apply). PR author is the token account. Mismatch is usually intentional (team tokens), so no warning; instead `/handoff` shows a free passive info line at HITL review when `result.user.login` ≠ `git config user.name` (both values already in hand). See §2.3.
- **~~Q4~~ — `create_comment`. ✅ Resolved v0.11 (supersedes v0.10):** the tool is **dropped entirely**, not just made steering-only. The agent is read-only — its two tools (`get_thread`, `get_pr_diff`) only fetch context. All writes are `/handoff`-internal (push, PR, handoff comment). `create_pull_request` was likewise demoted from a tool to a `/handoff`-internal function (`src/pull-request.ts`). Rationale: steering is a human decision (not autonomous), and opening PRs is a deliberate handoff gesture with a format contract. See §2.7 / §4.
- **~~Q5~~ — Enrichment comment count N (blocks Phase 4). ✅ Resolved v0.14:** N = 3, no per-comment truncation (revisit on bloat). Rationale: auto-injection is every-session, so favor frugality; 3 + metadata answers the "current state" question; `get_thread` is the depth escape hatch. Budget ~500–1500 tokens. Documented a Phase 4 implementation gotcha: `getIssueOrPRThread({ max_comments })` returns the *oldest* N (GitHub API paginates oldest-first), so §6 must fetch-then-slice-last-N. See §6.
- **~~Q6~~ — PR body content. ✅ Resolved v0.14:** **minimal template body, no LLM content**; title is the one line `complete()` drafts (HITL-reviewed with the Done/Next prose). Rationale (corrected after verification): the PR body is *not* invisible to CI — `get_issue_or_pr_thread` includes `issue.body` (`pi-platform-github/src/tools/thread.ts:271`). But duplicating Done/Next in both the `/pi` comment (the mandatory trigger) and the PR body means the CI agent reads the same content twice and the two copies drift on re-run. So the body does only what only it can: identify the PR as a container (branch pointer + handoff pointer). See §2.1 step 9.
- **~~Q7~~ — Dirty-tree UX (Phase 3). ✅ Resolved v0.15 (abort, no mutation):** if `simple-git` `.status()` shows anything uncommitted, `ctx.ui.notify(..., "warning")` and abort. The user handles the dirty tree themselves (a `/commit` prompt, a terminal tab, whatever) and re-runs `/handoff` (idempotent on retry). Rejected: auto-commit (commit message ≠ handoff prose — category error; also a surprise side effect the user didn't ask for) and auto-stash (silent working-tree mutation). Clean tree → proceed silently (no prompt). Rationale: `/handoff` never mutates the working tree; the user stays in control.
- **~~Q8~~ — Summary model (Phase 3). ✅ Resolved v0.13 (defer):** `complete()` uses `ctx.model`. Rationale: the summary steers an autonomous CI agent, so quality > marginal token cost (a bad summary wastes CI compute, which is more expensive than the call); `/handoff` is low-frequency so there's no volume to optimize against; pinning is a one-line change later if cost ever matters. Textbook YAGNI. See §5.
- **~~Q9~~ — Promote `apiBaseUrlFromServerUrl` / `buildPlatformContext` into `pi-platform-github`? ✅ Resolved v0.12 (split):** promote `apiBaseUrlFromServerUrl` (natural pair with `detectPlatform` — same input, overlapping pattern-matching, complementary output, drift risk if split); inline `buildPlatformContext` (~10 lines, frontend-specific assembly, rule-of-three says wait). §7 now reflects a small recommended `pi-platform-github` PR (Phase 1 prerequisite). See §3.4.
- **~~Q10~~ — The `--steer` flag. ✅ Resolved v0.16 (drop):** `/handoff` no longer takes `--steer`. Three reasons. (1) Redundant with the conversation — `complete()` already consumes the serialized session, so intent spoken in-session is input to the draft. (2) Strictly weaker than the HITL edit — `ctx.ui.editor` lets the user directly rewrite `## Next`, which is more precise than asking a model to weave in a flag. (3) Internally inconsistent with §2.5, which collapsed the Next/Steering *output* distinction then kept a `--steer` *input* flag reintroducing the same distinction. The combo `-y --steer` was incoherent (specific guidance + skip review), so no real use case was lost. Guidance now has two channels: in-session, or at the review edit. `/handoff` takes only `-y`/`--yes`. See §2.1.

---

*This constitution reflects resolved design decisions through v0.16. The agent is read-only (two tools); `/handoff` is the sole write path. The decision log is in §12.*

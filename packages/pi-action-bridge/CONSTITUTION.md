# Pi Action Extension — Constitution

> **Codename:** `pi-action-bridge` — bridging local CLI and CI/CD agent workflows
> **Repository:** `pi-coding-agent-action` (monorepo)
> **Date:** 2026-06-09
> **Status:** Design v0.2 — Grilled & Resolved

---

## 1. Vision

A Pi extension that makes **GitHub threads (issues, PRs, reviews) the persistent memory and coordination layer** between a developer's local Pi CLI sessions and the remote Pi CI/CD agent (running via `pi-coding-agent-action`).

The developer should be able to **start work locally, hand off to CI, pick it back up on mobile, and return to the terminal** — all without losing context. GitHub becomes the shared state machine; the extension is the local bridge.

> *"Write code locally, review on mobile, let CI finish the job."*

---

## 2. Core Design Decisions (Resolved)

These decisions were reached through a structured grilling session and are considered locked.

### 2.1 Agent Model: Skills Steer, Tools Execute

- **Skills are the steering wheel, tools are the engine.** The human drives via slash-skills (`/skill:handoff`, `/skill:sync`, `/skill:review`). The agent acts autonomously for context injection and when using tools during a session.
- `/skill:handoff` is **agent-driven** — the agent reads the diff, summarizes what's done, proposes next steps. Not a dumb script.
- There is **no imperative `commands/` directory**. Each skill is a SKILL.md document (Markdown) that instructs the agent; the tools are the actual implementation. Skills are invoked per the [Agent Skills standard](https://agentskills.io/specification) as `/skill:<name>` (see `docs/skills.md`). Arguments after the command are appended as free `User: <args>` text — the agent interprets them natively (e.g. `/skill:handoff --steer "focus on error handling"`). `enableSkillCommands` must be on (toggle via `/settings` or `settings.json`).
- **Alternative considered (not adopted for MVP):** register bare `/handoff` via `pi.registerCommand()`, parse `--steer` in the handler, then `ctx.sendUserMessage()` to inject the skill content and hand off to the agent. Gives a cleaner `/handoff` UX with real arg parsing, but adds a command layer that partly reinvents skill loading. **Escalation trigger:** revisit if `/skill:handoff` feels too verbose in practice.

### 2.2 Statelessness

- **No persisted state.** PR/session links are derived from git state on-the-fly. No `pi.appendEntry()` or similar persistence.
- Branch → PR resolution happens dynamically via git + GitHub API on every request.

### 2.3 Authentication (Split)

- **Git operations** (push, branch detection, remote queries via `simple-git`): Uses the developer's existing git credentials — SSH keys, macOS Keychain, credential helpers, etc. No env var needed.
- **Forge API operations** (threads, diffs, comments, PR creation via Octokit): Requires `GITHUB_TOKEN` or `GH_TOKEN` env var. Fail fast if missing. No fallbacks, no `gh` auth piggybacking, no first-run flows.
- The extension checks for the token **eagerly, at extension load** (the async factory), and throws a clear error if absent — before any skill can execute. This makes the token check **authoritative**: the push-succeeds-but-token-missing race (§2.3 split auth) cannot reach `/skill:handoff`. If push later succeeds but PR creation fails for a *non-token* reason (network, permissions, branch protection), the pushed branch is a harmless feature branch — re-run `/skill:handoff` (idempotent: detects the existing remote branch, skips push, retries PR create) or fall back to `gh pr create`.

### 2.4 No `gh` CLI Dependency

- **Native libraries only.** Octokit for GitHub API calls, `simple-git` for git operations.
- `simple-git` provides a TypeScript API over the real git binary. Push auth just works via the developer's existing credential helpers.
- **System requirement:** The git binary must be installed and available on PATH. This is documented as a peer dependency — the target audience is developers, so git is expected to be present.

### 2.5 Handoff Format

- **Structured prose — no hidden payload.** The handoff is a normal `/pi` comment whose body uses Markdown headings (`## Done`, `## Next`, `## Steering`) to convey the same fields the earlier JSON payload carried (`done` / `next` / `steer`):

```markdown
/pi 🤖 Handoff from local session

## Done
- added auth module
- wired up middleware

## Next
add tests

## Steering
focus on error handling
```

- **Why prose, not a hidden JSON payload.** The earlier design embedded a JSON blob in an HTML comment (`<!-- pi-handoff-payload ... -->`). That does not work: `pi-platform-github`'s `sanitizeContent()` strips HTML comments (defense-in-depth against prompt injection) before the body reaches the CI agent — via `getPrompt()` and via `get_thread`/`transformComment()` alike. Markdown headings, lists, bold, and emoji survive sanitization; HTML comments do not.
- **Agent-native.** §2.1 makes `/skill:handoff` agent-driven. The local agent fills the prose headings; the CI agent (an LLM) reads them natively. A structured JSON blob gave an LLM nothing prose doesn't.
- **No version field.** The `"v": 1` forward-compat field is dropped. The format is natural language; the CI agent adapts to whatever structure it reads. Revisit only if a non-LLM consumer ever needs a schema (YAGNI today).
- **`/pi` prefix preserved** so the CI action picks it up as a normal invocation — **zero changes to the action**.
- **Variant not adopted:** a fenced ```` ```handoff ```` code block also survives sanitization and is machine-scan-friendly, but duplicates the prose. Pure headings are the default; fall back to a fenced block only if a future non-LLM consumer needs parseable structure.

### 2.6 No CI Observation Layer

- **Dropped `get_ci_status`, `get_ci_logs`, `/ci` skill, `triggerWorkflow`.** CI results come through the thread as comments — the action already writes them back. Unless doing specific debugging, action job runs are not interesting to the local agent.
- The bridge reads CI state the same way it reads everything else: through `get_thread`.

### 2.7 Write Operations: Minimal Surface

- **Dropped `create_review`.** The local agent reads reviews (via `get_thread`), doesn't write them. That's the CI action's job.
- **Dropped `steer_ci` as a separate tool.** Steering is just `create_comment` with a `/pi` prefix.
- **`create_comment` is first-class, not trivial.** It's the bridge's primary write path and the channel by which steering + handoff reach CI. The bridge owns it outright (a direct Octokit call, not shared) — `pi-platform-github`'s `createFinalComment` is CI-coupled (dispatches on `payload.comment`, appends an action-run footer) and not reusable locally. `create_comment` supports three modes (see §4): **plain** (free-form Markdown), **steering** (`/pi <instruction>`), and **handoff** (`/pi` + structured-prose headings, §2.5). All are top-level issue/PR comments via `octokit.rest.issues.createComment`; the only shared convention is the `/pi` trigger prefix.

### 2.8 Session Enrichment

- On the **first turn** (`before_agent_start`, with a one-shot guard), if the current branch is linked to a PR, **auto-inject PR metadata + last 3-5 recent comments** as a persistent session message.
- (Not `session_start`: that event has no message-injection return shape and no pending turn to inject into — see §6.)
- The agent gets immediate awareness of current state without full history. If it needs more, `get_thread` is available.
- No state tracking needed — just "most recent N comments."

### 2.9 Duplication Over Forced Abstraction

- The CI action and the bridge have **different `createPullRequest` implementations**. The CI action uses the Git Data API (blobs, trees, refs) because it has no real checkout. The bridge uses `simple-git` push + `octokit.pulls.create`. That's fine — no forced sharing where the workflows are genuinely different.
- Shared code only where it's genuinely shared: thread fetching, diff fetching, types, pure helpers.

---

## 3. Architecture

### 3.1 Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│                   Pi CLI (local)                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │            pi-action-bridge Extension            │ │
│  │                                                  │ │
│  │  ┌──────────────────────┐  ┌──────────────────┐ │ │
│  │  │  Bridge Class        │  │    Skills        │ │ │
│  │  │  - git discovery     │  │  /handoff        │ │ │
│  │  │  - Octokit (direct)  │  │  /sync           │ │ │
│  │  │  - session enrich    │  │  /review         │ │ │
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

### 3.2 Package Structure

```
pi-action-bridge/
├── package.json          # npm metadata + Pi manifest ("pi": { extensions, skills }) — see §3.6
├── tsconfig.json
├── src/
│   ├── index.ts          # Extension entry point
│   ├── bridge.ts         # Bridge class: git discovery → synth PlatformContext + provider + Octokit
│   ├── context.ts        # Build synthetic PlatformContext from git remote (mirrors pi-cli)
│   ├── detect.ts         # Normalize git remote → server URL; delegate to detectPlatform()
│   ├── tools/
│   │   ├── get-thread.ts       # Wraps provider.getIssueOrPRThread() (issue_number from git/PR)
│   │   ├── get-pr-diff.ts      # Wraps provider.getPRDiff()
│   │   ├── create-comment.ts   # Post comment to issue/PR (direct Octokit)
│   │   └── create-pull-request.ts  # Push + create PR (simple-git + Octokit)
│   └── hooks/
│       └── session-enrichment.ts  # Auto-inject PR context on first turn (before_agent_start)
├── tests/
│   ├── bridge.spec.ts
│   ├── platform/
│   │   └── detect.spec.ts
│   └── tools/
│       ├── get-thread.spec.ts
│       ├── get-pr-diff.spec.ts
│       ├── create-comment.spec.ts
│       └── create-pull-request.spec.ts
├── skills/
│   ├── handoff.md        # /handoff — agent-driven push + PR + handoff comment
│   ├── sync.md           # /sync — pull thread context into session
│   └── review.md         # /review — fetch review comments for addressing
└── README.md
```

### 3.3 No new shared package — reuse `pi-platform-github`

An earlier draft proposed a `pi-forge-client` package exposing a platform-agnostic `ForgeClient` interface (a generic `request(path, options)`). That abstraction was **dropped** during review:

- **Octokit already is the cross-platform client.** GitHub, Codeberg, Forgejo, and Gitea all speak the same GitHub-compatible REST API; the only per-platform switch is Octokit's `baseUrl` (`/api/v3` for GHE vs `/api/v1` for Codeberg/Forgejo/Gitea) — already implemented by `pi-cli/src/octokit.ts` → `apiBaseUrlFromServerUrl`.
- **The generic `request()` signature threw away Octokit's typed `.rest.*` methods** (`issues.get`, `pulls.get`, `pulls.listReviewComments`, `pulls.get` w/ diff mediaType). Re-exposing the typed surface would make `ForgeClient` a re-skin of Octokit — a fictional abstraction.
- **Honors §2.9** (duplication over forced abstraction).

**Instead:** the bridge depends on `@alexanderfortin/pi-platform-github` and calls `createGitHubPlatformProvider()` with a **synthetic `PlatformContext`** derived from the git remote (repo owner/name, server URL) — the exact pattern `pi-cli/src/context.ts` → `buildPlatformContext()` uses today.

The provider's CI-oriented methods (`addReaction`, `createFinalComment`, `getPrompt`, `getStartTime`) already **no-op** when the synthetic context carries `payload: {}`, a falsy `issue.number`, and a sentinel `eventName` (documented in `pi-cli/src/context.ts`). So the bridge reuses the provider for reads (`getIssueOrPRThread`, `getPRDiff`) without dragging in CI lifecycle behavior.

**Bridge-specific writes** (`create_comment`, `create_pull_request`) stay in the bridge as direct Octokit / `simple-git` calls — already the design per §2.7 / §2.9.

**Consequence:** no §7 extraction, no Phase 0, no new vocabulary ("forge"). One client concept (`PlatformProvider`), one noun ("platform").

### 3.4 Bridge Class

A single class (no interface hierarchy) that composes:
- **Git discovery** via `simple-git` — detect repo, branch, resolve branch → PR number
- **Platform API** via `pi-platform-github`'s `createGitHubPlatformProvider()` with a synthetic `PlatformContext` — thread fetching (`getIssueOrPRThread`), diff fetching (`getPRDiff`)
- **Direct Octokit** — `create_comment`, `create_pull_request` (bridge-specific writes per §2.7 / §2.9)
- **Session enrichment** — auto-inject context on the first turn (`before_agent_start`)

> **Note:** The bridge *uses* the existing `PlatformProvider` (`pi-orchestrator/src/platform/types.ts`) directly — there is no separate `PlatformClient` type. The provider is CI-oriented (it also exposes `addReaction`, `createFinalComment`, `getPrompt`, `getStartTime`), but those methods **no-op** against the bridge's synthetic context (`payload: {}`, falsy `issue.number`, sentinel `eventName`), as proven by `pi-cli`. So one interface serves both CI and local.

### 3.5 Platform Detection

```typescript
// Auto-detect from git remote URL
function detectPlatformFromRemote(remoteUrl: string): PlatformType {
  const serverUrl = remoteUrlToServerUrl(remoteUrl); // normalize to https://github.com etc.
  return detectPlatform(serverUrl); // delegates to existing function in pi-platform-github
}
```

The existing `detectPlatform(serverUrl)` in `packages/pi-platform-github/src/provider.ts` handles platform detection from a server URL. The bridge normalizes the git remote URL (e.g., `git@github.com:owner/repo.git`) to a server URL (e.g., `https://github.com`) and delegates to the shared logic. This avoids duplicating the detection patterns (including GitHub Enterprise `.github.` patterns, Forgejo, Gitea).

### 3.6 Distribution & Installation

The package declares its Pi resources via the `"pi"` manifest key in `package.json` (per `docs/packages.md`):

```jsonc
{
  "name": "@alexanderfortin/pi-action-bridge",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/index.ts"],
    "skills": ["./skills"]
  }
}
```

A workspace package is **not** auto-discovered by Pi. To load the bridge:

- **Dev / workspace** — local-path install: `pi install ./packages/pi-action-bridge`; or reference in `.pi/settings.json`: `{ "packages": ["./packages/pi-action-bridge"] }`.
- **Distributed** — publish to npm: `pi install npm:@alexanderfortin/pi-action-bridge`; or git: `pi install git:github.com/<org>/pi-coding-agent-action`.
- The `pi-package` keyword enables gallery discoverability.
- Each `skills/*.md` must include `name` + `description` **frontmatter** to load (per `docs/skills.md`).

---

## 4. Tool Surface (MVP)

| Tool | Description | Implementation |
|------|-------------|----------------|
| `get_thread` | Fetch issue/PR thread with typed items (comment, review, inline_comment). Layered response: metadata + typed items. | `provider.getIssueOrPRThread()` |
| `get_pr_diff` | Fetch PR diff with truncation. | `provider.getPRDiff()` |
| `create_comment` | Post a top-level comment to an issue/PR via `octokit.rest.issues.createComment`. Three modes: **plain** (free-form Markdown), **steering** (`/pi <instruction>` — picked up by the CI action as a normal invocation), **handoff** (`/pi 🤖 Handoff…` + structured-prose headings, §2.5). Bridge-owned; no CI action-run footer locally. | Direct Octokit call |
| `create_pull_request` | Push branch via `simple-git` + create PR via Octokit. Agent composes title/body. | `simple-git` + Octokit |

---

## 5. Skill Surface (MVP)

| Skill | Trigger | What the Agent Does |
|-------|---------|-------------------|
| `/skill:sync` | User types `/skill:sync [number]` | Fetches the linked thread (or specified #) and presents the current state. The agent infers what's new from its own conversational context — no persisted "last seen" marker is needed. |
| `/skill:handoff` | User types `/skill:handoff [--steer "..."]` | Checks for uncommitted changes (asks the user how to proceed if working tree is dirty), pushes branch via `simple-git`, creates/updates PR, reads diff to summarize what's done and what's next, posts `/pi` comment with structured-prose handoff (`## Done` / `## Next` / `## Steering` headings; see §2.5). Idempotent on retry: if the remote branch already exists (e.g. a prior run pushed but PR creation failed), skips push and retries PR create; `gh pr create` is the manual fallback. |
| `/skill:review` | User types `/skill:review` | Fetches PR review comments via `get_thread`, presents them for the user to address locally |

---

## 6. Auto Behavior

On the **first turn** — via the `before_agent_start` event with a one-shot "already injected this session" guard:
1. Detect current branch via `simple-git`
2. Resolve branch → PR number via GitHub API
3. If linked PR found: return a persistent session message (`{ customType, content, display: true }`) with PR metadata + last 3-5 comments — stored in session, sent to the LLM.
4. If no linked PR: silent, no action

> **Why `before_agent_start`, not `session_start`:** `session_start` handlers have no message-injection return shape and there is no pending turn to inject into at session creation. `before_agent_start` returns `{ message, systemPrompt }` — the documented injection point (see `docs/extensions.md`). A persistent *message* (not `systemPrompt`) is used so the thread context is contextual and compactable, rather than bloating every turn. **Why lazy (first prompt), not eager (session creation):** injecting eagerly would trigger an agent turn with no user prompt; deferring to the user's first `before_agent_start` avoids that, and a developer types their first prompt almost immediately in a TUI. The one-shot guard avoids re-injecting on subsequent turns.

---

## 7. Refactoring Required

**None to `pi-platform-github` or `pi-orchestrator`.**

The earlier plan (extract a `pi-forge-client` package, refactor `pi-platform-github` to consume it) is **dropped** — see §3.3. The bridge reuses the existing provider unchanged.

The only prerequisite is confirming the provider's CI-only methods no-op against a synthetic `PlatformContext` — already true today (documented in `pi-cli/src/context.ts`). If a method turns out *not* to no-op cleanly from the local context, the fix is a small guard in `pi-platform-github` (widening an existing falsy-check), not a package extraction.

---

## 8. Implementation Roadmap

### Phase 1: Bridge Scaffold
- [ ] Create `packages/pi-action-bridge` — package.json, tsconfig, Pi manifest
- [ ] Bridge class with git discovery (`simple-git`) + synthetic `PlatformContext` + `createGitHubPlatformProvider()`
- [ ] Platform detection from git remote (delegating to `detectPlatform`)
- [ ] Auth check (`GITHUB_TOKEN`/`GH_TOKEN` for API) — eager, at extension load, authoritative (§2.3); git credentials for push
- [ ] Tests for platform detection and bridge class
- [ ] Update root `AGENTS.md` "Repository Layout" to include `pi-action-bridge`

### Phase 2: Tools
- [ ] `get_thread` tool (wraps `provider.getIssueOrPRThread()`)
- [ ] `get_pr_diff` tool (wraps `provider.getPRDiff()`)
- [ ] `create_comment` tool (direct Octokit)
- [ ] `create_pull_request` tool (`simple-git` + Octokit)
- [ ] Tests for all tools

### Phase 3: Skills
- [ ] `/skill:sync` skill (SKILL.md with `name` + `description` frontmatter)
- [ ] `/skill:handoff` skill
- [ ] `/skill:review` skill

### Phase 4: Session Enrichment
- [ ] Auto-detect branch → PR on first turn via `before_agent_start` (controlled by `auto_sync` config, see §9)
- [ ] Inject PR metadata + last 3-5 comments as a persistent session message (one-shot guard)
- [ ] Tests for session enrichment

### Phase 5: Codeberg Support
- [ ] Codeberg: Octokit `baseUrl` swap (`/api/v1`) — reuses existing `detectPlatform` + `apiBaseUrlFromServerUrl`
- [ ] Platform detection for Codeberg (already handled by `detectPlatform`)
- [ ] Tests for Codeberg support

---

## 9. Configuration

```jsonc
// .pi/settings.json or ~/.pi/agent/settings.json
{
  "pi-action-bridge": {
    "platform": "auto",           // "auto" | "github" | "codeberg" | "forgejo"
    "forgejo_url": "",            // Required for Forgejo
    "auto_sync": true             // Auto-inject thread context on first turn (see §6)
  }
}
```

> **The extension reads this itself.** Pi reads a fixed set of known settings keys (`docs/settings.md`); it does **not** hand arbitrary per-extension config to extensions, and there is no SDK settings accessor on `ExtensionContext`. The bridge reads `~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project, only when `ctx.isProjectTrusted()`), merges them (project overrides global, nested merge), and extracts its `"pi-action-bridge"` key. `settings.json` is **JSONC** (allows `//` comments) — strip comments before `JSON.parse`. Defaults (`platform: "auto"`, `auto_sync: true`) apply when the key is absent.

---

## 10. Naming

- **Extension package:** `@alexanderfortin/pi-action-bridge` (`packages/pi-action-bridge`) — depends on `@alexanderfortin/pi-platform-github` (reused, not wrapped)
- **Extension namespace:** `pi-action-bridge`
- **Skills:** `/skill:handoff`, `/skill:sync`, `/skill:review` (Agent Skills standard; free-text args)
- **Tools:** `get_thread`, `get_pr_diff`, `create_comment`, `create_pull_request`

---

## 11. Interaction with `pi-coding-agent-action`

| Convention | Local Extension | CI Action |
|-----------|----------------|-----------|
| **Handoff comments** | Writes `/pi` comment with structured-prose handoff (Markdown headings; see §2.5) | Reads it as a normal `/pi` invocation |
| **Thread context** | Reads threads via `pi-platform-github` provider | Reads threads via `pi-platform-github` provider |
| **CI results** | Reads action's result comments in the thread | Writes result comments |
| **`/pi` trigger** | Posts steering comments via `create_comment` | Detects and processes |

No changes to the CI action are required. The handoff works via the existing `/pi` comment convention.

---

*This constitution reflects resolved design decisions from the grilling session of 2026-06-09 and incorporates review feedback. Update as the project evolves.*

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

### 2.1 Agent Model: Commands Steer, Tools Execute

- **Commands are the steering wheel, tools are the engine.** The human drives via slash-commands (`/handoff`, `/sync`, `/review`). The agent acts autonomously for context injection and when using tools during a session.
- `/handoff` is **agent-driven** — the agent reads the diff, summarizes what's done, proposes next steps. Not a dumb script.
- Skills replace an imperative `commands/` directory. Each `/` command is a skill document (Markdown) that instructs the agent. The tools are the actual implementation.

### 2.2 Statelessness

- **No persisted state.** PR/session links are derived from git state on-the-fly. No `pi.appendEntry()` or similar persistence.
- Branch → PR resolution happens dynamically via git + GitHub API on every request.

### 2.3 Authentication (Split)

- **Git operations** (push, branch detection, remote queries via `simple-git`): Uses the developer's existing git credentials — SSH keys, macOS Keychain, credential helpers, etc. No env var needed.
- **Forge API operations** (threads, diffs, comments, PR creation via Octokit): Requires `GITHUB_TOKEN` or `GH_TOKEN` env var. Fail fast if missing. No fallbacks, no `gh` auth piggybacking, no first-run flows.
- The extension checks for the token on startup and throws a clear error if absent.

### 2.4 No `gh` CLI Dependency

- **Native libraries only.** Octokit for GitHub API calls, `simple-git` for git operations.
- `simple-git` provides a TypeScript API over the real git binary. Push auth just works via the developer's existing credential helpers.
- **System requirement:** The git binary must be installed and available on PATH. This is documented as a peer dependency — the target audience is developers, so git is expected to be present.

### 2.5 Handoff Format

- **Structured payload in HTML comments** with free-form Markdown for humans:

```markdown
/pi 🤖 pi-handoff

I've implemented the auth module, needs tests and error handling.

<!-- pi-handoff-payload
{"v": 1, "done": ["added auth module", "wired up middleware"], "next": "add tests", "steer": "focus on error handling"}
-->
```

- The payload includes a `"v": 1` version field for forward compatibility. If the format evolves, the CI action can distinguish between versions.
- The handoff comment includes `/pi` so the CI action picks it up as a normal invocation — **zero changes to the action**.

### 2.6 No CI Observation Layer

- **Dropped `get_ci_status`, `get_ci_logs`, `/ci` skill, `triggerWorkflow`.** CI results come through the thread as comments — the action already writes them back. Unless doing specific debugging, action job runs are not interesting to the local agent.
- The bridge reads CI state the same way it reads everything else: through `get_thread`.

### 2.7 Write Operations: Minimal Surface

- **Dropped `create_review`.** The local agent reads reviews (via `get_thread`), doesn't write them. That's the CI action's job.
- **Dropped `steer_ci` as a separate tool.** Steering is just `create_comment` with a `/pi` prefix.
- **`create_comment` is trivial** — a direct Octokit call in the bridge, not shared.

### 2.8 Session Enrichment

- On `session_start`, if the current branch is linked to a PR, **auto-inject PR metadata + last 3-5 recent comments**.
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
│  │  │         pi-forge-client (shared pkg)         ││ │
│  │  │  - getIssueOrPRThread()                      ││ │
│  │  │  - fetchPRDiff() + truncation helpers        ││ │
│  │  │  - shared types                              ││ │
│  │  │  - pure helpers (formatting, sanitization)   ││ │
│  │  └──────────────────────────────────────────────┘│ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
         ↕ ForgeClient (GITHUB_TOKEN for API) + simple-git (git credentials for push)
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
├── package.json          # Pi extension manifest
├── tsconfig.json
├── src/
│   ├── index.ts          # Extension entry point
│   ├── bridge.ts         # Bridge class (git discovery + ForgeClient + session enrichment)
│   ├── platform/
│   │   ├── types.ts      # PlatformClient interface + shared types
│   │   ├── github.ts     # GitHub implementation (Octokit → ForgeClient adapter)
│   │   ├── codeberg.ts   # Codeberg/Forgejo (soon)
│   │   └── detect.ts     # Auto-detect platform from git remote
│   ├── tools/
│   │   ├── get-thread.ts       # Fetch issue/PR thread (delegates to pi-forge-client)
│   │   ├── get-pr-diff.ts      # Fetch PR diff (delegates to pi-forge-client)
│   │   ├── create-comment.ts   # Post comment to issue/PR (direct Octokit)
│   │   └── create-pull-request.ts  # Push + create PR (simple-git + Octokit)
│   └── hooks/
│       └── session-enrichment.ts  # Auto-inject PR context on session start
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

### 3.3 `pi-forge-client` Shared Package

New sibling package at `packages/pi-forge-client` (`@alexanderfortin/pi-forge-client`).

**ForgeClient abstraction:**

The data-fetching functions accept a platform-agnostic `ForgeClient` interface rather than a raw Octokit instance. This prepares for Codeberg support without refactoring function signatures later.

```typescript
interface ForgeClient {
  request(path: string, options?: Record<string, unknown>): Promise<unknown>;
}
```

GitHub provides an adapter that wraps Octokit. Codeberg/Forgejo will provide their own.

**Contains:**
- `ForgeClient` interface definition
- Raw data-fetching functions (accept `{ client: ForgeClient, logger }` + explicit params, no CI context)
  - `getIssueOrPRThread()`
  - `fetchPRDiff()`
- Diff filter/truncation helpers (`truncateDiff`, `truncateDiffByBytes`, `truncateDiffByLines`, `filterDiffByIgnoreFiles`)
- Thread formatting helpers (`formatThreadAsText` and sub-helpers)
- Shared types re-exported from `pi-orchestrator/platform/types` (type re-exports move here; the original types remain in `pi-orchestrator` for backward compatibility)

**Does NOT contain:**
- `createPullRequest` — different implementations for CI vs. local
- `createComment` — trivial, not worth sharing
- Any CI-specific context (`PlatformContext`, `GitHubModuleDeps`)
- Tool definitions — those are consumer-specific

**Consumed by:**
- `packages/pi-platform-github` — refactored to use raw functions, wrapping with CI context resolution
- `packages/pi-action-bridge` — wraps raw functions with git-based context resolution

### 3.4 Bridge Class

A single class (no interface hierarchy) that composes:
- **Git discovery** via `simple-git` — detect repo, branch, resolve branch → PR number
- **Forge API** via `pi-forge-client` — thread fetching, diff fetching (through `ForgeClient` adapter)
- **Direct Octokit** — `create_comment`, `create_pull_request` (these bypass `ForgeClient` since they're not shared)
- **Session enrichment** — auto-inject context on session start

> **Note:** This bridge's `PlatformClient` is a separate concept from the CI action's `PlatformProvider` (`pi-orchestrator/src/platform/types.ts`). `PlatformProvider` is CI-oriented with methods like `addReaction`, `createFinalComment`, `getPrompt`, `getStartTime`. The bridge's `PlatformClient` is local-oriented with git discovery and no CI lifecycle. They share types but not the interface.

### 3.5 Platform Detection

```typescript
// Auto-detect from git remote URL
function detectPlatformFromRemote(remoteUrl: string): PlatformType {
  const serverUrl = remoteUrlToServerUrl(remoteUrl); // normalize to https://github.com etc.
  return detectPlatform(serverUrl); // delegates to existing function in pi-platform-github
}
```

The existing `detectPlatform(serverUrl)` in `packages/pi-platform-github/src/provider.ts` handles platform detection from a server URL. The bridge normalizes the git remote URL (e.g., `git@github.com:owner/repo.git`) to a server URL (e.g., `https://github.com`) and delegates to the shared logic. This avoids duplicating the detection patterns (including GitHub Enterprise `.github.` patterns, Forgejo, Gitea).

---

## 4. Tool Surface (MVP)

| Tool | Description | Implementation |
|------|-------------|----------------|
| `get_thread` | Fetch issue/PR thread with typed items (comment, review, inline_comment). Layered response: metadata + typed items. | Delegates to `pi-forge-client` |
| `get_pr_diff` | Fetch PR diff with truncation. | Delegates to `pi-forge-client` |
| `create_comment` | Post comment to issue/PR. Also handles steering (`/pi` prefix) and handoff. | Direct Octokit call |
| `create_pull_request` | Push branch via `simple-git` + create PR via Octokit. Agent composes title/body. | `simple-git` + Octokit |

---

## 5. Skill Surface (MVP)

| Skill | Trigger | What the Agent Does |
|-------|---------|-------------------|
| `/sync` | User types `/sync [number]` | Fetches the linked thread (or specified #) and presents the current state. The agent infers what's new from its own conversational context — no persisted "last seen" marker is needed. |
| `/handoff` | User types `/handoff [--steer "..."]` | Checks for uncommitted changes (asks the user how to proceed if working tree is dirty), pushes branch via `simple-git`, creates/updates PR, reads diff to summarize what's done and what's next, posts `/pi` comment with structured handoff payload |
| `/review` | User types `/review` | Fetches PR review comments via `get_thread`, presents them for the user to address locally |

---

## 6. Auto Behavior

On `session_start`:
1. Detect current branch via `simple-git`
2. Resolve branch → PR number via GitHub API
3. If linked PR found: inject PR metadata + last 3-5 comments as session context
4. If no linked PR: silent, no action

---

## 7. Refactoring Required

### 7.1 New Package: `pi-forge-client`

Extract from `pi-platform-github`:
- `src/tools/thread.ts` → raw `getIssueOrPRThread()` function (accept `{ client: ForgeClient, logger }`, no `GitHubModuleDeps`)
- `src/tools/pr-diff.ts` → raw `fetchPRDiff()` + filter helpers
- `pi-orchestrator/src/pi/tools/common.ts` → formatting helpers
- `pi-orchestrator/src/pi/tools/get-pr-diff.ts` → truncation helpers
- Shared types from `pi-orchestrator/src/platform/types.ts` (re-exported; originals remain for backward compatibility)

### 7.2 Refactor `pi-platform-github`

- Replace `GitHubModuleDeps` usage in data-fetching with `ForgeClient`-based functions from `pi-forge-client`
- Create an Octokit → `ForgeClient` adapter for GitHub
- Keep CI-specific context resolution as a thin wrapper
- `createPullRequest` stays in `pi-platform-github` with its Git Data API flow

---

## 8. Implementation Roadmap

### Phase 0: Foundation
- [ ] Create `packages/pi-forge-client` — define `ForgeClient` interface, extract shared types, data-fetching, helpers
- [ ] Create Octokit → `ForgeClient` adapter for GitHub
- [ ] Refactor `pi-platform-github` to consume `pi-forge-client`
- [ ] Validate existing tests still pass

### Phase 1: Bridge Scaffold
- [ ] Create `packages/pi-action-bridge` — package.json, tsconfig, Pi manifest
- [ ] Bridge class with git discovery (`simple-git`) + `ForgeClient` setup
- [ ] Platform detection from git remote (delegating to shared logic)
- [ ] Auth check (`GITHUB_TOKEN`/`GH_TOKEN` for API; git credentials for push)
- [ ] Tests for platform detection and bridge class

### Phase 2: Tools
- [ ] `get_thread` tool (delegates to `pi-forge-client`)
- [ ] `get_pr_diff` tool (delegates to `pi-forge-client`)
- [ ] `create_comment` tool (direct Octokit)
- [ ] `create_pull_request` tool (`simple-git` + Octokit)
- [ ] Tests for all tools

### Phase 3: Skills
- [ ] `/sync` skill
- [ ] `/handoff` skill
- [ ] `/review` skill

### Phase 4: Session Enrichment
- [ ] Auto-detect branch → PR on session start (controlled by `auto_sync` config, see §9)
- [ ] Inject PR metadata + last 3-5 comments
- [ ] Tests for session enrichment

### Phase 5: Codeberg Support
- [ ] Codeberg → `ForgeClient` adapter using Gitea API
- [ ] Platform detection for Codeberg
- [ ] Tests for Codeberg support

---

## 9. Configuration

```jsonc
// .pi/settings.json or ~/.pi/agent/settings.json
{
  "pi-action-bridge": {
    "platform": "auto",           // "auto" | "github" | "codeberg" | "forgejo"
    "forgejo_url": "",            // Required for Forgejo
    "auto_sync": true             // Auto-inject thread context on session start (see §6)
  }
}
```

---

## 10. Naming

- **Shared package:** `@alexanderfortin/pi-forge-client` (`packages/pi-forge-client`)
- **Extension package:** `@alexanderfortin/pi-action-bridge` (`packages/pi-action-bridge`)
- **Extension namespace:** `pi-action-bridge`
- **Skills:** `/handoff`, `/sync`, `/review`
- **Tools:** `get_thread`, `get_pr_diff`, `create_comment`, `create_pull_request`

---

## 11. Interaction with `pi-coding-agent-action`

| Convention | Local Extension | CI Action |
|-----------|----------------|-----------|
| **Handoff comments** | Writes `/pi` comment with structured HTML payload | Reads it as a normal `/pi` invocation |
| **Thread context** | Reads threads via `pi-forge-client` | Reads threads via `pi-forge-client` (after refactor) |
| **CI results** | Reads action's result comments in the thread | Writes result comments |
| **`/pi` trigger** | Posts steering comments via `create_comment` | Detects and processes |

No changes to the CI action are required. The handoff works via the existing `/pi` comment convention.

---

*This constitution reflects resolved design decisions from the grilling session of 2026-06-09 and incorporates review feedback. Update as the project evolves.*

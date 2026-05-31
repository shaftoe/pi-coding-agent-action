# Phase 1: Extract Reusable Pi Orchestrator Library

**Parent Issue:** #233 — Pivot to reusable Pi orchestrator app  
**Scope:** Refactor the codebase into a reusable core library + thin GitHub Action shell  
**Goal:** Enable the Pi orchestration logic to be consumed by alternative frontends (GitHub App, CLI, web UI) without forking or duplicating code.

---

## 1. Problem Statement

Today the entire codebase is structured around `@actions/core` and `@actions/github`. The business logic — configuration, agent lifecycle, session management, tool registration — is interleaved with GitHub Actions specifics:

| Coupling Point | Current Location | GitHub Actions Dependency |
|---|---|---|
| Config gathering | `ActionOrchestrator.gatherConfig()` | `core.getInput()` for every field |
| Logging/output | `CoreAdapter`, `pi/logging.ts` | `::group::`/`::endgroup::`, `core.info()`, `core.setFailed()` |
| Session export paths | `ActionOrchestrator.exportSessionOutput()` | `RUNNER_TEMP`, `GITHUB_RUN_ID` env vars |
| Platform context | `createGitHubPlatformProvider()` | `@actions/github` `context` singleton |
| System prompt | `pi/prompt.ts` | Hardcoded "GitHub Actions CI/CD environment" |
| Entry point | `run.ts` | Imports `@actions/core` directly |

This means the Pi agent orchestration cannot be reused by a GitHub App webhook handler, a standalone CLI, or a web service without pulling in the entire GitHub Actions runtime.

## 2. Target Architecture

```
┌─────────────────────────────────────────────────┐
│                 Frontends (thin)                 │
│  ┌──────────┐ ┌────────────┐ ┌───────────────┐  │
│  │ GH Action│ │ GitHub App │ │  CLI / Web    │  │
│  │  (run.ts)│ │ (webhook)  │ │  (future)     │  │
│  └────┬─────┘ └─────┬──────┘ └──────┬────────┘  │
│       │              │               │           │
│  ┌────▼──────────────▼───────────────▼────────┐  │
│  │          pi-orchestrator (library)          │  │
│  │                                             │  │
│  │  ┌─────────────┐  ┌──────────────────────┐  │  │
│  │  │ Orchestrator│  │   PlatformProvider   │  │  │
│  │  │ (reusable)  │  │    (interface)       │  │  │
│  │  └─────────────┘  └──────────────────────┘  │  │
│  │  ┌─────────────┐  ┌──────────────────────┐  │  │
│  │  │  PiAgent    │  │   Logger (interface)  │  │  │
│  │  │ (unchanged) │  │                      │  │  │
│  │  └─────────────┘  └──────────────────────┘  │  │
│  │  ┌─────────────┐  ┌──────────────────────┐  │  │
│  │  │  Tools      │  │  Config (interface)   │  │  │
│  │  │ (unchanged) │  │                      │  │  │
│  │  └─────────────┘  └──────────────────────┘  │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │           Platform Implementations           │  │
│  │  ┌──────────────┐  ┌──────────────────────┐  │  │
│  │  │ GH Platform  │  │  App Platform        │  │  │
│  │  │ (octokit +   │  │  (octokit +          │  │  │
│  │  │  actions ctx)│  │   app installation)  │  │  │
│  │  └──────────────┘  └──────────────────────┘  │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

## 3. Detailed Changes

### 3.1 New `Logger` Interface (replaces `CoreAdapter` for internal use)

**File:** `src/types.ts` (modify) + `src/orchestrator.ts` (consume)

The `CoreAdapter` interface is a 1:1 wrapper around `@actions/core`. We need a platform-neutral logging interface that the orchestrator and Pi internals depend on instead.

```typescript
// src/types.ts — NEW interface
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  notice(message: string): void;
  error(message: string): void;
}
```

**Migration plan:**
1. Add `Logger` interface to `src/types.ts`.
2. Update `ActionOrchestrator` constructor to accept `Logger` instead of `CoreAdapter` for logging operations.
3. Keep `CoreAdapter` extending `Logger` and adding the GitHub Actions-specific methods (`getInput`, `setOutput`, `setFailed`).
4. Update `pi/logging.ts` to depend on `Logger` instead of `CoreAdapter`.
5. Update `pi/resource-loader.ts` to accept `Logger` instead of `CoreAdapter`.
6. Update `pi/agent.ts` to accept `Logger` instead of `CoreAdapter`.

**Files changed:**
- `src/types.ts` — add `Logger` interface
- `src/orchestrator.ts` — use `Logger` for internal logging
- `src/pi/agent.ts` — accept `Logger`
- `src/pi/resource-loader.ts` — accept `Logger`
- `src/pi/logging.ts` — accept `Logger`
- `src/adapters/core-adapter.ts` — `CoreAdapter extends Logger`

### 3.2 New `OrchestratorConfig` Interface (replaces `gatherConfig`)

**File:** `src/types.ts` (add), `src/orchestrator.ts` (modify)

Currently `ActionOrchestrator.gatherConfig()` calls `this.core.getInput()` — this couples config resolution to GitHub Actions. Extract config into a plain interface and let each frontend provide its own implementation.

```typescript
// src/types.ts — NEW interface
export interface OrchestratorConfig {
  /** LLM provider (e.g., "anthropic", "openai") */
  provider: string;
  /** Model identifier (e.g., "claude-sonnet-4-5") */
  model: string;
  /** API token for the LLM provider */
  token: string;
  /** Thinking/reasoning level */
  thinkingLevel: string;
  /** Raw prompt input (may be overridden by platform prompt) */
  promptInput: string;
  /** Extension sources to load */
  extensions?: string[];
  /** Whether to load built-in platform extensions */
  loadBuiltinExtensions?: boolean;
  /** Tool allowlist (undefined = all) */
  loadedTools?: string[];
  /** Provider base URL override */
  baseUrl?: string;
  /** Export session as HTML */
  exportSessionHtml?: boolean;
  /** Export session as JSONL */
  exportSessionJsonl?: boolean;
  /** Enable auto-compaction */
  autoCompaction?: boolean;
  /** Max diff lines for get_pr_diff tool */
  diffMaxLines?: number;
  /** Max diff bytes for get_pr_diff tool */
  diffMaxBytes?: number;
  /** File patterns to ignore in diffs */
  diffIgnorePatterns?: string[];
  /** System prompt override */
  systemPrompt?: string;
}
```

The orchestrator constructor changes from accepting `CoreAdapter` to accepting a pre-built `OrchestratorConfig`:

```typescript
// Before:
constructor(core: CoreAdapter, git: GitAdapter, piAgentFactory, platformProvider)

// After:
constructor(config: OrchestratorConfig, logger: Logger, git: GitAdapter, piAgentFactory, platformProvider)
```

The GitHub Action frontend (`run.ts`) becomes responsible for building the config from `@actions/core` inputs:

```typescript
// src/adapters/config.ts — NEW file
import * as core from '@actions/core';
import type { OrchestratorConfig } from '../types';

export function gatherActionsConfig(): OrchestratorConfig {
  // ... current gatherConfig() logic, but returns OrchestratorConfig
}
```

**Files changed:**
- `src/types.ts` — add `OrchestratorConfig`
- `src/orchestrator.ts` — accept `OrchestratorConfig` instead of `CoreAdapter`; remove `gatherConfig()`
- `src/adapters/config.ts` — NEW: extract config gathering from `@actions/core` inputs
- `src/run.ts` — use `gatherActionsConfig()` before constructing orchestrator

### 3.3 New `OutputSink` Interface (replaces output side-effects)

**File:** `src/types.ts` (add), `src/orchestrator.ts` (modify)

Session export and output setting currently use `RUNNER_TEMP`/`GITHUB_RUN_ID` env vars and `core.setOutput()`. Abstract these into an interface:

```typescript
// src/types.ts — NEW interface
export interface OutputSink {
  /** Set a named output (e.g., "response", "success", "duration_seconds") */
  setOutput(name: string, value: string | number | boolean): void;
  /** Mark the run as failed */
  setFailed(error: Error): void;
  /** Resolve a temp directory for session exports */
  getExportDirectory(format: 'html' | 'jsonl'): string;
}
```

**GitHub Actions implementation:**
```typescript
// src/adapters/output-sink.ts — NEW file
export class ActionsOutputSink implements OutputSink {
  setOutput(name, value) { core.setOutput(name, value); }
  setFailed(error) { core.setFailed(error); }
  getExportDirectory(format) {
    return path.join(
      process.env.RUNNER_TEMP ?? os.tmpdir(),
      `pi-session-${format}-${process.env.GITHUB_RUN_ID ?? 'local'}`
    );
  }
}
```

**GitHub App implementation (future):**
```typescript
// Would store outputs in DB, use different temp dir strategy
class AppOutputSink implements OutputSink { ... }
```

**Files changed:**
- `src/types.ts` — add `OutputSink` interface
- `src/orchestrator.ts` — use `OutputSink` instead of `CoreAdapter` for outputs; move `exportSessionOutput()` to use `outputSink.getExportDirectory()`
- `src/adapters/output-sink.ts` — NEW: `ActionsOutputSink`

### 3.4 Abstract System Prompt

**File:** `src/pi/prompt.ts` (modify), `src/pi/resource-loader.ts` (modify)

Currently the system prompt is hardcoded to "GitHub Actions CI/CD environment". Make it configurable via `OrchestratorConfig.systemPrompt`:

```typescript
// src/pi/resource-loader.ts
export async function getResourceLoader(
  logger: Logger,
  provider: PlatformProvider,
  config?: ResourceLoaderConfig
): Promise<DefaultResourceLoader> {
  // ...
  systemPromptOverride: () => config?.systemPrompt ?? SYSTEM_PROMPT,
  // ...
}
```

The default `SYSTEM_PROMPT` constant remains for backwards compatibility. Frontends can override it.

**Files changed:**
- `src/pi/prompt.ts` — no changes (keep default as-is)
- `src/pi/resource-loader.ts` — accept `systemPrompt` from config
- `src/types.ts` — add `systemPrompt` to `ResourceLoaderConfig` and `OrchestratorConfig`

### 3.5 Abstract Logging Formatting

**File:** `src/pi/logging.ts` (modify)

The `loggingFactory` uses GitHub Actions-specific formatting (`::group::`, `::endgroup::`). Add a `LogFormatter` to `Logger` or create a separate abstraction:

```typescript
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  notice(message: string): void;
  error(message: string): void;
  /** Start a collapsible log group. No-op if not supported. */
  startGroup?(title: string): void;
  /** End a collapsible log group. No-op if not supported. */
  endGroup?(): void;
}
```

The `ActionsCoreAdapter` implements `startGroup`/`endGroup` with `core.startGroup`/`core.endGroup`. Other implementations can no-op or use different formatting.

**Files changed:**
- `src/types.ts` — add optional `startGroup`/`endGroup` to `Logger`
- `src/adapters/core-adapter.ts` — implement `startGroup`/`endGroup`
- `src/pi/logging.ts` — use `logger.startGroup?.()` instead of raw `::group::`

### 3.6 Decouple `PlatformProvider` from `@actions/github`

**File:** `src/platform/github/provider.ts` (modify)

Currently `createGitHubPlatformProvider()` imports `context` from `@actions/github` directly. Refactor to accept an explicit `Octokit` + context:

```typescript
// Before:
export function createGitHubPlatformProvider(): PlatformProvider {
  // uses `context` singleton from @actions/github
}

// After:
export interface GitHubPlatformDeps {
  octokit: Octokit;
  context: PlatformContext;
}

export function createGitHubPlatformProvider(deps: GitHubPlatformDeps): PlatformProvider {
  // uses injected deps instead of global singleton
}
```

**GitHub Actions frontend** provides deps from `@actions/github`:
```typescript
// run.ts
import { context, getOctokit } from '@actions/github';

const octokit = getOctokit(core.getInput('github_token'));
const provider = createGitHubPlatformProvider({ octokit, context: extractContext(context) });
```

**GitHub App frontend** (future) provides deps from webhook payload:
```typescript
const octokit = new Octokit({ auth: installationToken });
const provider = createGitHubPlatformProvider({ octokit, context: appContext });
```

This is the most impactful change because it removes the singleton dependency and makes the platform implementation truly injectable.

**Files changed:**
- `src/platform/github/provider.ts` — accept `GitHubPlatformDeps` parameter
- `src/platform/github/context.ts` — add helper to build `PlatformContext` from explicit args
- `src/platform/github/octokit.ts` — accept `Octokit` instance instead of creating one
- `src/platform/github/reactions.ts` — accept `Octokit` + context as params
- `src/platform/github/comments.ts` — accept `Octokit` + context as params
- `src/platform/github/tools/*.ts` — accept `Octokit` + context as params
- `src/adapters/git-adapter.ts` — pass deps to provider
- `src/run.ts` — create Octokit + context and pass to provider

### 3.7 Restructure as Monorepo (optional, can be Phase 1b)

To make the library independently consumable, restructure into:

```
packages/
  pi-orchestrator/         # The reusable library
    src/
      orchestrator.ts
      types.ts
      pi/
      platform/
    package.json
    tsconfig.json

  pi-github-action/        # The GitHub Action frontend
    src/
      run.ts
      adapters/
    action.yml
    package.json

  pi-github-app/           # Future: GitHub App frontend
    src/
      webhook-handler.ts
    package.json
```

**This is optional in Phase 1.** The structural separation can also be achieved within the current single-package layout by establishing clear import boundaries (the library code never imports from `@actions/*`).

**Decision point:** If we skip the monorepo split in Phase 1, enforce the boundary via an ESLint rule:
```javascript
// .eslintrc.js
'no-restricted-imports': ['error', {
  patterns: [{
    group: ['@actions/*'],
    message: 'Library code must not import @actions/* directly. Use adapter interfaces instead.'
  }],
  paths: [{
    name: '@actions/core',
    message: 'Use Logger/OutputSink interfaces instead.',
    allowTypeImports: false
  }]
}]
```

## 4. Implementation Order

The changes should be implemented in this order to maintain a working codebase at each step:

| Step | Change | Risk | Test Impact |
|------|--------|------|-------------|
| 1 | Add `Logger` interface, update `CoreAdapter extends Logger` | Low | Update `tests/helpers/fakes.ts` to implement `Logger` |
| 2 | Update `pi/agent.ts`, `pi/resource-loader.ts`, `pi/logging.ts` to use `Logger` | Low | Update `tests/pi/*.spec.ts` |
| 3 | Add `OrchestratorConfig`, extract `gatherActionsConfig()` | Medium | Update `tests/orchestrator.spec.ts` to pass config directly |
| 4 | Add `OutputSink`, extract `ActionsOutputSink` | Low | Add `tests/adapters/output-sink.spec.ts` |
| 5 | Make system prompt configurable | Low | Update `tests/pi/resource-loader.spec.ts` |
| 6 | Abstract logging formatting (`startGroup`/`endGroup`) | Low | Update `tests/pi/logging.spec.ts` |
| 7 | Decouple `PlatformProvider` from `@actions/github` | **High** | Update all `tests/platform/github/*.spec.ts` |
| 8 | Update `run.ts` to wire everything through new interfaces | Medium | E2E test |
| 9 | Add ESLint import boundary rule | Low | CI |

## 5. Interface Summary (New Types)

```typescript
// ─── src/types.ts additions ───

/** Platform-neutral logging interface. */
export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  notice(message: string): void;
  error(message: string): void;
  startGroup?(title: string): void;
  endGroup?(): void;
}

/** Output and failure handling interface. */
export interface OutputSink {
  setOutput(name: string, value: string | number | boolean): void;
  setFailed(error: Error): void;
  getExportDirectory(format: 'html' | 'jsonl'): string;
}

/** Full orchestrator configuration, frontend-agnostic. */
export interface OrchestratorConfig {
  provider: string;
  model: string;
  token: string;
  thinkingLevel: string;
  promptInput: string;
  extensions?: string[];
  loadBuiltinExtensions?: boolean;
  loadedTools?: string[];
  baseUrl?: string;
  exportSessionHtml?: boolean;
  exportSessionJsonl?: boolean;
  autoCompaction?: boolean;
  diffMaxLines?: number;
  diffMaxBytes?: number;
  diffIgnorePatterns?: string[];
  systemPrompt?: string;
}
```

## 6. Updated `ActionOrchestrator` (Pseudocode)

```typescript
export class ActionOrchestrator {
  constructor(
    private readonly config: OrchestratorConfig,
    private readonly logger: Logger,
    private readonly outputSink: OutputSink,
    private readonly git: GitAdapter,
    private readonly piAgentFactory: PiAgentFactory,
    private readonly platformProvider: PlatformProvider,
  ) {}

  async execute(): Promise<void> {
    this.logger.info(`running action v${__VERSION__}`);
    // ... same flow, but:
    // - uses this.config instead of this.gatherConfig()
    // - uses this.logger instead of this.core for logging
    // - uses this.outputSink instead of this.core for outputs
  }
}
```

## 7. Updated `run.ts` (Pseudocode)

```typescript
import * as core from '@actions/core';
import { ActionOrchestrator } from './orchestrator';
import { RealCoreAdapter } from './adapters/core-adapter';
import { RealGitAdapter } from './adapters/git-adapter';
import { createRealPiAgent } from './adapters/pi-agent-adapter';
import { gatherActionsConfig } from './adapters/config';
import { ActionsOutputSink } from './adapters/output-sink';
import { createGitHubPlatformProvider } from './platform';

export async function run() {
  const coreAdapter = new RealCoreAdapter();
  const config = gatherActionsConfig();
  const outputSink = new ActionsOutputSink();
  const gitAdapter = new RealGitAdapter(coreAdapter);
  const platformProvider = createGitHubPlatformProvider();

  const orchestrator = new ActionOrchestrator(
    config,
    coreAdapter,       // CoreAdapter extends Logger
    outputSink,
    gitAdapter,
    createRealPiAgent,
    platformProvider,
  );

  await orchestrator.execute();
}
```

## 8. What This Enables (Future Phases)

Once Phase 1 is complete:

- **GitHub App** — Write a webhook handler that constructs `OrchestratorConfig` from the webhook payload, creates a `PlatformProvider` with an installation-scoped Octokit, and calls `orchestrator.execute()`. No code duplication.

- **CLI** — `bin.ts` reads config from CLI flags/env, constructs `OrchestratorConfig`, uses a stdout-based `Logger` and filesystem `OutputSink`.

- **Web UI** — HTTP handler constructs config from request, streams `Logger` output to WebSocket.

## 9. Non-Goals for Phase 1

- Monorepo restructuring (can be deferred)
- Building the actual GitHub App or CLI frontend
- Changing the public API of the GitHub Action (action.yml stays the same)
- Adding new platform implementations (e.g., GitLab)
- Streaming/real-time response delivery to frontends

## 10. Acceptance Criteria

- [ ] `ActionOrchestrator` does not import `@actions/core` or `@actions/github`
- [ ] `src/pi/` modules depend only on `Logger`, not `CoreAdapter`
- [ ] `OrchestratorConfig` is a plain interface with no platform dependencies
- [ ] `PlatformProvider` can be constructed without `@actions/github` context singleton
- [ ] GitHub Action behavior is identical (all existing tests pass, action.yml unchanged)
- [ ] ESLint rule prevents `@actions/*` imports in library code
- [ ] `bun run validate` passes
- [ ] Test coverage does not decrease

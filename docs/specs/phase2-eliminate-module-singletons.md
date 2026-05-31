# Phase 2: Eliminate Module-Level Singletons and `@actions/github` Fallbacks

**Parent Issue:** #233 — Pivot to reusable Pi orchestrator app  
**Depends on:** Phase 1 (PR #235) — Extract reusable Pi orchestrator library  
**Scope:** Remove all remaining `@actions/github` singleton imports and `GitHubModuleContext` module-level state from `src/platform/github/`, replacing them with explicit dependency injection  
**Goal:** Make the `platform/github/` implementation fully injectable so it can be used by a GitHub App, CLI, or any frontend without any `@actions/*` dependency or global mutable state.

---

## 1. Problem Statement

Phase 1 established the right abstractions (`Logger`, `OutputSink`, `PiConfig`, `PlatformProvider` with `GitHubPlatformDeps`) and made the orchestrator and `pi/` modules platform-agnostic. However, the **implementation layer** under `src/platform/github/` still has significant coupling:

### 1.1 Module-Level Singleton State

`src/platform/github/index.ts` manages a `GitHubModuleContext` singleton that holds:
- `CoreAdapter` (for logging and `getInput('trigger')`)
- `Octokit` instance
- `PlatformContext` (repo, issue, event payload)

This singleton is set once during initialization and accessed throughout the module via `getCoreAdapter()`, `getModuleOctokit()`, and `getModulePlatformContext()`. This pattern:

- **Prevents multi-tenancy** — a GitHub App handling concurrent webhooks cannot have separate contexts per request
- **Makes testing harder** — every test must call `resetModuleContext()` before/after
- **Couples platform code to action lifecycle** — the singleton must be initialized before any function can be called

### 1.2 `@actions/github` Fallback Imports

9 files under `src/platform/github/` import `@actions/github` directly:

| File | Import | Usage |
|---|---|---|
| `octokit.ts` | `import * as github from '@actions/github'` | `github.getOctokit()` fallback |
| `context.ts` | `import * as github from '@actions/github'` | `github.context` fallback for `ctx()` |
| `context-utils.ts` | `import * as github from '@actions/github'` | `github.context` fallback for `ctx()` |
| `context-accessor.ts` | `import * as github from '@actions/github'` | `github.context` fallback for `getGitHubContext()` |
| `comments.ts` | `import * as github from '@actions/github'` | `github.context` fallback for `ctx()` |
| `reactions.ts` | `import * as github from '@actions/github'` | `github.context` fallback for `ctx()` |
| `provider.ts` | `import * as github from '@actions/github'` | `github.context` fallback + `getOctokit` type |
| `pull-request-update.ts` | `import * as github from '@actions/github'` | `github.context.issue?.number` in validation |

Every one of these has the same pattern:
```typescript
function ctx(): typeof github.context {
  try {
    const pc = getModulePlatformContext();
    return pc as unknown as typeof github.context;
  } catch {
    return github.context;  // ← fallback to @actions/github singleton
  }
}
```

### 1.3 `getOctokit()` Singleton Accessor

`src/platform/github/octokit.ts` provides a lazy-creating `getOctokit()` that:
1. Tries the injected Octokit from `GitHubModuleContext`
2. Falls back to `github.getOctokit(getCoreAdapter().getInput('github_token'))`

This means 10+ files call `getOctokit()` as a free function instead of receiving Octokit through DI.

### 1.4 `getCoreAdapter()` for Logging

11 files call `getCoreAdapter().debug()` (or `.notice()`, `.info()`) for logging instead of using the `Logger` interface. This means platform code depends on `CoreAdapter` (a `@actions/core` interface) rather than the platform-neutral `Logger`.

### 1.5 Redundant `GitAdapter` Layer

`src/adapters/git-adapter.ts` (`RealGitAdapter`) is a thin wrapper that delegates every method to `PlatformProvider` or module-level functions. The orchestrator already has `PlatformProvider` injected — the `GitAdapter` interface is redundant and adds unnecessary indirection.

---

## 2. Target Architecture

### 2.1 Dependency Injection via `GitHubModuleDeps`

Replace the singleton pattern with a single `GitHubModuleDeps` object that is threaded through all platform functions:

```typescript
/**
 * Dependencies required by the GitHub platform module.
 *
 * All platform functions receive these deps explicitly — no singletons,
 * no @actions/github fallbacks, no module-level mutable state.
 */
export interface GitHubModuleDeps {
  /** Pre-authenticated Octokit instance. */
  readonly octokit: Octokit;
  /** Platform context (repo, issue, event payload, etc.). */
  readonly context: PlatformContext;
  /** Platform-neutral logger. */
  readonly logger: Logger;
}
```

### 2.2 No More `@actions/github` Imports in Platform Code

All `import * as github from '@actions/github'` statements are removed from `src/platform/github/`. The `@actions/github` package is only used in:
- `src/run.ts` (action entry point)
- `src/adapters/core-adapter.ts` (Logger implementation)
- `src/adapters/config.ts` (config gathering)
- `src/adapters/output-sink.ts` (output handling)

### 2.3 No More Singleton Module Context

The `GitHubModuleContext` class and its associated `setCoreAdapter()` / `getCoreAdapter()` / `setOctokit()` / `getModuleOctokit()` / `setPlatformContext()` / `getModulePlatformContext()` functions are removed from `src/platform/github/index.ts`.

### 2.4 Eliminate `GitAdapter` Redundancy

The orchestrator talks directly to `PlatformProvider` instead of through `GitAdapter`. `GitAdapter` interface and `RealGitAdapter` implementation are removed.

---

## 3. Detailed Changes

### 3.1 Create `GitHubModuleDeps` Interface

**File:** `src/platform/github/types.ts` (modify)

Add the new interface:

```typescript
import type { Logger } from '../../types';
import type { PlatformContext } from '../types';

type OctokitInstance = ReturnType<typeof import('@octokit/rest').Octokit>;

export interface GitHubModuleDeps {
  readonly octokit: OctokitInstance;
  readonly context: PlatformContext;
  readonly logger: Logger;
}
```

### 3.2 Refactor All Platform Functions to Accept `deps` Parameter

Every function that currently calls `getOctokit()`, `getModulePlatformContext()`, or `getCoreAdapter()` will instead receive `deps: GitHubModuleDeps` as its first parameter.

#### 3.2.1 Reactions (`src/platform/github/reactions.ts`)

**Before:**
```typescript
import { getOctokit } from './octokit';
import { getCoreAdapter, getModulePlatformContext } from './index';

function ctx() { /* fallback pattern */ }
function debug(msg: string) { getCoreAdapter().debug(msg); }

export async function addReaction(): Promise<CreateReactionType | undefined> {
  const octokit = getOctokit();
  // ...uses ctx()...
}
```

**After:**
```typescript
import type { GitHubModuleDeps } from './types';

export async function addReaction(deps: GitHubModuleDeps): Promise<CreateReactionType | undefined> {
  const { octokit, context, logger } = deps;
  const comment = context.payload.comment;
  if (!comment) {
    logger.debug('[reactions] no comment found, skipping reaction');
    return;
  }
  // ...use octokit and context directly...
}
```

#### 3.2.2 Comments (`src/platform/github/comments.ts`)

**Before:**
```typescript
import { getOctokit } from './octokit';
import { getCoreAdapter, getModulePlatformContext } from './index';

function ctx() { /* fallback pattern */ }
function debug(msg: string) { getCoreAdapter().debug(msg); }

export async function createFinalComment(body: string, metadata?: CommentMetadata) {
  const octokit = getOctokit();
  // ...
}
```

**After:**
```typescript
import type { GitHubModuleDeps } from './types';

export async function createFinalComment(
  deps: GitHubModuleDeps,
  body: string,
  metadata?: CommentMetadata
) {
  const { octokit, context, logger } = deps;
  // ...use context.repo, context.issue, context.serverUrl, etc. directly...
}
```

#### 3.2.3 Context (`src/platform/github/context.ts`)

**Before:**
```typescript
import * as github from '@actions/github';
import { getCoreAdapter, getModulePlatformContext } from './index';

function ctx() { /* fallback pattern */ }
function debug(msg: string) { getCoreAdapter().debug(msg); }
function getTrigger() { return getCoreAdapter().getInput('trigger') || DEFAULT_TRIGGER; }

export async function getPrompt(promptInput?: string): Promise<string | undefined> {
  // ...uses ctx(), getCoreAdapter()...
}
```

**After:**
```typescript
import type { GitHubModuleDeps } from './types';

export async function getPrompt(
  deps: GitHubModuleDeps,
  promptInput?: string,
  trigger?: string,
): Promise<string | undefined> {
  const { context, logger } = deps;
  const effectiveTrigger = trigger ?? DEFAULT_TRIGGER;
  // ...use context.eventName, context.payload, etc. directly...
}
```

**Note:** `getTrigger()` currently reads from `getCoreAdapter().getInput('trigger')`. Since Phase 1 moved config gathering to `gatherActionsConfig()`, the trigger should be passed as a parameter (from `PiConfig` or a new field). The `context.ts` file should not read action inputs.

#### 3.2.4 Context Utils (`src/platform/github/context-utils.ts`)

**Before:**
```typescript
import * as github from '@actions/github';
import { getModulePlatformContext } from './index';

function ctx() { /* fallback pattern */ }

export function isPR(): boolean {
  const eventType = ctx().eventName;
  // ...
}
```

**After:**
```typescript
import type { PlatformContext } from '../types';

export function isPR(context: PlatformContext): boolean {
  return context.eventName === 'pull_request' || context.payload.pull_request !== undefined;
}

export function getContextType(context: PlatformContext): 'issue' | 'pull_request' | undefined {
  if (isPR(context)) return 'pull_request';
  if (context.eventName === 'issue_comment' || context.eventName === 'issues') return 'issue';
  return undefined;
}
```

#### 3.2.5 Context Accessor (`src/platform/github/context-accessor.ts`)

**Remove entirely.** This file exists solely to provide a fallback-based `getGitHubContext()` function. After this phase, all code receives context explicitly.

#### 3.2.6 Octokit Module (`src/platform/github/octokit.ts`)

**Remove entirely.** Octokit is now passed through `GitHubModuleDeps`. No lazy creation, no fallback to `@actions/github`.

#### 3.2.7 Tools (`src/platform/github/tools/*.ts`)

All 8 tool implementation files currently call `getOctokit()` and some call `getCoreAdapter()` or `getModulePlatformContext()`. Each is refactored to accept `deps: GitHubModuleDeps`:

| File | Functions to Refactor | Current Coupling |
|---|---|---|
| `pull-request.ts` | `createPullRequest`, `determineBaseBranch`, `generatePullRequestBody`, `generateBranchName`, `createPullRequestOnGitHub` | `getOctokit()`, `getGitHubContext()` |
| `pull-request-update.ts` | `updatePullRequest`, `validateUpdatePullRequestParams`, `updatePullRequestMetadata` | `getOctokit()`, `getGitHubContext()`, `github.context.issue` |
| `thread.ts` | `getIssueOrPRThread`, helper functions | `getOctokit()`, `getCoreAdapter()` |
| `pr-diff.ts` | `fetchPRDiff` | `getOctokit()`, `getCoreAdapter()` |
| `review.ts` | `createReview`, `validateCreateReviewParams` | `getOctokit()`, `getCoreAdapter()` |
| `get-ci-status.ts` | `getCIStatus`, helper functions | `getOctokit()`, `getCoreAdapter()` |
| `get-workflow-run-logs.ts` | `getWorkflowRunLogs` | `getOctokit()`, `getCoreAdapter()` |
| `ci-utils.ts` | CI utility functions | `getOctokit()` |

**Example refactoring for `pull-request.ts`:**

**Before:**
```typescript
import { getGitHubContext } from '../context-accessor';
function ctx() { return getGitHubContext(); }
import { getOctokit } from '../octokit';

export async function createPullRequest(params: CreatePullRequestParams) {
  const octokit = getOctokit();
  const owner = ctx().repo.owner;
  // ...
}
```

**After:**
```typescript
import type { GitHubModuleDeps } from '../types';

export async function createPullRequest(deps: GitHubModuleDeps, params: CreatePullRequestParams) {
  const { octokit, context } = deps;
  const owner = context.repo.owner;
  // ...
}
```

For pure logic functions that only use context for reading (like `generateBranchName`, `slugify`, `validateCreatePullRequestParams`), pass the specific values they need rather than the full deps:

```typescript
// Before:
export function generateBranchName(title: string, template?: string): string {
  const issueNumber = ctx().issue?.number ?? 'unknown';
  // ...
}

// After:
export function generateBranchName(title: string, issueNumber: number | undefined, template?: string): string {
  const num = issueNumber ?? 'unknown';
  // ...
}
```

#### 3.2.8 Git Operations (`src/platform/github/git/*.ts`)

The `git/` subdirectory files (`tree-builder.ts`, `file-scanner.ts`, `commit-creator.ts`) call `getOctokit()` and `getCoreAdapter()`. Refactor to accept `deps`:

**Before (`git/types.ts`):**
```typescript
import { getCoreAdapter } from '../index';

export function createLogger(emoji = '📦') {
  return {
    debug: (msg: string): void => getCoreAdapter().debug(`${emoji} ${msg}`),
    info: (msg: string): void => getCoreAdapter().info(`${emoji} ${msg}`),
  };
}
```

**After:**
```typescript
import type { Logger } from '../../../types';

export function createLogger(logger: Logger, emoji = '📦') {
  return {
    debug: (msg: string): void => logger.debug(`${emoji} ${msg}`),
    info: (msg: string): void => logger.info(`${emoji} ${msg}`),
  };
}
```

### 3.3 Refactor `PlatformProvider` Implementation

**File:** `src/platform/github/provider.ts`

The `createGitHubPlatformProvider()` function currently creates closures that call module-level functions. After refactoring, it creates a `deps` object once and passes it to all operations:

```typescript
export function createGitHubPlatformProvider(deps: GitHubPlatformDeps): PlatformProvider {
  const type = detectPlatform(deps.context.serverUrl);
  
  // Build the module deps object once
  const moduleDeps: GitHubModuleDeps = {
    octokit: deps.octokit,
    context: deps.context,
    logger: ???,  // ← need to accept Logger
  };
  
  return {
    type,
    getContext() { return deps.context; },
    async addReaction() { return addReaction(moduleDeps); },
    async deleteReaction(reaction) { await deleteReaction(moduleDeps, reaction); },
    async createFinalComment(body, metadata) { await createFinalComment(moduleDeps, body, metadata); },
    async getPrompt(inputPrompt) { return getPrompt(moduleDeps, inputPrompt); },
    getStartTime() { return getStartTimeFromContext(moduleMeps); },
    async createPullRequest(params) { return createPullRequest(moduleDeps, params); },
    async updatePullRequest(params) { return updatePullRequest(moduleDeps, params); },
    async getIssueOrPRThread(params) { return getIssueOrPRThread(moduleDeps, params); },
    async getPRDiff(owner, repo, pullNumber, ignoreFiles) { return fetchPRDiff(moduleDeps, owner, repo, pullNumber, ignoreFiles); },
    async createReview(params) { return createReview(moduleDeps, params); },
    async getCIStatus(params) { return getCIStatus(moduleDeps, params); },
    async getWorkflowRunLogs(params) { return getWorkflowRunLogs(moduleDeps, params); },
  };
}
```

**Key change:** `GitHubPlatformDeps` gains a `logger` field:

```typescript
export interface GitHubPlatformDeps {
  octokit: OctokitInstance;
  context: PlatformContext;
  logger: Logger;
}
```

Or alternatively, `GitHubPlatformDeps` extends or is replaced by `GitHubModuleDeps` since they carry the same three dependencies.

### 3.4 Remove `GitHubModuleContext` Singleton

**File:** `src/platform/github/index.ts`

Remove:
- `GitHubModuleContext` class
- `setCoreAdapter()` / `getCoreAdapter()`
- `setOctokit()` / `getModuleOctokit()`
- `setPlatformContext()` / `getModulePlatformContext()`
- `resetModuleContext()`
- `isModuleContextInitialized()`

The barrel export keeps re-exporting the public functions and types, but all function signatures now require explicit deps.

### 3.5 Remove `RealGitAdapter` and `GitAdapter` Interface

**Files:** `src/adapters/git-adapter.ts` (delete), `src/types.ts` (modify)

The `GitAdapter` interface:
```typescript
export interface GitAdapter {
  addReaction(): Promise<CreateReactionType | undefined>;
  deleteReaction(reaction: CreateReactionType | undefined): Promise<void>;
  createFinalComment(body: string, metadata: CommentMetadata): Promise<void>;
  getPrompt(inputPrompt?: string): Promise<string | undefined>;
  getStartTime(): Temporal.Instant | undefined;
}
```

...is a 1:1 subset of `PlatformProvider`. The orchestrator already receives `PlatformProvider`, so it can call these methods directly. Remove `GitAdapter` and update `ActionOrchestrator`:

**Before:**
```typescript
export class ActionOrchestrator {
  constructor(
    private readonly config: PiConfig,
    private readonly logger: Logger,
    private readonly outputSink: OutputSink,
    private readonly git: GitAdapter,        // ← redundant
    private readonly piAgentFactory: PiAgentFactory,
    private readonly platformProvider: PlatformProvider
  ) {}
}
```

**After:**
```typescript
export class ActionOrchestrator {
  constructor(
    private readonly config: PiConfig,
    private readonly logger: Logger,
    private readonly outputSink: OutputSink,
    private readonly piAgentFactory: PiAgentFactory,
    private readonly platformProvider: PlatformProvider
  ) {}
  
  // Replace this.git.addReaction() → this.platformProvider.addReaction()
  // Replace this.git.deleteReaction() → this.platformProvider.deleteReaction()
  // etc.
}
```

### 3.6 Update `PlatformProvider` Interface

**File:** `src/platform/types.ts`

The `PlatformProvider` interface needs to include `getStartTime()` (it already has most methods; verify it's complete). Currently `getStartTime()` is on `GitAdapter` but not on `PlatformProvider` — it should be moved there.

### 3.7 Update `run.ts` (Action Entry Point)

**File:** `src/run.ts`

Update to pass `logger` to the platform provider and remove `gitAdapter`:

```typescript
import * as core from '@actions/core';
import * as github from '@actions/github';
import { ActionOrchestrator } from './orchestrator';
import { RealCoreAdapter } from './adapters/core-adapter';
import { createRealPiAgent } from './adapters/pi-agent-adapter';
import { gatherActionsConfig } from './adapters/config';
import { ActionsOutputSink } from './adapters/output-sink';
import { createGitHubPlatformProvider } from './platform';

export async function run() {
  const coreAdapter = new RealCoreAdapter();
  const config = gatherActionsConfig();
  const outputSink = new ActionsOutputSink();

  const octokit = github.getOctokit(coreAdapter.getInput('github_token'));
  const platformContext = {
    repo: github.context.repo,
    issue: github.context.issue,
    eventName: github.context.eventName,
    payload: github.context.payload as Record<string, unknown>,
    serverUrl: github.context.serverUrl || 'https://github.com',
    runId: github.context.runId,
    workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
  };

  const platformProvider = createGitHubPlatformProvider({
    octokit,
    context: platformContext,
    logger: coreAdapter,  // CoreAdapter extends Logger
  });

  const orchestrator = new ActionOrchestrator(
    config,
    coreAdapter,
    outputSink,
    createRealPiAgent,
    platformProvider,
  );

  await orchestrator.execute();
}
```

### 3.8 Handle `trigger` Config

**File:** `src/adapters/config.ts`, `src/types.ts`, `src/platform/github/context.ts`

The `trigger` input (default `/pi`) is currently read from `getCoreAdapter().getInput('trigger')` inside `context.ts`. It should become part of `PiConfig`:

```typescript
// src/types.ts
export interface PiConfig extends DiffConfig {
  // ... existing fields ...
  /** Trigger command prefix (default: '/pi') */
  trigger?: string;
}

// src/adapters/config.ts
export function gatherActionsConfig(): PiConfig {
  return {
    // ... existing fields ...
    trigger: core.getInput('trigger') || undefined,
  };
}
```

The `PlatformProvider.getPrompt()` method signature may need updating to accept the trigger, or it can be passed via the config.

### 3.9 Update ESLint Boundary Rules

**File:** `eslint.config.mjs`

Extend the existing `no-restricted-imports` rule to cover `src/platform/github/`:

```javascript
{
  files: ["src/platform/github/**/*.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [{
          group: ["@actions/*"],
          message: "Platform code must not import @actions/* directly. Use GitHubModuleDeps for explicit DI.",
          allowTypeImports: false,
        }],
      },
    ],
  },
},
```

**Exception:** `src/platform/github/index.ts` barrel file may need type-only imports from `@actions/github` for the `OctokitInstance` type. These should be replaced with `@octokit/rest` types directly.

---

## 4. Files Changed Summary

| File | Action | Description |
|---|---|---|
| `src/platform/github/types.ts` | **Modify** | Add `GitHubModuleDeps` interface |
| `src/platform/github/provider.ts` | **Modify** | Accept `GitHubModuleDeps`, remove `@actions/github` import, pass `deps` to all operations |
| `src/platform/github/octokit.ts` | **Delete** | Octokit passed via deps, no singleton |
| `src/platform/github/context-accessor.ts` | **Delete** | No longer needed, context is explicit |
| `src/platform/github/index.ts` | **Modify** | Remove `GitHubModuleContext` class and all singleton accessors; update barrel exports |
| `src/platform/github/context.ts` | **Modify** | Accept `deps`, remove `@actions/github` import, accept `trigger` as parameter |
| `src/platform/github/context-utils.ts` | **Modify** | Accept `PlatformContext` param, remove `@actions/github` import |
| `src/platform/github/reactions.ts` | **Modify** | Accept `deps`, remove `@actions/github` and singleton imports |
| `src/platform/github/comments.ts` | **Modify** | Accept `deps`, remove `@actions/github` and singleton imports |
| `src/platform/github/tools/pull-request.ts` | **Modify** | Accept `deps`, remove `getOctokit()` and `getGitHubContext()` |
| `src/platform/github/tools/pull-request-update.ts` | **Modify** | Accept `deps`, remove `@actions/github`, `getOctokit()`, `getGitHubContext()` |
| `src/platform/github/tools/thread.ts` | **Modify** | Accept `deps`, remove `getOctokit()` and `getCoreAdapter()` |
| `src/platform/github/tools/pr-diff.ts` | **Modify** | Accept `deps`, remove `getOctokit()` and `getCoreAdapter()` |
| `src/platform/github/tools/review.ts` | **Modify** | Accept `deps`, remove `getOctokit()` and `getCoreAdapter()` |
| `src/platform/github/tools/get-ci-status.ts` | **Modify** | Accept `deps`, remove `getOctokit()` and `getCoreAdapter()` |
| `src/platform/github/tools/get-workflow-run-logs.ts` | **Modify** | Accept `deps`, remove `getOctokit()` and `getCoreAdapter()` |
| `src/platform/github/tools/ci-utils.ts` | **Modify** | Accept `deps`, remove `getOctokit()` |
| `src/platform/github/git/types.ts` | **Modify** | Accept `Logger` param in `createLogger`, remove `getCoreAdapter()` |
| `src/platform/github/git/tree-builder.ts` | **Modify** | Accept `deps` instead of calling `getOctokit()` |
| `src/platform/github/git/file-scanner.ts` | **Modify** | Accept `deps` instead of calling `getOctokit()` |
| `src/platform/github/git/commit-creator.ts` | **Modify** | Accept `deps` instead of calling `getOctokit()` |
| `src/platform/github/git/index.ts` | **Modify** | Update re-exports for new signatures |
| `src/types.ts` | **Modify** | Remove `GitAdapter` interface; add `trigger` to `PiConfig` |
| `src/adapters/git-adapter.ts` | **Delete** | Redundant — orchestrator uses `PlatformProvider` directly |
| `src/adapters/config.ts` | **Modify** | Add `trigger` field to config gathering |
| `src/orchestrator.ts` | **Modify** | Remove `GitAdapter` dependency; use `PlatformProvider` directly |
| `src/run.ts` | **Modify** | Remove `gitAdapter`, pass `logger` to platform provider |
| `eslint.config.mjs` | **Modify** | Add `no-restricted-imports` rule for `src/platform/github/` |
| **~20 test files** | **Modify** | Update all tests to pass `deps` / `PlatformContext` instead of using `resetModuleContext()` |

---

## 5. Implementation Order

Changes should be implemented in this order to maintain a working codebase at each step:

| Step | Change | Risk | Rationale |
|---|---|---|---|
| 1 | Add `GitHubModuleDeps` to `platform/github/types.ts` | Low | Foundation for all subsequent changes |
| 2 | Add `trigger` to `PiConfig` and `gatherActionsConfig()` | Low | Unblocks context.ts refactoring |
| 3 | Refactor `context-utils.ts` — accept `PlatformContext` param | Low | Pure utility, no side effects |
| 4 | Refactor `git/types.ts` — `createLogger` accepts `Logger` | Low | Foundation for git/ refactoring |
| 5 | Refactor `git/*.ts` — accept `deps` instead of `getOctokit()` | Medium | 3 files, but isolated |
| 6 | Refactor `tools/*.ts` — accept `deps` (8 files) | **High** | Largest change surface; do one tool at a time |
| 7 | Refactor `reactions.ts` — accept `deps` | Medium | Used by orchestrator |
| 8 | Refactor `comments.ts` — accept `deps` | Medium | Used by orchestrator |
| 9 | Refactor `context.ts` — accept `deps` and `trigger` param | Medium | Core prompt building |
| 10 | Refactor `provider.ts` — build `deps` once, pass to all ops | Medium | Wires everything together |
| 11 | Remove `GitAdapter` interface and `RealGitAdapter` | Medium | Orchestrator simplification |
| 12 | Update `orchestrator.ts` — use `PlatformProvider` directly | Medium | Remove `git` param |
| 13 | Update `run.ts` — wire everything through new interfaces | Low | Final wiring |
| 14 | Delete `octokit.ts` and `context-accessor.ts` | Low | Cleanup |
| 15 | Clean up `index.ts` — remove `GitHubModuleContext` singleton | Medium | Must be last since tests may still use `resetModuleContext()` |
| 16 | Update ESLint boundary rule | Low | Enforcement |
| 17 | Update all tests | **High** | Must be done alongside each step |

**Recommended approach:** For each step 3–10, update the production code AND its tests in the same commit. This keeps the tree green at every step.

---

## 6. Test Migration Strategy

### 6.1 Current Test Pattern

Tests currently use `resetModuleContext()` to inject mock adapters:

```typescript
import { resetModuleContext } from '../../../platform/github';

beforeEach(() => {
  resetModuleContext(mockCoreAdapter);
});

// Test calls function without deps
const result = await addReaction();
```

### 6.2 New Test Pattern

Tests construct `GitHubModuleDeps` explicitly:

```typescript
import type { GitHubModuleDeps } from '../../../platform/github/types';

const mockDeps: GitHubModuleDeps = {
  octokit: mockOctokit,
  context: mockPlatformContext,
  logger: mockLogger,
};

// Test calls function with deps
const result = await addReaction(mockDeps);
```

### 6.3 Test Helper Updates

Create a shared `createMockDeps()` helper in `tests/helpers/`:

```typescript
export function createMockDeps(overrides?: Partial<GitHubModuleDeps>): GitHubModuleDeps {
  return {
    octokit: createMockOctokit(),
    context: createMockPlatformContext(),
    logger: createMockLogger(),
    ...overrides,
  };
}
```

### 6.4 Test Files to Update

| Test File | Changes |
|---|---|
| `tests/platform/github/module-context.spec.ts` | **Delete** — singleton no longer exists |
| `tests/platform/github/provider.spec.ts` | Update to pass `logger` in deps |
| `tests/platform/github/reactions.spec.ts` | Pass `deps` to `addReaction` / `deleteReaction` |
| `tests/platform/github/comments.spec.ts` | Pass `deps` to `createFinalComment` |
| `tests/platform/github/context.spec.ts` | Pass `deps` to `getPrompt` |
| `tests/platform/github/pr-diff.spec.ts` | Pass `deps` to `fetchPRDiff` |
| `tests/platform/github/get-ci-status.spec.ts` | Pass `deps` to `getCIStatus` |
| `tests/platform/github/get-workflow-run-logs.spec.ts` | Pass `deps` to `getWorkflowRunLogs` |
| `tests/platform/github/pull-request-logic.spec.ts` | Pass `deps` to `createPullRequest` |
| `tests/platform/github/pull-request-update-logic.spec.ts` | Pass `deps` to `updatePullRequest` |
| `tests/platform/github/pull-request-update-integration.spec.ts` | Pass `deps` |
| `tests/platform/github/review-logic.spec.ts` | Pass `deps` to `createReview` |
| `tests/platform/github/git.spec.ts` | Pass `deps` |
| `tests/platform/github/git/commit-creator.spec.ts` | Pass `deps` |
| `tests/platform/github/git/file-scanner.spec.ts` | Pass `deps` |
| `tests/platform/github/git/tree-builder.spec.ts` | Pass `deps` |
| `tests/orchestrator.spec.ts` | Remove `gitAdapter` mock; use `platformProvider` directly |
| `tests/adapters/git-adapter.spec.ts` | **Delete** — `GitAdapter` removed |
| `tests/helpers/fakes.spec.ts` | Update fake implementations |
| `tests/pi/tools/*.spec.ts` | Update if they use `resetModuleContext` |

---

## 7. What This Enables (Next Phase)

Once Phase 2 is complete, the platform implementation is fully injectable:

### 7.1 GitHub App Usage (Phase 3)

```typescript
import { createGitHubPlatformProvider } from 'pi-coding-agent-action/platform/github';
import { ActionOrchestrator } from 'pi-coding-agent-action/orchestrator';

// In webhook handler
app.on('issue_comment.created', async ({ octokit, payload }) => {
  const provider = createGitHubPlatformProvider({
    octokit,
    context: {
      repo: { owner: payload.repository.owner.login, repo: payload.repository.name },
      issue: { number: payload.issue.number },
      eventName: 'issue_comment',
      payload,
      serverUrl: 'https://github.com',
      runId: 0,
      workspace: '/tmp/workspace',
    },
    logger: new AppLogger(),
  });

  const orchestrator = new ActionOrchestrator(
    { provider: 'anthropic', model: 'claude-sonnet-4-5', token: process.env.ANTHROPIC_KEY!, ... },
    new AppLogger(),
    new AppOutputSink(),
    createRealPiAgent,
    provider,
  );

  await orchestrator.execute();
});
```

### 7.2 CLI Usage

```typescript
const provider = createGitHubPlatformProvider({
  octokit: new Octokit({ auth: token }),
  context: { repo, issue, eventName, payload, serverUrl, runId: 0, workspace: cwd },
  logger: new ConsoleLogger(),
});
```

### 7.3 Multi-Tenant Web Service

Each request creates its own `GitHubModuleDeps` — no shared mutable state, safe for concurrent handling.

---

## 8. Non-Goals for Phase 2

- Building the actual GitHub App / CLI / Web frontend (Phase 3+)
- Monorepo restructuring / npm package extraction (Phase 4)
- Adding new platform implementations (GitLab, Bitbucket)
- Changing the public API of the GitHub Action (`action.yml` stays identical)
- Changing the `PlatformProvider` interface (only its implementation changes)
- Streaming / real-time response delivery

---

## 9. Acceptance Criteria

- [ ] Zero `import * as github from '@actions/github'` in `src/platform/github/` (except type-only imports if any)
- [ ] Zero `import ... from '@actions/core'` in `src/platform/github/`
- [ ] `GitHubModuleContext` class and all its accessors (`setCoreAdapter`, `getCoreAdapter`, `setOctokit`, `getModuleOctokit`, `setPlatformContext`, `getModulePlatformContext`, `resetModuleContext`) are removed
- [ ] `src/platform/github/octokit.ts` is deleted
- [ ] `src/platform/github/context-accessor.ts` is deleted
- [ ] `GitAdapter` interface and `RealGitAdapter` class are deleted
- [ ] `ActionOrchestrator` constructor takes 5 parameters instead of 6 (no `GitAdapter`)
- [ ] All platform functions accept `deps: GitHubModuleDeps` (or specific values) instead of reading from module state
- [ ] `@actions/*` packages are only imported in `src/run.ts`, `src/adapters/core-adapter.ts`, `src/adapters/config.ts`, `src/adapters/output-sink.ts`
- [ ] ESLint `no-restricted-imports` rule covers `src/platform/github/`
- [ ] `bun run validate` passes
- [ ] All existing tests pass with new signatures
- [ ] Test coverage does not decrease
- [ ] GitHub Action behavior is identical (action.yml unchanged)

---

## 10. Risk Assessment

| Risk | Mitigation |
|---|---|
| **Large change surface** — 25+ files modified | Implement in small, testable steps (one module per commit) |
| **Test breakage** — 20+ test files need updates | Update tests alongside each production change |
| **Signature changes** — all tool functions get new `deps` param | Use TypeScript compiler to catch missed call sites |
| **`trigger` config** — currently hidden in `context.ts` reading from action input | Make it explicit in `PiConfig` early (step 2) |
| **Pure logic functions** — `slugify`, `validateBranchName`, `generateBranchName` etc. should NOT need `deps` | Pass specific values (e.g., `issueNumber`) rather than full deps |
| **Git operations chain** — `createPullRequest` calls `buildFileMap` → `scanForChanges` → `createBlobsAndTree` → `createCommitAndUpdateBranch`, threading deps through the chain | Refactor `git/` first (steps 4–5), then tools can pass deps cleanly |
| **Backward compatibility** — `createGitHubPlatformProvider(deps?)` currently allows `undefined` for backward compat | Require `deps` parameter (breaking internal change, but action.yml stays the same) |

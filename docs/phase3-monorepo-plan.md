# Phase 3: Library Extraction — Monorepo Plan & Progress

**Issue:** [#241](https://github.com/shaftoe/pi-coding-agent-action/issues/241)
**Branch:** `feat/phase3-monorepo`
**Last updated:** 2026-06-03

---

## Overview

Transform the flat `src/` structure into a Bun workspace monorepo with three packages, so the core orchestration logic can be consumed as a library independent of GitHub Actions.

### Package Dependency Graph

```
pi-action  ──depends on──►  pi-platform-github
    │                            │
    │                            ▼
    └─────depends on──────►  pi-orchestrator
                                   │
                                   ▼
                              src/git/ (self-contained)
```

No cycles. `pi-orchestrator` has zero platform deps; `pi-platform-github` imports from orchestrator types; `pi-action` imports from both.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Test location | **Per-package** (`tests/` inside each package) | Better ownership, packages are self-contained |
| Build strategy | **`tsc` for type-checking only**; no dist build for library packages | Source consumed directly via workspace; CI builds dist when needed |
| Versioning | **Root owns versioning, all packages share the same version** | Simpler semantic-release config |
| Package scope | `@alexanderfortin/pi-orchestrator`, `@alexanderfortin/pi-platform-github`, `pi-action` | — |

---

## Pre-Requisites (Steps 1–2): COMPLETE ✅

All coupling points between library code and action-specific code were resolved before the monorepo split:

| # | Coupling Point | Resolution |
|---|----------------|------------|
| 1 | `process.stdout.write()` for thinking deltas | `AgentEvents` interface in `src/types.ts`; stdout calls in adapter only |
| 2 | `PI_PACKAGE_DIR` env var manipulation | `packageDir` field in `PiConfig`; env var in adapter only |
| 3 | `process.env.GITHUB_WORKSPACE` in file-scanner | Removed; workspace passed via config |
| 4 | `process.env.INPUT_BRANCH_NAME_TEMPLATE` | Via `GitHubModuleDeps.branchNameTemplate` |
| 5 | `process.env.GITHUB_SERVER_URL` for platform detection | `detectPlatform()` accepts explicit `platformType` parameter |
| 6-7 | `__VERSION__` / `__PI_CODING_AGENT_VERSION__` build constants | Runtime `getPackageVersion()` / `getPiVersion()` in `src/version.ts` |
| 8 | `process.cwd()` as implicit working directory | `ResourceLoaderConfig.cwd` parameter with fallback |

Result: zero `@actions/*` imports and zero `process.stdout.write` in library code.

---

## Current Implementation Status

### Steps 1–8 (Workspace Setup + File Moves + Imports): COMPLETE ✅

| Commit | Description | Status |
|--------|-------------|--------|
| `b4bdb59` | Create workspace skeleton (root workspaces, package.jsons, tsconfigs) | ✅ |
| `a3f947a` | Move source files into three packages (combined commits 2–4) | ✅ |
| `fef2811` | Fix all imports per package + add barrel exports (combined commits 5–8) | ✅ |

**All 906 tests passing, 0 failures.**

Key achievements:
- Three packages resolve correctly via Bun workspace symlinks
- Barrel exports: `@alexanderfortin/pi-orchestrator`, `@alexanderfortin/pi-platform-github`
- ESLint boundary rule blocks `@actions/*` in orchestrator code
- `scripts/package.ts` updated for new layout

### Steps 9–11 (Tests, Build, Boundaries): REMAINING ❌

| Step | Description | Status |
|------|-------------|--------|
| 9 | Move tests into packages (46 test files) | ❌ Not started |
| 10 | Update build system & CI workflows | ❌ Not started |
| 11 | ESLint boundary enforcement for `pi-platform-github` | ❌ Partially done |

---

## File Ownership Map

### `packages/pi-orchestrator/` — Core library

| Source Files | |
|---|---|
| `src/types.ts` | Core type definitions |
| `src/version.ts` | Runtime version resolution |
| `src/orchestrator.ts` | Business logic orchestrator |
| `src/platform/types.ts` | `PlatformProvider`, `PlatformContext` interfaces |
| `src/platform/index.ts` | Types-only barrel (no GitHub provider) |
| `src/git/*` (4 files) | Git operations (self-contained) |
| `src/pi/*` (5 files) | Pi agent integration |
| `src/pi/tools/*` (11 files) | Extension tools |

**Deps:** `@js-temporal/polyfill`, `typebox`, `ignore`, `@earendil-works/pi-coding-agent` (peer), `@earendil-works/pi-ai` (peer), `@earendil-works/pi-agent-core` (peer)

**Tests to move (17 files → `packages/pi-orchestrator/tests/`):**
- `tests/orchestrator.spec.ts`, `tests/version.spec.ts`
- `tests/git/file-scanner.spec.ts`
- `tests/pi/agent-logic.spec.ts`, `tests/pi/logging.spec.ts`, `tests/pi/package-patch.spec.ts`, `tests/pi/resource-loader.spec.ts`, `tests/pi/tools.spec.ts`
- `tests/pi/tools/common.spec.ts`, `tests/pi/tools/create-pr-execution.spec.ts`, `tests/pi/tools/create-review-execution.spec.ts`, `tests/pi/tools/execution-utils.spec.ts`, `tests/pi/tools/get-ci-status-execution.spec.ts`, `tests/pi/tools/get-pr-diff-execution.spec.ts`, `tests/pi/tools/get-thread-execution.spec.ts`, `tests/pi/tools/get-workflow-run-logs-execution.spec.ts`, `tests/pi/tools/update-pr-execution.spec.ts`

### `packages/pi-platform-github/` — GitHub/Codeberg/Forgejo provider

| Source Files | |
|---|---|
| `src/*` (19 files, flattened from `platform/github/`) | Provider, comments, reactions, PR logic, etc. |
| `src/git/*` (5 files) | GitHub-specific git operations |
| `src/tools/*` (9 files) | GitHub-specific tool implementations |

**Deps:** `@alexanderfortin/pi-orchestrator` (workspace), `@js-temporal/polyfill`, `@octokit/plugin-rest-endpoint-methods`, `@actions/github` (peer)

**Tests to move (22 files → `packages/pi-platform-github/tests/`):**
- `tests/platform/github/*.spec.ts` (17 files)
- `tests/platform/github/git/*.spec.ts` (3 files)
- `tests/platform/index.spec.ts`
- `tests/helpers/fakes.ts` + `tests/helpers/fakes.spec.ts`

### `packages/pi-action/` — GitHub Action wrapper

| Source Files | |
|---|---|
| `src/run.ts` | Action entry point |
| `src/adapters/*` (5 files) | `@actions/core` wrappers |
| `src/import-meta-url.js` | esbuild helper |
| `scripts/package.ts` | Bundling script |

**Deps:** both workspace packages, `@actions/core`, `@actions/github`, pi SDK packages

**Tests to move (3 files → `packages/pi-action/tests/`):**
- `tests/adapters/config.spec.ts`, `tests/adapters/git-adapter.spec.ts`, `tests/adapters/output-sink.spec.ts`

### Root (stays)

| Path | Notes |
|---|---|
| `.github/` | CI workflows |
| `.fallowrc.json` | Dead code analysis |
| `.releaserc.json` | Semantic release |
| `bunfig.toml` | Bun config |
| `package.json` | Workspace config + dev deps |
| `tests/e2e/` (2 files) | Cross-package integration tests |
| `action.yml` | Action manifest (GitHub Actions requires it at root) |

---

## Cross-Package Import Map

### `pi-platform-github` → `pi-orchestrator`

```typescript
// Before: relative paths through src/platform/../../types
import type { Logger } from '../../types';
import { scanForChanges } from '../../../git/file-scanner';

// After: workspace package
import type { Logger, SessionStats } from '@alexanderfortin/pi-orchestrator';
import { scanForChanges } from '@alexanderfortin/pi-orchestrator';
```

### `pi-action` → both packages

```typescript
// Before: relative imports from flat src/
import { ActionOrchestrator } from './orchestrator';
import { createGitHubPlatformProvider } from './platform';

// After: workspace packages
import { ActionOrchestrator } from '@alexanderfortin/pi-orchestrator';
import { createGitHubPlatformProvider } from '@alexanderfortin/pi-platform-github';
```

### `platform/index.ts` barrel split

- **`pi-orchestrator/src/platform/index.ts`** — exports types only
- **`pi-platform-github/src/index.ts`** — exports `createGitHubPlatformProvider`, `detectPlatform`, `GitHubModuleDeps`

---

## Remaining Steps — Detailed Plans

### Step 9: Move Tests into Packages

#### pi-orchestrator tests (from `tests/` → `packages/pi-orchestrator/tests/`)

Most imports get **one level shorter** because tests are now closer to source:

| Test file | Old import | New import |
|---|---|---|
| `orchestrator.spec.ts` | `../src/orchestrator` | `../src/orchestrator` (same!) |
| `version.spec.ts` | `../src/version` | `../src/version` (same!) |
| `git/file-scanner.spec.ts` | `../../src/git/file-scanner` | `../src/git/file-scanner` |
| `pi/logging.spec.ts` | `../../src/pi/logging` | `../src/pi/logging` |
| `pi/tools/common.spec.ts` | `../../../src/pi/tools/common` | `../../src/pi/tools/common` |
| `pi/tools/*-execution.spec.ts` | `../../../src/pi/tools/X` | `../../src/pi/tools/X` |
| `pi/resource-loader.spec.ts` | `../../src/pi/resource-loader` | `../src/pi/resource-loader` |
| `pi/tools/create-pr-execution.spec.ts` | `../../../src/platform/github` | `@alexanderfortin/pi-platform-github` |

**3 tool tests** that import `* as githubIndex from '…platform/github'` need to switch to workspace package imports.

#### pi-platform-github tests (from `tests/platform/github/` → `packages/pi-platform-github/tests/`)

Tests are **flattened** (no more `platform/github/` nesting):

| Test file | Old import | New import |
|---|---|---|
| `comments.spec.ts` | `../../../src/platform/github/types` | `../src/types` |
| `provider.spec.ts` | `../../../src/platform/github/provider` | `../src/provider` |
| `git/commit-creator.spec.ts` | `../../../../src/platform/github/types` | `../../src/types` |
| `index.spec.ts` | `../../src/platform` | `@alexanderfortin/pi-orchestrator` + `../src/provider` |

Imports from orchestrator types:
```typescript
// Before: import type { PlatformContext } from '../../../src/platform/types';
// After:  import type { PlatformContext } from '@alexanderfortin/pi-orchestrator';
```

#### pi-action tests (from `tests/adapters/` → `packages/pi-action/tests/adapters/`)

| Test file | Old import | New import |
|---|---|---|
| `config.spec.ts` | `../../src/adapters/config` | `../../src/adapters/config` (same!) |
| `git-adapter.spec.ts` | `../../src/types` | `@alexanderfortin/pi-orchestrator` |
| `output-sink.spec.ts` | `../../src/adapters/output-sink` | `../../src/adapters/output-sink` (same!) |

#### Root e2e tests (stay at `tests/e2e/`)

```typescript
// Before: import type { PlatformProvider } from '../../src/platform';
// After:  import type { PlatformProvider } from '@alexanderfortin/pi-orchestrator';
```

#### helpers

- `tests/helpers/fakes.ts` + `fakes.spec.ts` → move to `packages/pi-platform-github/tests/helpers/`
- Root `tests/helpers/` deleted after move

---

### Step 10: Update Build System & CI

- Root `package.json` scripts:
  - `"test"` → runs all package tests via `bun test`
  - `"lint"`, `"format"`, `"type-check"` → operate on `packages/*/src` + `packages/*/tests`
  - `"package"` → delegates to `packages/pi-action/scripts/package.ts`
- Update `.github/workflows/` for new paths
- Update `.fallowrc.json` paths
- Version sync script: `scripts/sync-versions.ts` keeps all three `package.json` versions aligned

### Step 11: ESLint Boundary Enforcement

```js
// pi-orchestrator (already done)
'no-restricted-imports': ['error', {
  paths: [
    { name: '@actions/core', message: 'pi-orchestrator is platform-agnostic' },
    { name: '@actions/github', message: 'pi-orchestrator is platform-agnostic' },
  ]
}]

// pi-platform-github (remaining)
'no-restricted-imports': ['error', {
  paths: [
    { name: '@actions/core', message: 'pi-platform-github uses @actions/github for API types only' },
  ]
}]
```

---

## Package `package.json` Sketches

### Root `package.json`
```json
{
  "name": "pi-coding-agent-action-monorepo",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "bun test",
    "lint": "eslint 'packages/*/src' 'packages/*/tests' 'tests' --ext .ts",
    "type-check": "tsc --noEmit",
    "format": "prettier --check 'packages/*/src/**/*.ts' 'packages/*/tests/**/*.ts' 'tests/**/*.ts'",
    "validate": "bun run lint && bun run type-check && bun run format",
    "package": "bun run packages/pi-action/scripts/package.ts",
    "sync-versions": "bun scripts/sync-versions.ts"
  }
}
```

### `packages/pi-orchestrator/package.json`
```json
{
  "name": "@alexanderfortin/pi-orchestrator",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": { "import": "./src/index.ts" } },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.78.0",
    "@earendil-works/pi-ai": ">=0.78.0",
    "@earendil-works/pi-agent-core": ">=0.78.0"
  },
  "dependencies": {
    "@js-temporal/polyfill": "^0.5.1",
    "ignore": "^7.0.5",
    "typebox": "^1.1.39"
  }
}
```

### `packages/pi-platform-github/package.json`
```json
{
  "name": "@alexanderfortin/pi-platform-github",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": { "import": "./src/index.ts" } },
  "peerDependencies": {
    "@actions/github": ">=9.0.0"
  },
  "dependencies": {
    "@alexanderfortin/pi-orchestrator": "workspace:*",
    "@js-temporal/polyfill": "^0.5.1",
    "@octokit/plugin-rest-endpoint-methods": "^17.0.0"
  }
}
```

### `packages/pi-action/package.json`
```json
{
  "name": "pi-coding-agent-action",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "dependencies": {
    "@alexanderfortin/pi-orchestrator": "workspace:*",
    "@alexanderfortin/pi-platform-github": "workspace:*",
    "@actions/core": "^3.0.1",
    "@actions/github": "^9.1.1",
    "@earendil-works/pi-coding-agent": "^0.78.0",
    "@earendil-works/pi-ai": "^0.78.0",
    "@earendil-works/pi-agent-core": "^0.78.0"
  }
}
```

---

## Metrics Snapshot

| Metric | Value |
|--------|-------|
| Tests passing | **906** (2 skipped, 0 fail) |
| Test files | 46 |
| `@actions/*` imports in library code | **0** (only in `pi-action`) |
| `process.stdout.write` in library code | **0** |
| Build-time constants in library code | **0** |

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| ~46 test files need import path changes | **Medium** | Cheat sheet above covers every case; `bun test` validates |
| esbuild bundling from workspace packages | **Medium** | esbuild resolves workspace deps natively; test `bun run package` early |
| 3 tool tests that `import * as githubIndex from '…platform/github'` | **Medium** | Switch to `@alexanderfortin/pi-platform-github` import |
| CI workflow path references to `src/` and `scripts/` | **Low** | Audit `.github/workflows/` in Step 10 |
| `platform/index.spec.ts` tested combined barrel | **Low** | Split test across packages |

---

## Recommended PR Strategy

**Single PR on `feat/phase3-monorepo`.** Steps 2–4 were combined into one commit to avoid intermediate broken TypeScript. Each subsequent commit should have `bun test` and `tsc --noEmit` green. Final validation: `bun run validate` + `bun test` + manual action test.

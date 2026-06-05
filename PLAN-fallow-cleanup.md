# Plan: fallow-cleanup

Goal: make `bun run fallow` exit 0 (dupes ✓ and complexity ✓).
Strategy: incremental, one PR-sized step at a time, interleavable with other work.

## Current state

- ✅ Dead code: clean (no issues)
- ❌ Duplication: **1,270 LOC / 5.3%** across 27 files (60 clone groups)
  - Down from 3,333 LOC / 13.3% (110 groups) at baseline — **−62% LOC, −45% groups**
  - Remaining clones are mostly internal to single spec files (≤19 lines each)
- ❌ Complexity: **60 functions above threshold**; MI 92.1 (good); 2 refactoring targets
  - Top CRITICAL functions: `updatePullRequest` (1122 CRAP),
    `gatherActionsConfig` (600), `execute` get-pr-diff (462),
    `createFinalComment` (462), `getWorkflowRunLogs` (420),
    `validateCreateReviewParams` (306), `formatThreadAsText` (272),
    `execute` orchestrator (240), `validateBranchName` (240),
    `fetchPRReviewComments` (240), `getCIStatus` (210)
  - Refactoring targets: `pull-request-update.ts` (pri 17.0),
    `get-workflow-run-logs.ts` (pri 15.4)
- Test suite: **916 pass / 2 skip / 0 fail** (e2e skipped without env vars)

## Phase 1 — Test helpers (kills ~80% of duplication) ✅

- [x] **Step 1.1** — `packages/pi-orchestrator/tests/helpers/tool-mocks.ts`
  - Exported `mockExtensionContext` and `createMockProvider(overrides?, options?)`
  - Replaced ~70-line boilerplate in 9 specs (`create-pr`, `create-review`,
    `get-ci-status`, `get-pr-diff`, `get-thread`, `get-workflow-run-logs`,
    `update-pr`, `tools.spec`, `execution-utils`)
  - Result: 3,333 LOC / 110 groups → 2,598 LOC / 102 groups (13.3% → 10.6%)

- [x] **Step 1.2** — `packages/pi-orchestrator/tests/orchestrator/helpers.ts`
  - Exported 5 helpers: `setAgentRunResult`, `setAgentRunError`,
    `setAddReactionReturn`, `getFinalCommentCall`, `expectFactoryCalledWith`
  - Refactored ~30 call sites in `orchestrator.spec.ts`
  - Orchestrator internal clones: 18 groups / 202 lines → 5 groups / 44 lines
  - Result: 2,598 LOC / 102 groups → 2,323 LOC / 89 groups (10.6% → 9.6%)

- [x] **Step 1.3** — `packages/pi-orchestrator/tests/pi/helpers/agent-session.ts`
  - Exported `buildMockSession`, `injectMockSession`, `userHelloMessage`
  - Inlined `createCoreWithInfoCapture`/`createCoreWithErrorCapture` and
    `defaultAgentConfig` in `agent-logic.spec.ts` (9 sites refactored)
  - Extracted `installMockResolveExtensionSources` in `resource-loader.spec.ts`
  - Result: 2,323 LOC / 89 groups → 2,144 LOC / 83 groups (9.6% → 8.9%)

- [x] **Step 1.4** — `packages/pi-platform-github/tests/helpers/github-test-env.ts`
  - Exported `setupGitHubTestEnv()`, `createTestDeps()`, `coreMock`,
    `lazyLoadModule()`, `defaultMockContext`, `setupGitHubContextMock()`
  - Refactored 10 spec files: `get-ci-status`, `get-workflow-run-logs`
    (35-line clone killed), `comments` (+ inline `runFinalComment`/
    `runFinalCommentBody` helpers), `context`, `provider`,
    `pull-request-logic`, `pull-request-update-integration`,
    `pull-request-update-logic`, `git/commit-creator`, `git/tree-builder`
  - Result: 2,144 LOC / 83 groups → 1,655 LOC / 68 groups (8.9% → 6.8%)

- [x] **Step 1.5** — `tests/e2e/helpers/e2e-setup.ts` (cross-package)
  - Exported `setupE2E()`, `createE2EPlatformProvider()` (delegates to
    shared `createMockProvider`), `createE2ECoreAdapter()`,
    `validateE2EEnvVars()`, `isE2EEnabled()`, `registerE2ESkip()`
  - Refactored: `tests/e2e/pi-agent.spec.ts` (399→221 LOC),
    `tests/e2e/pi-agent-custom-provider.spec.ts` (263→122 LOC),
    `resource-loader.spec.ts` (uses `createMockProvider`),
    `agent-logic.spec.ts` (uses `createMockProvider`),
    `git/commit-creator.spec.ts`, `git/tree-builder.spec.ts`
  - Result: 1,655 LOC / 68 groups → 1,270 LOC / 60 groups (6.8% → 5.3%)

## Phase 2 — Complexity hotspots (one file per PR)

Ordered by CRAP score (high → low). Each step extracts sub-functions and adds
targeted tests for the new units. Aim: each function ≤15 cyclomatic, ≤30 cognitive.

- [ ] **Step 2.1** — `packages/pi-platform-github/src/tools/pull-request-update.ts`
  - Target: `updatePullRequest` (cyclomatic 33, cognitive 49, 196 LOC, CRAP 1122)
  - Extract: branch-name validation, tree-building, commit creation, ref update
- [ ] **Step 2.2** — `packages/pi-action/src/adapters/config.ts`
  - Target: `gatherActionsConfig` (cyclomatic 24, cognitive 21, 92 LOC, CRAP 600)
  - Extract: env-var parsing, default-application, validation sub-functions
- [ ] **Step 2.3** — `packages/pi-orchestrator/src/pi/tools/get-pr-diff.ts`
  - Target: `execute` (cyclomatic 21, cognitive 19, 114 LOC, CRAP 462)
- [ ] **Step 2.4** — `packages/pi-platform-github/src/comments.ts`
  - Target: `createFinalComment` (cyclomatic 21, cognitive 22, 60 LOC, CRAP 462)
  - Extract: metadata rendering, body composition, dispatch (issue vs review reply)
- [ ] **Step 2.5** — `packages/pi-platform-github/src/tools/get-workflow-run-logs.ts`
  - Target: `getWorkflowRunLogs` (cyclomatic 20, cognitive 33, 134 LOC, CRAP 420)
  - Extract: job filtering, log byte-budgeting, per-job fetch + truncate
- [ ] **Step 2.6** — `packages/pi-platform-github/src/tools/review.ts`
  - Target: `validateCreateReviewParams` (cyclomatic 17, cognitive 23, 33 LOC, CRAP 306)
- [ ] **Step 2.7** — `packages/pi-orchestrator/src/pi/tools/common.ts`
  - Target: `formatThreadAsText` (cyclomatic 16, cognitive 14, 68 LOC, CRAP 272)
- [ ] **Step 2.8** — `packages/pi-orchestrator/src/orchestrator.ts`
  - Target: `execute` (cyclomatic 15, cognitive 23, 83 LOC, CRAP 240)
  - Coordinate with `finalize` extraction if applicable
- [ ] **Step 2.9** — `packages/pi-platform-github/src/tools/{pull-request,thread,get-ci-status}.ts`
  - Bundle: `validateBranchName` (CRAP 240), `fetchPRReviewComments` (CRAP 240),
    `getCIStatus` (CRAP 210) — similar shape, single PR
- [ ] **Step 2.10** — Remaining HIGH-tier functions (CRAP 56–156)
  - Bundle 3–5 per PR; many are smaller `execute` functions in tool files
- [ ] **Step 2.11** — Re-run fallow; confirm ≤5 functions above threshold
  (or document remaining as `// fallow-ignore-next-line complexity` with rationale)

## Phase 3 — Suppressions & final tuning

- [ ] **Step 3.1** Add `// fallow-ignore-next-line complexity` with justification
      where decomposition genuinely hurts readability (e.g. dispatch tables,
      exhaustive switch on discriminated unions)
- [ ] **Step 3.2** Confirm `bun run fallow` exits 0
- [ ] **Step 3.3** Confirm `bun run validate` passes
- [ ] **Step 3.4** Final test sweep: all 916+ tests still pass

## Helper modules created in Phase 1

| Path | Exports |
| --- | --- |
| `packages/pi-orchestrator/tests/helpers/core-mock.ts` | `coreMock`, `registerCoreMock()` (pre-existing) |
| `packages/pi-orchestrator/tests/helpers/tool-mocks.ts` | `mockExtensionContext`, `createMockProvider(overrides?, options?)` |
| `packages/pi-orchestrator/tests/orchestrator/helpers.ts` | `setAgentRunResult`, `setAgentRunError`, `setAddReactionReturn`, `getFinalCommentCall`, `expectFactoryCalledWith` |
| `packages/pi-orchestrator/tests/pi/helpers/agent-session.ts` | `buildMockSession`, `injectMockSession`, `userHelloMessage` |
| `packages/pi-platform-github/tests/helpers/github-test-env.ts` | `setupGitHubTestEnv`, `setupGitHubContextMock`, `createTestDeps`, `coreMock`, `defaultMockContext`, `defaultGitHubContext`, `lazyLoadModule`, `installStdoutAnnotationFilter`, `registerGitHubContextMock`, `installGitHubEnv` |
| `tests/e2e/helpers/e2e-setup.ts` | `setupE2E`, `createE2EPlatformProvider`, `createE2ECoreAdapter`, `validateE2EEnvVars`, `isE2EEnabled`, `registerE2ESkip`, `E2E_TIMEOUT`, `mockGitHubContext` |

## Guardrails (from AGENTS.md)

- Run `bun run validate` after every step
- Do not edit `CHANGELOG.md`
- Test business logic via real specs, not mocks
- Pre-push lefthook runs dead-code check

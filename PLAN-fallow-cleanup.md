# Plan: fallow-cleanup

Goal: make `bun run fallow` exit 0 (dupes ✓ and health ✓).
Strategy: incremental, one PR-sized step at a time, interleavable with other work.

## Current state (baseline)

- ✅ Dead code: clean
- ❌ Duplication: 3,333 LOC / 13.3% across 36 files (110 clone groups)
- ❌ Complexity: 57 functions above threshold; MI 92.3 (good)
- Refactoring targets: `pull-request-update.ts`, `get-workflow-run-logs.ts`

## Phase 1 — Test helpers (kills ~80% of duplication)

- [x] **Step 1.1** — `packages/pi-orchestrator/tests/helpers/tool-mocks.ts`
  - Extract the 36-line tool-execution scaffold repeated 8×
  - Removes clone group `dup:f0b84422` + several larger groups
  - **Done:** added `tests/helpers/tool-mocks.ts` and updated 9 spec files
    (`create-pr`, `create-review`, `get-ci-status`, `get-pr-diff`, `get-thread`,
    `get-workflow-run-logs`, `update-pr`, `tools.spec`, `execution-utils`)
  - **Result:** −8 clone groups, −735 duplicated LOC (13.3% → 10.6%);
    all 171 tests pass; `bun run validate` clean
- [x] **Step 1.2** — `packages/pi-orchestrator/tests/orchestrator/helpers.ts`
  - Target 18 clone groups / 202 lines in `orchestrator.spec.ts`
  - **Done:** added 5 helpers (`setAgentRunResult`, `setAgentRunError`, `setAddReactionReturn`,
    `getFinalCommentCall`, `expectFactoryCalledWith`) and refactored ~30 call sites
  - **Result:** orchestrator.spec.ts internal clones dropped from 18 groups / 202 lines
    → 5 groups / 44 lines; all 97 tests pass; `bun run validate` clean
- [x] **Step 1.3** — `packages/pi-orchestrator/tests/pi/helpers/agent-session.ts`
  - Consolidate 5 groups / 85 lines in `agent-logic.spec.ts` + `resource-loader.spec.ts` self-dupes
  - **Done:**
    - Added `helpers/agent-session.ts` with `buildMockSession`, `injectMockSession`,
      `userHelloMessage`
    - Inlined `createCoreWithInfoCapture`/`createCoreWithErrorCapture` helpers and a
      `defaultAgentConfig` constant in `agent-logic.spec.ts` (9 sites refactored)
    - Extracted `installMockResolveExtensionSources` in `resource-loader.spec.ts` (2 sites)
  - **Result:** agent-logic.spec.ts internal clones eliminated (5 groups / 85 lines → 0);
    resource-loader.spec.ts self-clones eliminated (2 groups / 19 lines → 0);
    all 49 tests pass; `bun run validate` clean
- [ ] **Step 1.4** — `packages/pi-platform-github/tests/helpers.ts`
  - get-ci-status / get-workflow-run-logs shared setup; `comments.spec.ts`, `context.spec.ts`, `thread.spec.ts`
- [ ] **Step 1.5** — Cross-package test helpers
  - file-scanner.spec ↔ git.spec (35 lines); e2e specs (97 + 85 lines)

## Phase 2 — Complexity hotspots (one file per PR)

- [ ] **Step 2.1** — `packages/pi-platform-github/src/tools/pull-request-update.ts` (`updatePullRequest`)
- [ ] **Step 2.2** — `packages/pi-platform-github/src/tools/get-workflow-run-logs.ts` (`getWorkflowRunLogs`)
- [ ] **Step 2.3** — `packages/pi-action/src/adapters/config.ts` (`gatherActionsConfig`)
- [ ] **Step 2.4** — `packages/pi-orchestrator/src/pi/tools/get-pr-diff.ts` (`execute`)
- [ ] **Step 2.5** — `packages/pi-platform-github/src/comments.ts` (`createFinalComment`)
- [ ] **Step 2.6** — `packages/pi-platform-github/src/tools/review.ts` (`validateCreateReviewParams`)
- [ ] **Step 2.7** — `packages/pi-orchestrator/src/pi/tools/common.ts` (`formatThreadAsText`)
- [ ] **Step 2.8** — `packages/pi-orchestrator/src/orchestrator.ts` (`execute`, `finalize`)
- [ ] **Step 2.9** — `packages/pi-platform-github/src/tools/{pull-request,thread,get-ci-status}.ts`
- [ ] **Step 2.10** — Remaining HIGH-tier (CRAP 56–156), bundled 3–5 per PR

## Phase 3 — Suppressions & final tuning

- [ ] **Step 3.1** Add `// fallow-ignore-next-line complexity` with justification where decomposition hurts readability
- [ ] **Step 3.2** Confirm `bun run fallow` exits 0
- [ ] **Step 3.3** Confirm `bun run validate` passes

## Progress log

- **Step 1.1** (done) — created `packages/pi-orchestrator/tests/helpers/tool-mocks.ts`
  exposing `mockExtensionContext` and `createMockProvider(overrides?, options?)`.
  Replaced ~70-line boilerplate block in 9 specs. Fallow duplication dropped from
  3,333 LOC / 110 groups → 2,598 LOC / 102 groups. `bun run validate` clean.

- **Step 1.2** (done) — created `packages/pi-orchestrator/tests/orchestrator/helpers.ts`
  with 5 helpers (`setAgentRunResult`, `setAgentRunError`, `setAddReactionReturn`,
  `getFinalCommentCall`, `expectFactoryCalledWith`). Refactored ~30 call sites in
  `orchestrator.spec.ts`. Orchestrator internal clones: 18 groups / 202 lines →
  5 groups / 44 lines. Overall: 2,598 LOC / 102 groups → 2,323 LOC / 89 groups
  (10.6% → 9.6%). `bun run validate` clean; 97 tests pass.

- **Step 1.3** (done) — created `packages/pi-orchestrator/tests/pi/helpers/agent-session.ts`
  with `buildMockSession` / `injectMockSession` / `userHelloMessage`. Added local
  helpers in `agent-logic.spec.ts` for info/error capture and a shared
  `defaultAgentConfig`. Extracted `installMockResolveExtensionSources` in
  `resource-loader.spec.ts`. Both target files now have 0 internal clones.
  Overall: 2,323 LOC / 89 groups → 2,144 LOC / 83 groups (9.6% → 8.9%).
  `bun run validate` clean; 49 tests pass.
  Awaiting user validation before proceeding to Step 1.4.

## Guardrails (from AGENTS.md)

- Run `bun run validate` after every step
- Do not edit `CHANGELOG.md`
- Test business logic via real specs, not mocks
- Pre-push lefthook runs dead-code check

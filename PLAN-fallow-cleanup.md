# Plan: fallow-cleanup

Goal: make `bun run fallow` exit 0 (dupes ✓ and complexity ✓).
Strategy: incremental, one PR-sized step at a time, interleavable with other work.

## Current state (as of 2026-06-05)

- ✅ Dead code: clean (no issues)
- ❌ Duplication: **1,077 LOC / 4.4%** across 26 files (49 clone groups)
  - Down from 3,333 LOC / 13.3% (110 groups) at baseline — **−68% LOC, −55% groups**
  - Down from 1,270 LOC / 5.1% (60 groups) pre-Phase 1.6 — **−193 LOC, −11 groups**
  - Remaining clones: cross-package spec fixtures (`git.spec.ts` ↔
    `file-scanner.spec.ts` test bodies; `git.spec.ts` ↔ `tools.spec.ts` env-var
    setup) plus unrelated internal clones in other spec files
- ❌ Complexity: **59 functions above threshold** (was 60); MI 92.1 (good);
  1 refactoring target remaining (`get-workflow-run-logs.ts`, pri 15.4)
  - Top CRITICAL functions: `gatherActionsConfig` (600 CRAP),
    `execute` get-pr-diff (462), `createFinalComment` (462),
    `getWorkflowRunLogs` (420), `validateCreateReviewParams` (306),
    `formatThreadAsText` (272), `execute` orchestrator (240),
    `validateBranchName` (240), `fetchPRReviewComments` (240),
    `getCIStatus` (210), `ready` (156), `<arrow>` in
    `pull-request-update.ts` (132), `updatePullRequest` (132),
    `transformComment` (110), `createPullRequest` (110)
- Test suite: **950 pass / 2 skip / 0 fail** (952 total; e2e skipped without env vars)
  - +34 tests since baseline, mostly from Step 2.1 unit tests for extracted helpers
- Branch: `fallow-cleanup`, 6 wip commits ahead of origin (Step 2.1 included)
  — squash before opening PR
- Refactoring target delta: `pull-request-update.ts` dropped off the list
  after Step 2.1 (CRAP 1122 → 132)

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

### Phase 1.6 — Spec-internal clones (quick wins, ~135 LOC) ✅

Fallow explicitly recommended two cross-file extractions. These landed
before Phase 2 (mechanical, no production code touched).

- [x] **Step 1.6a** — `packages/pi-orchestrator/tests/pi/tools/get-pr-diff-execution.helpers.ts`
  - Exported: `buildTool`, `runTool`, `expectByteTruncated`,
    `expectDefaultSuccessDetails`, `SAMPLE_DIFF`, `BIG_DIFF`, `BIG_DIFF_CONFIG`,
    `mockCtx`, plus `GetPRDiffMock` type
  - Killed **5 original clone groups (53 lines) + 2 secondary clones**
    surfaced after the first pass (constants extraction + assertion helper)
  - `get-pr-diff-execution.spec.ts` is now **0 clones** per fallow
- [x] **Step 1.6b** — inline helpers in `packages/pi-platform-github/tests/git.spec.ts`
  - Added `scanRef()`, `expectSingleChanged()` in `scanForChanges` describe;
    `scanDir()`, `expectSingleChangedPath()` in `scanDirectory` describe
  - Killed **7 internal clone groups (82 lines)** — the cross-file clones
    with `file-scanner.spec.ts` and `tools.spec.ts` remain (cross-package,
    separate scope)
- [x] **Step 1.6c** — Re-ran `bun run fallow:dupes`
  - Result: **1,077 LOC / 4.4% / 49 groups** (was 1,270 / 5.1% / 60)
  - **−193 LOC, −11 groups, −0.7pp**
  - LOC target met (≤1,100 ✅). Group target missed by 4 (target ≤45, got 49)
    because the remaining 4 groups are all cross-package clones that need
    a different approach — see "Risks / open questions" for follow-up

## Phase 2 — Complexity hotspots (one file per PR)

Ordered by CRAP score (high → low). Each step extracts sub-functions and adds
targeted tests for the new units. Aim: each function ≤15 cyclomatic, ≤30 cognitive.

- [x] **Step 2.1** — `packages/pi-platform-github/src/tools/pull-request-update.ts`
  - Target: `updatePullRequest` (cyclomatic 33→11, cognitive 49→14, 196→97 LOC, CRAP 1122→132)
  - Extracted: branch-name validation (`validateUpdatePullRequestParams`, CRAP 56),
    dry-run report builder (`buildDryRunReport`, CRAP 56), tree-building helper,
    ref update; added targeted unit tests
  - Side effect: file dropped off refactoring-targets list (was pri 17.0)
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
- [ ] **Step 2.10a** — `pull-request-update.ts` second pass
  - Knock down `updatePullRequest` (132), `<arrow>` (132),
    `validateUpdatePullRequestParams` (56), `buildDryRunReport` (56)
  - Quick: split the arrow into named `selectCommitStrategy()`;
    collapse the 4 remaining guards in `updatePullRequest` into a
    small validation pipeline
- [ ] **Step 2.10b** — Remaining HIGH-tier functions (CRAP 56–156)
  - Bundle 3–5 per PR; many are smaller `execute` functions in tool files
  - Includes `ready` (156), `transformComment` (110), `createPullRequest` (110),
    6× CRAP 90 (mostly small `execute` functions), 4× CRAP 72, 8× CRAP 56
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
| `packages/pi-orchestrator/tests/pi/tools/get-pr-diff-execution.helpers.ts` | `buildTool`, `runTool`, `expectByteTruncated`, `expectDefaultSuccessDetails`, `SAMPLE_DIFF`, `BIG_DIFF`, `BIG_DIFF_CONFIG`, `mockCtx`, `GetPRDiffMock` |
| `packages/pi-orchestrator/tests/orchestrator/helpers.ts` | `setAgentRunResult`, `setAgentRunError`, `setAddReactionReturn`, `getFinalCommentCall`, `expectFactoryCalledWith` |
| `packages/pi-orchestrator/tests/pi/helpers/agent-session.ts` | `buildMockSession`, `injectMockSession`, `userHelloMessage` |
| `packages/pi-platform-github/tests/helpers/github-test-env.ts` | `setupGitHubTestEnv`, `setupGitHubContextMock`, `createTestDeps`, `coreMock`, `defaultMockContext`, `defaultGitHubContext`, `lazyLoadModule`, `installStdoutAnnotationFilter`, `registerGitHubContextMock`, `installGitHubEnv` |
| `tests/e2e/helpers/e2e-setup.ts` | `setupE2E`, `createE2EPlatformProvider`, `createE2ECoreAdapter`, `validateE2EEnvVars`, `isE2EEnabled`, `registerE2ESkip`, `E2E_TIMEOUT`, `mockGitHubContext` |

## Guardrails (from AGENTS.md)

- Run `bun run validate` after every step
- Do not edit `CHANGELOG.md`
- Test business logic via real specs, not mocks
- Pre-push lefthook runs dead-code check

## Proposed next steps (recommended order)

Concrete pick-up order, smallest-to-largest blast radius. Each item is one PR.

1. **Squash & open PR for Step 2.1** (you're handling this).
2. **Open PR for Step 1.6 (this work)** — 4 changed files, 1 new helper, all
   tests pass, `bun run validate` green. Suggested commit:
   `refactor(tests): extract helpers from get-pr-diff and git specs`.
3. **Step 1.7 (NEW, optional)** — Kill the remaining cross-package clones
   flagged by fallow:
   - `git.spec.ts:124/489/504/518` ↔ `pi-orchestrator/tests/git/file-scanner.spec.ts`
     (4 groups, ~47 lines) — would require a shared fixture module under
     `tests/fixtures/` (already exists as a dir) exporting `scanFixtureSetup()`
     and similar. Could land alongside Step 2.5 since it's also `scanDirectory`-adjacent.
   - `git.spec.ts:19` ↔ `tools.spec.ts:19` (1 group, 10 lines) — duplicate
     env-var setup; could be folded into `github-test-env.ts`'s `installGitHubEnv`.
   - **Estimated gain**: ~−60 LOC, ~−5 groups → ~1,020 LOC / ~44 groups.
     Crosses the ≤45-group target.
4. **Step 2.2 — `gatherActionsConfig`** (CRAP 600, single file). Highest
   remaining risk; clean separation between parsing/defaulting/validation.
5. **Step 2.5 — `getWorkflowRunLogs`** (CRAP 420). Only file still in
   refactoring-targets list; fallow explicitly calls it out.
6. **Step 2.3 + 2.4** (bundle, both CRAP 462). Similar shape
   (orchestrator-side execute + comment rendering).
7. **Step 2.6 + 2.7** (bundle, CRAP 306 + 272). Small, contained validators.
8. **Step 2.8** — orchestrator `execute` (CRAP 240). Land last because it
   touches the central flow and benefits from the prior extractions.
9. **Step 2.9** — pull-request/thread/get-ci-status bundle (CRAP 240/240/210).
10. **Step 2.10a + 2.10b** — clean-up bundles.
11. **Phase 3** — suppressions + final `bun run fallow` → 0.

### Stop conditions

- If `bun run fallow` exits 0 before all steps complete → declare victory.
- If a step would degrade readability → suppress with
  `// fallow-ignore-next-line complexity` and a one-line rationale (Phase 3.1).
- Re-baseline numbers in this file after each merge so the next pick-up is
  unambiguous.

### Risks / open questions

- The 6 wip commits on `fallow-cleanup` may include unrelated work — verify
  before squashing that nothing is lost (e.g. `git show --stat <sha>` per commit).
- `gatherActionsConfig` (Step 2.2) reads many env vars; any extraction must
  preserve exact error messages and ordering for the action's
  `actions/config.yaml` contract. Snapshot-test the error output before
  refactoring.
- `createFinalComment` (Step 2.4) has subtle per-platform branching
  (issue vs PR vs review reply); existing `comments.spec.ts` covers it but
  add a couple of negative-path tests before extracting sub-functions.
- Orchestrator `execute` (Step 2.8) is the highest-blast-radius change; pair
  with the existing `orchestrator.spec.ts` and consider an A/B commit that
  keeps the old path behind a flag for one release if behavior diverges.

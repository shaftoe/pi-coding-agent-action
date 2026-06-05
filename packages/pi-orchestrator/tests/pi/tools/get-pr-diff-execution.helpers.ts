/**
 * Helpers for `get-pr-diff-execution.spec.ts`.
 *
 * Wraps the three pieces of boilerplate that recur in every test:
 *   1. wiring a `mock()`-tracked `getPRDiff` into a provider + tool factory
 *   2. invoking `tool.execute(...)` with the standard (owner/repo/pull #42)
 *      args used by all tests in this file
 *   3. asserting the post-byte-truncation details shape (which several
 *      negative-path tests reuse)
 *
 * Keeping these local (rather than in `tests/helpers/`) because the
 * `SAMPLE_DIFF`, fixed pull number, and assertion shapes are specific to
 * this spec.
 */

import { expect, mock, type Mock } from 'bun:test';
import {
  getPRDiffToolFactory,
  type DiffConfig,
  type PlatformProvider,
} from '@alexanderfortin/pi-orchestrator';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createMockProvider, mockExtensionContext } from '../../helpers/tool-mocks';

/** Event context shared by every test: PR #42 in `pull_request` event. */
const providerOptions = { issueNumber: 42, eventName: 'pull_request' as const };

/** Canonical diff used as the default `getPRDiff` return value. */
export const SAMPLE_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';
`;

/** Reused by several truncation tests: exceeds both 50-line and 500-byte limits. */
export const BIG_DIFF = Array.from(
  { length: 200 },
  (_, i) => `line ${i} with content padding`
).join('\n');

/** Paired with `BIG_DIFF` to trigger byte truncation. */
export const BIG_DIFF_CONFIG: DiffConfig = { diffMaxBytes: 500 };

/** Re-export so specs can stay single-import. */
export { createMockProvider };

/** Re-exported mock context (typed as `ExtensionContext`) for `execute`. */
export const mockCtx: ExtensionContext = mockExtensionContext;

export interface BuildToolOptions {
  /** Diff string the mocked `getPRDiff` will resolve to. Defaults to `SAMPLE_DIFF`. */
  diff?: string;
  /** Optional `DiffConfig` passed to the tool factory. */
  config?: DiffConfig;
  /**
   * Custom implementation for `getPRDiff` (e.g. a throwing impl for error
   * tests). When provided, `diff` is ignored.
   */
  getPRDiffImpl?: GetPRDiffMock;
}

/** A `getPRDiff` mock returns a diff string. Args are `[owner, repo, pr, ignore]`. */
export type GetPRDiffMock = Mock<
  (owner: string, repo: string, pr: number, ignore?: string[]) => Promise<string>
>;

export interface BuildToolResult {
  tool: ReturnType<typeof getPRDiffToolFactory>;
  getPRDiff: GetPRDiffMock;
  provider: PlatformProvider;
}

/**
 * Build a tool wired to a `mock()`-tracked `getPRDiff`. The returned
 * `getPRDiff` reference can be inspected with `.mock.calls`.
 */
export function buildTool(options: BuildToolOptions = {}): BuildToolResult {
  const { diff = SAMPLE_DIFF, config, getPRDiffImpl } = options;
  const getPRDiff = getPRDiffImpl ?? mock(async () => diff);
  const provider = createMockProvider({ getPRDiff }, providerOptions);
  const tool = getPRDiffToolFactory(provider, config);
  return { tool, getPRDiff, provider };
}

export interface RunToolOptions {
  /** Extra params merged into the standard `{owner,repo,pull_number}` args. */
  params?: Record<string, unknown>;
  /** Optional abort signal forwarded to `tool.execute`. */
  signal?: AbortSignal;
}

/** The standard args every test passes to `tool.execute`. */
const DEFAULT_ARGS = Object.freeze({
  owner: 'test-owner',
  repo: 'test-repo',
  pull_number: 42,
});

/**
 * Invoke `tool.execute` with the conventional args used across the spec.
 * The call ID is irrelevant (no test asserts it) so we use a fixed string.
 */
export async function runTool(
  tool: ReturnType<typeof getPRDiffToolFactory>,
  options: RunToolOptions = {}
): Promise<ToolExecuteResult> {
  const { params = {}, signal } = options;
  const result = await tool.execute(
    'test-call',
    { ...DEFAULT_ARGS, ...params },
    signal,
    undefined,
    mockCtx
  );
  return result as unknown as ToolExecuteResult;
}

/** Result shape returned by `tool.execute` — minimally typed for assertion helpers. */
interface ToolExecuteResult {
  content: { type: string; text?: string }[];
  details: object;
}

/** Asserts the post-byte-truncation details shape used by several tests. */
export function expectByteTruncated(result: ToolExecuteResult): void {
  expect((result.details as { truncated?: boolean }).truncated).toBe(true);
  expect((result.details as { truncated_reason?: string }).truncated_reason).toBe('bytes');
}

/**
 * Asserts the standard success details shape: PR #42 (from context), not
 * truncated. Used by every test that doesn't expect truncation.
 */
export function expectDefaultSuccessDetails(result: ToolExecuteResult): void {
  expect((result.details as { pull_number?: number }).pull_number).toBe(42);
  expect((result.details as { truncated?: boolean }).truncated).toBe(false);
}

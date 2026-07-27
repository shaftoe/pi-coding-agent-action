/**
 * Direct unit tests for {@link executeGetPRDiff}.
 *
 * `executeGetPRDiff` was extracted from the inline `execute` handler buried
 * inside `getPRDiffToolFactory`. The full `get-pr-diff-execution.spec.ts`
 * suite already covers the behaviour end-to-end through `tool.execute(...))`
 * (including cancellation, truncation, param forwarding); these tests assert
 * the **extracted function in isolation** — that the resolve / no-diff /
 * success branches produce the right text + details *without* going through
 * the `withCancellation` wrapper or SDK `defineTool` plumbing.
 */

import { describe, expect, test, vi } from 'vitest';
import {
  executeGetPRDiff,
  type DiffConfig,
  type PlatformProvider,
} from '@alexanderfortin/pi-orchestrator';
import { createMockProvider } from '../../helpers/tool-mocks';

const providerOptions = { issueNumber: 42, eventName: 'pull_request' as const };

function buildProvider(diff: string): {
  provider: PlatformProvider;
  getPRDiff: ReturnType<typeof vi.fn>;
} {
  const getPRDiff = vi.fn(async () => diff);
  const provider = createMockProvider({ getPRDiff }, providerOptions);
  return { provider, getPRDiff };
}

/**
 * Build tool params for {@link executeGetPRDiff}.
 *
 * The tool's schema is strict-compatible (all properties required-but-nullable),
 * so its parameter type requires every key. Tests only set a subset, so default
 * the rest to `null` — the handler treats `null` and `undefined` identically
 * via nullish-coalescing, mirroring how strict-capable providers emit absent
 * fields.
 */
const diffParams = (
  overrides: Partial<Parameters<typeof executeGetPRDiff>[0]> = {}
): Parameters<typeof executeGetPRDiff>[0] =>
  ({
    owner: null,
    repo: null,
    pull_number: null,
    max_lines: null,
    ignore_files: null,
    ...overrides,
  }) as Parameters<typeof executeGetPRDiff>[0];

describe('executeGetPRDiff (extracted handler)', () => {
  test('returns a resolve-failure result when owner/repo/pull_number are all absent', async () => {
    const getPRDiff = vi.fn(async () => 'unused');
    // Provider whose context has no repo/issue, so resolvePRParams fails.
    const providerNoCtx = createMockProvider(
      {
        getPRDiff,
        getContext: () =>
          ({
            repo: { owner: '', repo: '' },
            issue: { number: 0 },
            eventName: 'issues',
            payload: {},
            serverUrl: 'https://github.com',
            runId: 1,
            workspace: '/tmp',
          }) as ReturnType<PlatformProvider['getContext']>,
      },
      { issueNumber: 0 }
    );

    const result = await executeGetPRDiff(diffParams(), providerNoCtx);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.text).toContain('Could not resolve PR');
    expect(result.details).toMatchObject({ pull_number: 0, lines: 0, truncated: false });
    expect(getPRDiff).not.toHaveBeenCalled();
  });

  test('returns a no-diff result when the provider resolves an empty diff', async () => {
    const { provider, getPRDiff } = buildProvider('');
    const result = await executeGetPRDiff(
      diffParams({ owner: 'o', repo: 'r', pull_number: 7 }),
      provider
    );

    expect(result.content[0]!.text).toContain('No diff available for PR #7');
    expect(result.details).toMatchObject({ pull_number: 7, lines: 0, truncated: false });
    expect(getPRDiff).toHaveBeenCalledTimes(1);
  });

  test('renders the diff fenced in a ```diff block and reports line count', async () => {
    const diff = 'diff --git a/f b/f\n+hello\n';
    const { provider } = buildProvider(diff);
    const result = await executeGetPRDiff(
      diffParams({ owner: 'o', repo: 'r', pull_number: 9 }),
      provider
    );

    expect(result.content[0]!.text).toBe('PR #9 Diff:\n```diff\n' + diff + '\n```');
    expect(result.details).toMatchObject({ pull_number: 9, truncated: false });
    expect(result.details.lines).toBe(diff.split('\n').length);
  });

  test('forwards merged ignore_files to the provider and echoes them in details', async () => {
    const { provider, getPRDiff } = buildProvider('diff body');
    await executeGetPRDiff(
      diffParams({ owner: 'o', repo: 'r', pull_number: 1, ignore_files: ['dist/', 'lock'] }),
      provider,
      { diffIgnorePatterns: ['dist/', 'node_modules/'] } as DiffConfig
    );

    const passed = getPRDiff.mock.calls[0]![3] as string[];
    expect(passed).toEqual(expect.arrayContaining(['dist/', 'lock', 'node_modules/']));
    expect(passed.filter(p => p === 'dist/')).toHaveLength(1);
  });

  test('truncates by lines and records the reason', async () => {
    const longDiff = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const { provider } = buildProvider(longDiff);
    const result = await executeGetPRDiff(
      diffParams({ owner: 'o', repo: 'r', pull_number: 3, max_lines: 10 }),
      provider
    );

    expect(result.details.truncated).toBe(true);
    expect(result.details.truncated_reason).toBe('lines');
    expect(result.content[0]!.text).toContain('truncated at 10 lines');
  });

  test('propagates provider errors', async () => {
    const getPRDiff = vi.fn(async () => {
      throw new Error('boom');
    });
    const provider = createMockProvider({ getPRDiff }, providerOptions);
    await expect(
      executeGetPRDiff(diffParams({ owner: 'o', repo: 'r', pull_number: 1 }), provider)
    ).rejects.toThrow('boom');
  });
});

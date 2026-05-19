/**
 * @file Execution tests for the get_pr_diff tool.
 *
 * Verifies that the tool correctly forwards parameters — especially
 * `ignore_files` — to the platform provider and returns well-formed
 * results.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock } from 'bun:test';
import { getPRDiffToolFactory } from '../../../src/pi/tools/get-pr-diff';
import type { PlatformProvider } from '../../../src/platform';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { DiffConfig } from '../../../src/types';

// Minimal mock ExtensionContext for tool execute signature
const mockCtx = {
  ui: {},
  hasUI: false,
  cwd: '/tmp',
  sessionManager: {},
  modelRegistry: {},
  model: undefined,
  isIdle: () => true,
  signal: undefined,
  abort: () => {},
  hasPendingMessages: () => false,
  shutdown: () => {},
  getContextUsage: () => undefined,
  compact: () => {},
  getSystemPrompt: () => '',
} as unknown as ExtensionContext;

// Mock platform provider factory
const createMockProvider = (overrides?: Partial<PlatformProvider>): PlatformProvider => ({
  type: 'github',
  getContext: () => ({
    repo: { owner: 'test-owner', repo: 'test-repo' },
    issue: { number: 42 },
    eventName: 'pull_request',
    payload: {},
    serverUrl: 'https://github.com',
    runId: 123,
    workspace: '/tmp',
  }),
  addReaction: async () => undefined,
  deleteReaction: async () => {},
  createFinalComment: async () => {},
  getPrompt: async () => undefined,
  getStartTime: () => undefined,
  createPullRequest: async () => ({
    content: [{ type: 'text' as const, text: 'PR created' }],
    details: {
      pullRequestNumber: 1,
      pullRequestUrl: '',
      headBranch: '',
      baseBranch: '',
      dryRun: false,
    },
  }),
  updatePullRequest: async () => ({
    content: [{ type: 'text' as const, text: 'PR updated' }],
    details: {
      pullRequestNumber: 1,
      pullRequestUrl: '',
      headBranch: '',
      baseBranch: '',
      dryRun: false,
    },
  }),
  getIssueOrPRThread: async () => undefined,
  getPRDiff: async () => '',
  ...overrides,
});

const SAMPLE_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';
`;

describe('get_pr_diff tool - execution', () => {
  test('has correct tool name and label', () => {
    const provider = createMockProvider();
    const tool = getPRDiffToolFactory(provider);
    expect(tool.name).toBe('get_pr_diff');
    expect(tool.label).toBe('Get PR Diff');
  });

  test('execute returns diff from provider', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    const result = await tool.execute(
      'call-1',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    expect(result.content).toHaveLength(1);
    expect((result.content as any)[0].type).toBe('text');
    expect((result.content as any)[0].text).toContain('import { bar }');
    expect((result.details as any).pull_number).toBe(42);
    expect((result.details as any).truncated).toBe(false);
  });

  test('execute forwards ignore_files to provider', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    await tool.execute(
      'call-2',
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        ignore_files: ['dist/', 'package-lock.json'],
      },
      undefined,
      undefined,
      mockCtx
    );

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    // Verify ignore_files array is passed as the 4th argument
    expect((getPRDiff as any).mock.calls[0][3]).toEqual(['dist/', 'package-lock.json']);
  });

  test('execute passes undefined ignore_files when not provided', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    await tool.execute(
      'call-3',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    expect((getPRDiff as any).mock.calls[0][3]).toBeUndefined();
  });

  test('execute merges default ignore patterns with caller-provided ones', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const config = { diffIgnorePatterns: ['dist/', 'node_modules/'] } as DiffConfig;
    const tool = getPRDiffToolFactory(provider, config);

    await tool.execute(
      'call-merge',
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        ignore_files: ['package-lock.json', 'dist/'],
      },
      undefined,
      undefined,
      mockCtx
    );

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    // Should be a deduped union of default + caller patterns
    const passedIgnore = (getPRDiff as any).mock.calls[0][3] as string[];
    expect(passedIgnore).toContain('dist/');
    expect(passedIgnore).toContain('node_modules/');
    expect(passedIgnore).toContain('package-lock.json');
    // No duplicates
    expect(passedIgnore.filter(p => p === 'dist/')).toHaveLength(1);
  });

  test('execute uses default ignore patterns when caller provides none', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const config = { diffIgnorePatterns: ['dist/', 'package-lock.json'] } as DiffConfig;
    const tool = getPRDiffToolFactory(provider, config);

    await tool.execute(
      'call-default-ignore',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    expect((getPRDiff as any).mock.calls[0][3]).toEqual(['dist/', 'package-lock.json']);
  });

  test('execute includes ignored_files in details when provided', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    const result = await tool.execute(
      'call-4',
      {
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 42,
        ignore_files: ['dist/'],
      },
      undefined,
      undefined,
      mockCtx
    );

    expect((result.details as any).ignored_files).toEqual(['dist/']);
  });

  test('execute omits ignored_files from details when not provided', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    const result = await tool.execute(
      'call-5',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect((result.details as any).ignored_files).toBeUndefined();
  });

  test('execute returns no-diff message when provider returns empty', async () => {
    const getPRDiff = mock(async () => '');
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    const result = await tool.execute(
      'call-6',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect((result.content as any)[0].text).toContain('No diff available');
  });

  test('execute truncates diff when max_lines is exceeded', async () => {
    const longDiff = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const getPRDiff = mock(async () => longDiff);
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    const result = await tool.execute(
      'call-7',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42, max_lines: 10 },
      undefined,
      undefined,
      mockCtx
    );

    expect((result.details as any).truncated).toBe(true);
    // After line truncation, the marker line is included, so total = 10 content lines + 1 marker line
    expect((result.details as any).lines).toBe(11);
    expect((result.content as any)[0].text).toContain('truncated at 10 lines');
    expect((result.details as any).truncated_reason).toBe('lines');
  });

  test('execute truncates diff by bytes when maxBytes is exceeded', async () => {
    // Create a diff that is ~500 bytes
    const byteDiff = Array.from({ length: 50 }, (_, i) => `line ${i} with some content`).join('\n');
    const getPRDiff = mock(async () => byteDiff);
    const provider = createMockProvider({ getPRDiff });
    const config = { diffMaxBytes: 200 } as DiffConfig;
    const tool = getPRDiffToolFactory(provider, config);

    const result = await tool.execute(
      'call-bytes',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect((result.details as any).truncated).toBe(true);
    expect((result.details as any).truncated_reason).toBe('bytes');
    expect((result.content as any)[0].text).toContain('truncated at 200 bytes');
    // The final output should be at or under maxBytes
    const outputText = (result.content as any)[0].text;
    const diffSection = outputText.match(/```diff\n([\s\S]*)\n```/)?.[1] ?? '';
    expect(Buffer.byteLength(diffSection, 'utf8')).toBeLessThanOrEqual(200 + 50); // some slack for marker
  });

  test('execute truncates by bytes before lines (bytes reason takes precedence)', async () => {
    // Create a diff that exceeds both byte and line limits
    const bigDiff = Array.from({ length: 200 }, (_, i) => `line ${i} with content padding`).join('\n');
    const getPRDiff = mock(async () => bigDiff);
    const provider = createMockProvider({ getPRDiff });
    const config = { diffMaxBytes: 500 } as DiffConfig;
    const tool = getPRDiffToolFactory(provider, config);

    const result = await tool.execute(
      'call-bytes-first',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42, max_lines: 50 },
      undefined,
      undefined,
      mockCtx
    );

    expect((result.details as any).truncated).toBe(true);
    expect((result.details as any).truncated_reason).toBe('bytes');
  });

  test('execute reports correct line count after byte truncation', async () => {
    // Create a diff that will be byte-truncated to fewer lines than maxLines
    const byteDiff = Array.from({ length: 100 }, (_, i) => `line ${i} with content`).join('\n');
    const getPRDiff = mock(async () => byteDiff);
    const provider = createMockProvider({ getPRDiff });
    const config = { diffMaxBytes: 300 } as DiffConfig;
    const tool = getPRDiffToolFactory(provider, config);

    const result = await tool.execute(
      'call-lines-after-bytes',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42, max_lines: 1000 },
      undefined,
      undefined,
      mockCtx
    );

    // details.lines should reflect the actual final content, not Math.min(original, maxLines)
    const reportedLines = (result.details as any).lines;
    const outputText = (result.content as any)[0].text;
    const diffSection = outputText.match(/```diff\n([\s\S]*)\n```/)?.[1] ?? '';
    const actualLines = diffSection.split('\n').length;
    expect(reportedLines).toBe(actualLines);
    // Should be significantly less than the original 100 lines
    expect(reportedLines).toBeLessThan(100);
  });

  test('execute uses diffConfig maxLines when no max_lines param provided', async () => {
    const longDiff = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const getPRDiff = mock(async () => longDiff);
    const provider = createMockProvider({ getPRDiff });
    const config = { diffMaxLines: 5 } as DiffConfig;
    const tool = getPRDiffToolFactory(provider, config);

    const result = await tool.execute(
      'call-config-maxlines',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect((result.details as any).truncated).toBe(true);
    expect((result.details as any).truncated_reason).toBe('lines');
    expect((result.content as any)[0].text).toContain('truncated at 5 lines');
  });

  test('execute byte truncation handles multi-byte characters correctly', async () => {
    // Create a diff with multi-byte UTF-8 characters (emoji, CJK)
    const multiByteDiff = Array.from({ length: 10 }, (_, i) =>
      `line ${i}: 🎉🎉🎉 日本語テスト émoji`
    ).join('\n');
    const getPRDiff = mock(async () => multiByteDiff);
    const provider = createMockProvider({ getPRDiff });
    const config = { diffMaxBytes: 80 } as DiffConfig;
    const tool = getPRDiffToolFactory(provider, config);

    const result = await tool.execute(
      'call-multibyte',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect((result.details as any).truncated).toBe(true);
    expect((result.details as any).truncated_reason).toBe('bytes');
    // The output should not contain garbled/incomplete characters
    const outputText = (result.content as any)[0].text;
    expect(outputText).not.toContain('\ufffd'); // no replacement character
  });

  test('execute uses context defaults when owner/repo/pull_number not provided', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    await tool.execute('call-8', {}, undefined, undefined, mockCtx);

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    // Should use context defaults: test-owner, test-repo, issue #42
    expect((getPRDiff as any).mock.calls[0][0]).toBe('test-owner');
    expect((getPRDiff as any).mock.calls[0][1]).toBe('test-repo');
    expect((getPRDiff as any).mock.calls[0][2]).toBe(42);
  });

  test('execute returns cancellation result when signal is aborted', async () => {
    const getPRDiff = mock(async () => SAMPLE_DIFF);
    const provider = createMockProvider({ getPRDiff });
    const tool = getPRDiffToolFactory(provider);

    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      'call-cancel',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      controller.signal,
      undefined,
      mockCtx
    );

    expect(getPRDiff).not.toHaveBeenCalled();
    expect((result.content as any)[0].text).toContain('cancelled');
    expect((result.details as any).cancelled).toBe(true);
  });
});

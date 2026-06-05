/**
 * @file Execution tests for the get_pr_diff tool.
 *
 * Verifies that the tool correctly forwards parameters — especially
 * `ignore_files` — to the platform provider and returns well-formed
 * results.
 */

import { describe, expect, test, mock } from 'bun:test';
import type { DiffConfig } from '@alexanderfortin/pi-orchestrator';
import {
  buildTool,
  runTool,
  expectByteTruncated,
  expectDefaultSuccessDetails,
  mockCtx,
  BIG_DIFF,
  BIG_DIFF_CONFIG,
} from './get-pr-diff-execution.helpers';

describe('get_pr_diff tool - execution', () => {
  test('has correct tool name and label', () => {
    const { tool } = buildTool();
    expect(tool.name).toBe('get_pr_diff');
    expect(tool.label).toBe('Get PR Diff');
  });

  test('execute returns diff from provider', async () => {
    const { tool, getPRDiff } = buildTool();
    const result = await runTool(tool);

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    expect(result.content).toHaveLength(1);
    expect((result.content as { type: string }[])[0]!.type).toBe('text');
    expect((result.content as { text: string }[])[0]!.text).toContain('import { bar }');
    expectDefaultSuccessDetails(result);
  });

  test('execute forwards ignore_files to provider', async () => {
    const { tool, getPRDiff } = buildTool();
    await runTool(tool, {
      params: { ignore_files: ['dist/', 'package-lock.json'] },
    });

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    // Verify ignore_files array is passed as the 4th argument
    expect(getPRDiff.mock.calls[0]![3]).toEqual(['dist/', 'package-lock.json']);
  });

  test('execute passes undefined ignore_files when not provided', async () => {
    const { tool, getPRDiff } = buildTool();
    await runTool(tool);

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    expect(getPRDiff.mock.calls[0]![3]).toBeUndefined();
  });

  test('execute merges default ignore patterns with caller-provided ones', async () => {
    const { tool, getPRDiff } = buildTool({
      config: { diffIgnorePatterns: ['dist/', 'node_modules/'] } as DiffConfig,
    });
    await runTool(tool, {
      params: { ignore_files: ['package-lock.json', 'dist/'] },
    });

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    // Should be a deduped union of default + caller patterns
    const passedIgnore = getPRDiff.mock.calls[0]![3]!;
    expect(passedIgnore).toContain('dist/');
    expect(passedIgnore).toContain('node_modules/');
    expect(passedIgnore).toContain('package-lock.json');
    // No duplicates
    expect(passedIgnore.filter(p => p === 'dist/')).toHaveLength(1);
  });

  test('execute uses default ignore patterns when caller provides none', async () => {
    const { tool, getPRDiff } = buildTool({
      config: { diffIgnorePatterns: ['dist/', 'package-lock.json'] } as DiffConfig,
    });
    await runTool(tool);

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    expect(getPRDiff.mock.calls[0]![3]).toEqual(['dist/', 'package-lock.json']);
  });

  test('execute includes ignored_files in details when provided', async () => {
    const { tool } = buildTool();
    const result = await runTool(tool, { params: { ignore_files: ['dist/'] } });

    expect((result.details as { ignored_files?: string[] }).ignored_files).toEqual(['dist/']);
  });

  test('execute omits ignored_files from details when not provided', async () => {
    const { tool } = buildTool();
    const result = await runTool(tool);

    expect((result.details as { ignored_files?: string[] }).ignored_files).toBeUndefined();
  });

  test('execute returns no-diff message when provider returns empty', async () => {
    const { tool } = buildTool({ diff: '' });
    const result = await runTool(tool);

    expect((result.content as { text: string }[])[0]!.text).toContain('No diff available');
    expectDefaultSuccessDetails(result);
  });

  test('execute propagates provider errors (SDK sets isError)', async () => {
    const getPRDiffImpl = mock(async () => {
      throw new Error('API rate limit exceeded');
    });
    const { tool } = buildTool({ getPRDiffImpl });

    await expect(runTool(tool)).rejects.toThrow('API rate limit exceeded');
  });

  test('execute truncates diff when max_lines is exceeded', async () => {
    const longDiff = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const { tool } = buildTool({ diff: longDiff });
    const result = await runTool(tool, { params: { max_lines: 10 } });

    expect((result.details as { truncated?: boolean }).truncated).toBe(true);
    // After line truncation, the marker line is included, so total = 10 content lines + 1 marker line
    expect((result.details as { lines?: number }).lines).toBe(11);
    expect((result.content as { text: string }[])[0]!.text).toContain('truncated at 10 lines');
    expect((result.details as { truncated_reason?: string }).truncated_reason).toBe('lines');
  });

  test('execute truncates diff by bytes when maxBytes is exceeded', async () => {
    // Create a diff that is ~500 bytes
    const byteDiff = Array.from({ length: 50 }, (_, i) => `line ${i} with some content`).join('\n');
    const { tool } = buildTool({
      diff: byteDiff,
      config: { diffMaxBytes: 200 } as DiffConfig,
    });
    const result = await runTool(tool);

    expectByteTruncated(result);
    expect((result.content as { text: string }[])[0]!.text).toContain('truncated at 200 bytes');
    // The final output should be at or under maxBytes
    const outputText = (result.content as { text: string }[])[0]!.text;
    const diffSection = outputText.match(/```diff\n([\s\S]*)\n```/)?.[1] ?? '';
    expect(Buffer.byteLength(diffSection, 'utf8')).toBeLessThanOrEqual(200 + 50); // some slack for marker
  });

  test('execute truncates by bytes before lines (bytes reason takes precedence)', async () => {
    const { tool } = buildTool({ diff: BIG_DIFF, config: BIG_DIFF_CONFIG });
    const result = await runTool(tool, { params: { max_lines: 50 } });

    expectByteTruncated(result);
  });

  test('execute reports correct line count after byte truncation', async () => {
    // Create a diff that will be byte-truncated to fewer lines than maxLines
    const byteDiff = Array.from({ length: 100 }, (_, i) => `line ${i} with content`).join('\n');
    const { tool } = buildTool({
      diff: byteDiff,
      config: { diffMaxBytes: 300 } as DiffConfig,
    });
    const result = await runTool(tool, { params: { max_lines: 1000 } });

    // details.lines should reflect the actual final content, not Math.min(original, maxLines)
    const reportedLines = (result.details as { lines?: number }).lines;
    const outputText = (result.content as { text: string }[])[0]!.text;
    const diffSection = outputText.match(/```diff\n([\s\S]*)\n```/)?.[1] ?? '';
    const actualLines = diffSection.split('\n').length;
    expect(reportedLines).toBe(actualLines);
    // Should be significantly less than the original 100 lines
    expect(reportedLines).toBeLessThan(100);
  });

  test('execute uses diffConfig maxLines when no max_lines param provided', async () => {
    const longDiff = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const { tool } = buildTool({
      diff: longDiff,
      config: { diffMaxLines: 5 } as DiffConfig,
    });
    const result = await runTool(tool);

    expect((result.details as { truncated?: boolean }).truncated).toBe(true);
    expect((result.details as { truncated_reason?: string }).truncated_reason).toBe('lines');
    expect((result.content as { text: string }[])[0]!.text).toContain('truncated at 5 lines');
  });

  test('execute byte truncation handles multi-byte characters correctly', async () => {
    // Create a diff with multi-byte UTF-8 characters (emoji, CJK)
    const multiByteDiff = Array.from(
      { length: 10 },
      (_, i) => `line ${i}: 🎉🎉🎉 日本語テスト émoji`
    ).join('\n');
    const { tool } = buildTool({
      diff: multiByteDiff,
      config: { diffMaxBytes: 80 } as DiffConfig,
    });
    const result = await runTool(tool);

    expectByteTruncated(result);
    // The output should not contain garbled/incomplete characters
    const outputText = (result.content as { text: string }[])[0]!.text;
    expect(outputText).not.toContain('\ufffd'); // no replacement character
  });

  test('execute does not produce double truncation markers when byte-truncated content still exceeds maxLines', async () => {
    const { tool } = buildTool({ diff: BIG_DIFF, config: BIG_DIFF_CONFIG });
    const result = await runTool(tool, { params: { max_lines: 5 } });

    const outputText = (result.content as { text: string }[])[0]!.text;
    // Should only have one truncation marker (the bytes one)
    const markerCount = (outputText.match(/truncated at/g) ?? []).length;
    expect(markerCount).toBe(1);
    expect((result.details as { truncated_reason?: string }).truncated_reason).toBe('bytes');
  });

  test('execute uses context defaults when owner/repo/pull_number not provided', async () => {
    const { tool, getPRDiff } = buildTool();
    await tool.execute('test-call', {}, undefined, undefined, mockCtx);

    expect(getPRDiff).toHaveBeenCalledTimes(1);
    // Should use context defaults: test-owner, test-repo, issue #42
    const [owner, repo, pr] = getPRDiff.mock.calls[0]!;
    expect(owner).toBe('test-owner');
    expect(repo).toBe('test-repo');
    expect(pr).toBe(42);
  });

  test('execute returns cancellation result when signal is aborted', async () => {
    const { tool, getPRDiff } = buildTool();
    const controller = new AbortController();
    controller.abort();

    const result = await runTool(tool, { signal: controller.signal });

    expect(getPRDiff).not.toHaveBeenCalled();
    expect((result.content as { text: string }[])[0]!.text).toContain('cancelled');
    expect((result.details as { cancelled?: boolean }).cancelled).toBe(true);
  });
});

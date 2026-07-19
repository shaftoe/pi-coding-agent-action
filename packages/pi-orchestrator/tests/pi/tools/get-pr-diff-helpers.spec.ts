/**
 * Unit tests for the pure truncation helpers exported from
 * `packages/pi-orchestrator/src/pi/tools/get-pr-diff.ts`.
 *
 * These complement `get-pr-diff-execution.spec.ts`, which tests the full
 * tool execution pipeline end-to-end via the mocked provider. Each
 * helper here is a pure function over raw diff strings.
 */

import { describe, expect, test } from 'vitest';
import {
  mergeIgnoreFiles,
  truncateDiff,
  truncateDiffByBytes,
  truncateDiffByLines,
} from '@alexanderfortin/pi-orchestrator/pi/tools/get-pr-diff';

// ---------------------------------------------------------------------------
// mergeIgnoreFiles
// ---------------------------------------------------------------------------

describe('mergeIgnoreFiles', () => {
  test('returns undefined when both inputs are empty', () => {
    expect(mergeIgnoreFiles([], [])).toBeUndefined();
  });

  test('returns the default list when caller provides none', () => {
    expect(mergeIgnoreFiles(['dist/', '*.log'], [])).toEqual(['dist/', '*.log']);
  });

  test('returns the caller list when no defaults', () => {
    expect(mergeIgnoreFiles([], ['node_modules/', '.cache'])).toEqual(['node_modules/', '.cache']);
  });

  test('merges and dedupes (preserving first-seen order)', () => {
    const merged = mergeIgnoreFiles(['dist/', 'package-lock.json'], ['dist/', 'node_modules/']);
    expect(merged).toEqual(['dist/', 'package-lock.json', 'node_modules/']);
  });

  test('handles overlap on identical entries', () => {
    expect(mergeIgnoreFiles(['a', 'b'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// truncateDiffByBytes
// ---------------------------------------------------------------------------

describe('truncateDiffByBytes', () => {
  test('returns the input unchanged when within budget', () => {
    const result = truncateDiffByBytes('hello', 100);
    expect(result).toEqual({ text: 'hello', truncated: false });
  });

  test('returns the input unchanged when exactly at budget', () => {
    const text = 'hello'; // 5 bytes
    expect(truncateDiffByBytes(text, 5)).toEqual({ text, truncated: false });
  });

  test('appends the truncation marker and keeps the head (snap-to-last-newline)', () => {
    const text = 'line1\nline2\nline3\nline4'; // 23 bytes
    const result = truncateDiffByBytes(text, 15);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('line1');
    expect(result.text).toContain('(truncated at 15 bytes)');
  });

  test('snaps to the last newline (no partial trailing line)', () => {
    const text = 'first_line\nsecond_line_long_enough_to_force_truncation\nthird_line';
    // Use a budget that lands mid-line; the snap-to-newline should drop the
    // partial trailing content.
    const result = truncateDiffByBytes(text, 40);
    expect(result.truncated).toBe(true);
    // The result text should not end with a partial "second_line_long_…" —
    // either it ends with the truncation marker OR ends with a complete line.
    const body = result.text.replace(/\n\.\.\. \(truncated at \d+ bytes\)$/, '');
    // Body must end at a clean line boundary (no partial word) or be empty.
    if (body.length > 0) {
      expect(body.endsWith('\n') || !body.includes('_long_enough')).toBe(true);
    }
  });

  test('handles multi-byte UTF-8 characters without producing replacement chars', () => {
    const text = 'ascii_line\n😀😀😀😀😀\nanother_ascii_line'; // 4-byte emoji × 5
    const result = truncateDiffByBytes(text, 30);
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain('\uFFFD');
  });

  test('handles empty input', () => {
    expect(truncateDiffByBytes('', 100)).toEqual({ text: '', truncated: false });
  });

  test('handles budget smaller than the marker itself', () => {
    const text = 'a'.repeat(200);
    const result = truncateDiffByBytes(text, 5);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('truncated at 5 bytes');
    // Output length can be longer than budget when marker itself exceeds it —
    // that's the documented behavior.
  });

  test('preserves content when budget exceeds size', () => {
    const text = 'short diff';
    expect(truncateDiffByBytes(text, 10_000)).toEqual({ text, truncated: false });
  });
});

// ---------------------------------------------------------------------------
// truncateDiffByLines
// ---------------------------------------------------------------------------

describe('truncateDiffByLines', () => {
  test('returns the input unchanged when within line budget', () => {
    const text = 'line1\nline2\nline3';
    expect(truncateDiffByLines(text, 5)).toEqual({ text, truncated: false });
  });

  test('returns the input unchanged when exactly at line budget', () => {
    const text = 'line1\nline2\nline3'; // 3 "lines" after split
    expect(truncateDiffByLines(text, 3)).toEqual({ text, truncated: false });
  });

  test('truncates to the first N lines and appends a marker with the remainder count', () => {
    const text = 'line1\nline2\nline3\nline4\nline5';
    const result = truncateDiffByLines(text, 2);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('line1\nline2')).toBe(true);
    expect(result.text).toContain('(truncated at 2 lines, 3 more)');
  });

  test('handles single-line input', () => {
    expect(truncateDiffByLines('only line', 5)).toEqual({
      text: 'only line',
      truncated: false,
    });
  });

  test('handles empty input', () => {
    expect(truncateDiffByLines('', 5)).toEqual({ text: '', truncated: false });
  });

  test('handles max_lines = 0 (drops everything, marks truncated)', () => {
    const result = truncateDiffByLines('line1\nline2', 0);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain('truncated at 0 lines');
  });

  test('handles max_lines = 1 (keeps first line only)', () => {
    const result = truncateDiffByLines('line1\nline2\nline3', 1);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('line1')).toBe(true);
    expect(result.text).toContain('(truncated at 1 lines, 2 more)');
  });
});

// ---------------------------------------------------------------------------
// truncateDiff (pipeline)
// ---------------------------------------------------------------------------

describe('truncateDiff', () => {
  test('returns the input unchanged when within both budgets', () => {
    const text = 'line1\nline2';
    expect(truncateDiff(text, 100, 10_000)).toEqual({
      text,
      truncated: false,
    });
  });

  test('prefers byte truncation when both limits are exceeded', () => {
    const text = 'a'.repeat(200) + '\n' + 'b'.repeat(200);
    const result = truncateDiff(text, 5, 100);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('bytes');
  });

  test('line-truncates when within byte budget but over line budget', () => {
    const text = 'line1\nline2\nline3\nline4\nline5';
    const result = truncateDiff(text, 2, 10_000);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('lines');
    expect(result.text).toContain('truncated at 2 lines');
  });

  test('byte-truncates when within line budget but over byte budget', () => {
    const text = 'a'.repeat(500); // 1 line, 500 bytes
    const result = truncateDiff(text, 1000, 100);
    expect(result.truncated).toBe(true);
    expect(result.truncatedReason).toBe('bytes');
  });

  test('does not apply line truncation when byte truncation already fired', () => {
    // Both limits would trigger independently — byte limit fires first and
    // the line check is skipped (documented strategy).
    const text = 'a'.repeat(500) + '\n'.repeat(50);
    const result = truncateDiff(text, 5, 100);
    expect(result.truncatedReason).toBe('bytes');
  });

  test('omits truncatedReason when no truncation occurred', () => {
    const result = truncateDiff('short', 100, 10_000);
    expect(result.truncated).toBe(false);
    expect(result.truncatedReason).toBeUndefined();
  });

  test('handles empty input', () => {
    expect(truncateDiff('', 100, 10_000)).toEqual({ text: '', truncated: false });
  });
});

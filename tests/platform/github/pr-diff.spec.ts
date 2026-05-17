/**
 * @file Tests for PR diff filtering logic.
 */

import { describe, expect, test, beforeAll } from 'bun:test';
import {
  filterDiffByIgnoreFiles,
  matchesIgnorePattern,
  resolveIgnorePatterns,
  smartTruncate,
} from '../../../src/platform/github/tools/pr-diff';
import { DEFAULT_DIFF_IGNORE_PATTERNS } from '../../../src/platform/github/constants';
import { resetModuleContext } from '../../../src/platform/github';

const SAMPLE_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc1234..def5678 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from './foo';
+import { bar } from './bar';
 
 export const main = foo;
diff --git a/dist/bundle.js b/dist/bundle.js
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/dist/bundle.js
@@ -0,0 +1,2 @@
+// bundled
+console.log("hello");
diff --git a/package-lock.json b/package-lock.json
index aaa1111..bbb2222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,2 @@
 {
+  "locked": true
+}
diff --git a/src/utils/helpers.ts b/src/utils/helpers.ts
index ccc3333..ddd4444 100644
--- a/src/utils/helpers.ts
+++ b/src/utils/helpers.ts
@@ -1,2 +1,3 @@
 export const helper = () => true;
+export const newHelper = () => false;
diff --git a/dist/secondary.js b/dist/secondary.js
new file mode 100644
index 0000000..eee5555
--- /dev/null
+++ b/dist/secondary.js
@@ -0,0 +1,1 @@
+// secondary bundle
`;

describe('matchesIgnorePattern', () => {
  test('matches exact file path', () => {
    expect(matchesIgnorePattern('a/package-lock.json', ['package-lock.json'])).toBe(true);
  });

  test('does not match different file', () => {
    expect(matchesIgnorePattern('a/src/index.ts', ['package-lock.json'])).toBe(false);
  });

  test('matches directory prefix pattern ending with /', () => {
    expect(matchesIgnorePattern('a/dist/bundle.js', ['dist/'])).toBe(true);
  });

  test('matches directory prefix without trailing /', () => {
    expect(matchesIgnorePattern('a/dist/bundle.js', ['dist'])).toBe(true);
  });

  test('matches nested file under directory prefix', () => {
    expect(matchesIgnorePattern('a/dist/sub/deep.js', ['dist/'])).toBe(true);
  });

  test('does not match file that only starts with same prefix but is not in directory', () => {
    expect(matchesIgnorePattern('a/distillery.ts', ['dist/'])).toBe(false);
  });

  test('matches with empty ignore list', () => {
    expect(matchesIgnorePattern('a/src/index.ts', [])).toBe(false);
  });

  test('strips b/ prefix as well', () => {
    expect(matchesIgnorePattern('b/dist/bundle.js', ['dist/'])).toBe(true);
  });
});

beforeAll(() => {
  resetModuleContext({
    debug: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
});

describe('filterDiffByIgnoreFiles', () => {
  test('returns original diff when ignoreFiles is empty', () => {
    const diff = SAMPLE_DIFF;
    const result = filterDiffByIgnoreFiles(diff, []);
    expect(result).toBe(diff);
  });

  test('filters out files matching a directory prefix', () => {
    const result = filterDiffByIgnoreFiles(SAMPLE_DIFF, ['dist/']);
    expect(result).not.toContain('diff --git a/dist/bundle.js');
    expect(result).not.toContain('diff --git a/dist/secondary.js');
    expect(result).not.toContain('// bundled');
    expect(result).not.toContain('// secondary bundle');
    expect(result).toContain('diff --git a/src/index.ts');
    expect(result).toContain('diff --git a/src/utils/helpers.ts');
  });

  test('filters out an exact file path', () => {
    const result = filterDiffByIgnoreFiles(SAMPLE_DIFF, ['package-lock.json']);
    expect(result).not.toContain('diff --git a/package-lock.json');
    expect(result).toContain('diff --git a/src/index.ts');
  });

  test('filters multiple patterns at once', () => {
    const result = filterDiffByIgnoreFiles(SAMPLE_DIFF, ['dist/', 'package-lock.json']);
    // Should keep only src/ files
    expect(result).toContain('diff --git a/src/index.ts');
    expect(result).toContain('diff --git a/src/utils/helpers.ts');
    expect(result).not.toContain('dist/');
    expect(result).not.toContain('package-lock.json');
  });

  test('preserves file content for kept files', () => {
    const result = filterDiffByIgnoreFiles(SAMPLE_DIFF, ['dist/', 'package-lock.json']);
    expect(result).toContain('import { bar }');
    expect(result).toContain('export const newHelper');
  });

  test('returns empty result when all files are filtered', () => {
    const singleFileDiff = `diff --git a/dist/bundle.js b/dist/bundle.js
new file mode 100644
--- /dev/null
+++ b/dist/bundle.js
@@ -0,0 +1,1 @@
+console.log("hello");
`;
    const result = filterDiffByIgnoreFiles(singleFileDiff, ['dist/']);
    expect(result).not.toContain('diff --git');
  });

  test('handles diff with no matching files to filter', () => {
    const result = filterDiffByIgnoreFiles(SAMPLE_DIFF, ['nonexistent/']);
    expect(result).toBe(SAMPLE_DIFF);
  });
});

describe('DEFAULT_DIFF_IGNORE_PATTERNS', () => {
  test('includes dist/', () => {
    expect(DEFAULT_DIFF_IGNORE_PATTERNS).toContain('dist/');
  });

  test('includes package-lock.json', () => {
    expect(DEFAULT_DIFF_IGNORE_PATTERNS).toContain('package-lock.json');
  });

  test('includes yarn.lock', () => {
    expect(DEFAULT_DIFF_IGNORE_PATTERNS).toContain('yarn.lock');
  });

  test('includes pnpm-lock.yaml', () => {
    expect(DEFAULT_DIFF_IGNORE_PATTERNS).toContain('pnpm-lock.yaml');
  });

  test('includes vendor/', () => {
    expect(DEFAULT_DIFF_IGNORE_PATTERNS).toContain('vendor/');
  });

  test('includes go.sum', () => {
    expect(DEFAULT_DIFF_IGNORE_PATTERNS).toContain('go.sum');
  });

  test('includes Cargo.lock', () => {
    expect(DEFAULT_DIFF_IGNORE_PATTERNS).toContain('Cargo.lock');
  });

  test('filtering with default patterns removes dist/ and lock files', () => {
    const result = filterDiffByIgnoreFiles(SAMPLE_DIFF, [...DEFAULT_DIFF_IGNORE_PATTERNS]);
    // Should keep only src/ files
    expect(result).toContain('diff --git a/src/index.ts');
    expect(result).toContain('diff --git a/src/utils/helpers.ts');
    expect(result).not.toContain('diff --git a/dist/');
    expect(result).not.toContain('diff --git a/package-lock.json');
  });
});

describe('resolveIgnorePatterns', () => {
  test('returns defaults when no patterns provided', () => {
    const result = resolveIgnorePatterns();
    expect(result).toContain('dist/');
    expect(result).toContain('package-lock.json');
    expect(result).toContain('vendor/');
  });

  test('returns defaults when undefined patterns provided', () => {
    const result = resolveIgnorePatterns(undefined, undefined);
    expect(result).toEqual(expect.arrayContaining([...DEFAULT_DIFF_IGNORE_PATTERNS]));
  });

  test('user patterns REPLACE defaults entirely', () => {
    const result = resolveIgnorePatterns(['snapshots/', 'fixtures/']);
    // User patterns replace defaults — defaults should NOT be present
    expect(result).not.toContain('dist/');
    expect(result).not.toContain('vendor/');
    expect(result).toContain('snapshots/');
    expect(result).toContain('fixtures/');
    expect(result).toHaveLength(2);
  });

  test('LLM patterns extend defaults when no user patterns', () => {
    const result = resolveIgnorePatterns(undefined, ['extra.ts']);
    expect(result).toContain('dist/'); // default
    expect(result).toContain('extra.ts'); // LLM
  });

  test('LLM patterns extend user patterns when user patterns are set', () => {
    const result = resolveIgnorePatterns(['custom/'], ['extra.ts']);
    expect(result).not.toContain('dist/'); // defaults replaced
    expect(result).toContain('custom/'); // user
    expect(result).toContain('extra.ts'); // LLM
  });

  test('deduplicates patterns', () => {
    const result = resolveIgnorePatterns(['dist/', 'vendor/'], ['dist/']);
    const distCount = result.filter(p => p === 'dist/').length;
    expect(distCount).toBe(1);
  });

  test('empty user patterns array is treated as no user patterns', () => {
    const result = resolveIgnorePatterns([]);
    // Empty array means user didn't configure anything — use defaults
    expect(result).toContain('dist/');
    expect(result).toContain('vendor/');
  });
});

describe('smartTruncate', () => {
  test('returns diff as-is when it fits within budget', () => {
    const smallDiff = 'diff --git a/file.ts b/file.ts\n+hello\n';
    const result = smartTruncate(smallDiff, 100_000);
    expect(result).toBe(smallDiff);
  });

  test('preserves original file order among kept hunks', () => {
    // Build a diff with 3 files: small, medium, large
    const makeHunk = (name: string, sizeBytes: number) => {
      const padding = 'x'.repeat(sizeBytes);
      return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n+${padding}\n`;
    };
    const diff = makeHunk('aaa-small.ts', 100) + makeHunk('zzz-large.ts', 5000) + makeHunk('mmm-medium.ts', 200);

    // Budget only allows the two smallest files (aaa-small + mmm-medium)
    const result = smartTruncate(diff, 1000);

    // aaa-small.ts should appear before mmm-medium.ts (original order)
    const aaaPos = result.indexOf('aaa-small.ts');
    const mmmPos = result.indexOf('mmm-medium.ts');
    expect(aaaPos).toBeGreaterThan(-1);
    expect(mmmPos).toBeGreaterThan(-1);
    expect(aaaPos).toBeLessThan(mmmPos);

    // zzz-large.ts should be dropped (not in kept hunks)
    expect(result).not.toContain('--- a/zzz-large.ts');
  });

  test('appends summary of dropped files', () => {
    const makeHunk = (name: string, sizeBytes: number) => {
      const padding = 'x'.repeat(sizeBytes);
      return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n+${padding}\n`;
    };
    const diff = makeHunk('small.ts', 100) + makeHunk('large.ts', 5000);

    const result = smartTruncate(diff, 1000);
    expect(result).toContain('1 large file omitted');
    expect(result).toContain('large.ts');
  });

  test('handles diff with exactly one file exceeding budget', () => {
    const singleFileDiff = `diff --git a/huge.ts b/huge.ts
--- a/huge.ts
+++ b/huge.ts
+${'x'.repeat(5000)}
`;
    const result = smartTruncate(singleFileDiff, 1000);
    // Single file can't be hunk-dropped, falls back to line truncation
    expect(result).toContain('truncated to fit byte limit');
  });

  test('handles empty diff', () => {
    const result = smartTruncate('', 1000);
    expect(result).toBe('');
  });

  test('all hunks dropped produces header-only result with summary', () => {
    const makeHunk = (name: string) =>
      `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n+${'x'.repeat(500)}\n`;
    const diff = makeHunk('big1.ts') + makeHunk('big2.ts');

    // Budget so small that no hunk can fit
    const result = smartTruncate(diff, 50);
    expect(result).toContain('2 large files omitted');
    expect(result).toContain('big1.ts');
    expect(result).toContain('big2.ts');
  });
});

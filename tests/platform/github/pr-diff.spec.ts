/**
 * @file Tests for PR diff filtering logic.
 */

import { describe, expect, test, beforeAll } from 'bun:test';
import { filterDiffByIgnoreFiles, matchesIgnorePattern } from '../../../src/platform/github/tools/pr-diff';
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

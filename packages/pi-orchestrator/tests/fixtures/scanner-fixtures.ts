/**
 * @file Shared fixtures and assertions for the file-scanner specs.
 *
 * Both `packages/pi-orchestrator/tests/git/file-scanner.spec.ts` (which
 * exercises the platform-agnostic `scanForChanges` / `scanDirectory`
 * primitives directly) and `packages/pi-platform-github/tests/git.spec.ts`
 * (which exercises the GitHub-provider wrappers around the same primitives)
 * cover the same scenarios with slightly different API shapes. The duplicated
 * setup lives here; each spec keeps its own scan-call + assertion code.
 *
 * Lives in `pi-orchestrator/tests/fixtures/` so it can be imported by both
 * packages (matches the precedent set by
 * `pi-orchestrator/tests/fixtures/extensions/`, which is cross-imported by
 * `tests/e2e/` via relative path).
 */

import { expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';

/**
 * Reference file entry used by `scanForChanges` / `scanDirectory`.
 * Mirrors the type accepted by both the orchestrator primitive and the
 * GitHub wrapper.
 */
export interface ReferenceFile {
  sha: string;
  content: string | null;
}

/**
 * Create files inside `tempDir` from a record of relative-path → content.
 * Equivalent to N consecutive `fs.writeFileSync(path.join(tempDir, rel), content)` calls.
 */
export function writeFiles(tempDir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tempDir, rel), content);
  }
}

/**
 * Build a reference-files Map from a plain object.
 */
export function referenceMap(files: Record<string, ReferenceFile>): Map<string, ReferenceFile> {
  return new Map(Object.entries(files));
}

/**
 * "Modified file" fixture: writes `test.txt` with new content and returns
 * a reference Map pointing at the old content + a stable sha.
 *
 * Used by the `detects modified files` tests in both scanner specs.
 */
export function setupModifiedFileFixture(tempDir: string): {
  reference: Map<string, ReferenceFile>;
} {
  writeFiles(tempDir, { 'test.txt': 'new content' });
  return {
    reference: referenceMap({
      'test.txt': { sha: 'abc123', content: 'old content' },
    }),
  };
}

/**
 * "Ignore patterns" fixture: writes `included.txt` + `excluded.txt` and
 * returns an `ignore` instance configured to ignore `excluded.txt`.
 *
 * Used by the `respects ignore patterns` tests in both scanner specs.
 */
export function setupIgnorePatternsFixture(tempDir: string): {
  ig: Ignore;
} {
  writeFiles(tempDir, { 'included.txt': 'included', 'excluded.txt': 'excluded' });
  const ig = ignore();
  ig.add('excluded.txt');
  return { ig };
}

/**
 * "Comparison" fixture: writes 3 files to disk (unchanged / changed / new)
 * and returns a reference Map for the unchanged and changed ones. The
 * `new.txt` file intentionally has no reference entry — that's what the
 * tests assert against.
 *
 * Used by the `compares files with reference` tests in both scanner specs.
 */
export function setupComparisonFixture(tempDir: string): {
  reference: Map<string, ReferenceFile>;
} {
  writeFiles(tempDir, {
    'unchanged.txt': 'same',
    'changed.txt': 'different',
    'new.txt': 'new',
  });
  return {
    reference: referenceMap({
      'unchanged.txt': { sha: 'abc123', content: 'same' },
      'changed.txt': { sha: 'def456', content: 'old' },
    }),
  };
}

/**
 * Assert that `result.changedFiles` contains exactly the given paths
 * (order-independent). Each path must appear at least once; no extras
 * are allowed.
 */
export function expectChangedPaths<T extends { path: string }>(
  result: { changedFiles: T[] },
  paths: string[]
): void {
  expect(result.changedFiles).toHaveLength(paths.length);
  for (const p of paths) {
    expect(result.changedFiles.some(f => f.path === p)).toBe(true);
  }
}

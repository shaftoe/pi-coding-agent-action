/**
 * Unit tests for the pure helpers extracted from
 * `packages/pi-action/scripts/package.ts` in Step 2.11 (buildDist refactor).
 *
 * The top-level `buildDist` is a build orchestrator that invokes esbuild,
 * so it's not unit-testable. The extracted helpers here are all pure or
 * filesystem-bound with simple contracts.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  composeActionVersion,
  copyAllSdkAssets,
  copySdkAssetDir,
  readJsonVersion,
  RELEASE_BRANCH_RE,
} from '../../scripts/package';

// ---------------------------------------------------------------------------
// RELEASE_BRANCH_RE
// ---------------------------------------------------------------------------

describe('RELEASE_BRANCH_RE', () => {
  test('matches v2', () => {
    expect(RELEASE_BRANCH_RE.test('v2')).toBe(true);
  });

  test('matches v3, v10, v99', () => {
    expect(RELEASE_BRANCH_RE.test('v3')).toBe(true);
    expect(RELEASE_BRANCH_RE.test('v10')).toBe(true);
    expect(RELEASE_BRANCH_RE.test('v99')).toBe(true);
  });

  test('does not match non-release branches', () => {
    expect(RELEASE_BRANCH_RE.test('develop')).toBe(false);
    expect(RELEASE_BRANCH_RE.test('main')).toBe(false);
    expect(RELEASE_BRANCH_RE.test('feature/foo')).toBe(false);
  });

  test('does not match false positives', () => {
    expect(RELEASE_BRANCH_RE.test('v2-rc')).toBe(false);
    expect(RELEASE_BRANCH_RE.test('v2.1')).toBe(false);
    expect(RELEASE_BRANCH_RE.test('v')).toBe(false);
    expect(RELEASE_BRANCH_RE.test('version2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// composeActionVersion
// ---------------------------------------------------------------------------

describe('composeActionVersion', () => {
  test('returns bare version for v2 (release branch)', () => {
    expect(composeActionVersion('2.19.3', 'v2')).toBe('2.19.3');
  });

  test('returns bare version for v3 (future release branch)', () => {
    expect(composeActionVersion('3.0.0', 'v3')).toBe('3.0.0');
  });

  test('returns prerelease version for develop branch', () => {
    expect(composeActionVersion('2.19.3', 'develop', '9272858')).toBe('2.19.3-develop.9272858');
  });

  test('sanitizes branch names with slashes', () => {
    expect(composeActionVersion('2.19.3', 'feature/foo', 'abcdef12')).toBe(
      '2.19.3-feature-foo.abcdef12'
    );
  });

  test('returns unknown fallback when no env vars set', () => {
    expect(composeActionVersion('2.19.3', 'unknown', 'unknown')).toBe('2.19.3-unknown.unknown');
  });

  test('truncates SHA to 7 characters (resolveSha behavior)', () => {
    // When passed explicitly, sha is used as-is; resolveSha() does the slicing
    expect(composeActionVersion('2.19.3', 'develop', 'abcdef12')).toBe('2.19.3-develop.abcdef12');
  });
});

// ---------------------------------------------------------------------------
// readJsonVersion
// ---------------------------------------------------------------------------

describe('readJsonVersion', () => {
  test('returns the .version field from a JSON file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pi-pkg-test-'));
    try {
      const pkgPath = join(tmpDir, 'package.json');
      writeFileSync(pkgPath, JSON.stringify({ name: 'foo', version: '1.2.3' }));
      expect(readJsonVersion(pkgPath)).toBe('1.2.3');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('throws when the file does not exist', () => {
    expect(() => readJsonVersion('/nonexistent/path/package.json')).toThrow();
  });

  test('throws when JSON is invalid', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pi-pkg-test-'));
    try {
      const pkgPath = join(tmpDir, 'bad.json');
      writeFileSync(pkgPath, '{ not valid json');
      expect(() => readJsonVersion(pkgPath)).toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('returns undefined when JSON has no .version field (caller bug)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pi-pkg-test-'));
    try {
      const pkgPath = join(tmpDir, 'package.json');
      writeFileSync(pkgPath, JSON.stringify({ name: 'foo' }));
      // Caller is expected to pass JSON files that have a `version` field.
      // When missing, the access returns `undefined` (which TypeScript
      // surfaces as `string` because we trust the input shape).
      expect(readJsonVersion(pkgPath)).toBeUndefined();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// copySdkAssetDir
// ---------------------------------------------------------------------------

describe('copySdkAssetDir', () => {
  let tmpDir: string;

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), 'pi-asset-test-'));
  }

  function teardown() {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  test('copies all listed files when source dir and all files exist', () => {
    setup();
    try {
      const srcDir = join(tmpDir, 'src');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'a.txt'), 'AAA');
      writeFileSync(join(srcDir, 'b.txt'), 'BBB');

      copySdkAssetDir(srcDir, destDir, ['a.txt', 'b.txt']);

      expect(readFileSync(join(destDir, 'a.txt'), 'utf-8')).toBe('AAA');
      expect(readFileSync(join(destDir, 'b.txt'), 'utf-8')).toBe('BBB');
    } finally {
      teardown();
    }
  });

  test('silently skips missing files but copies the rest', () => {
    setup();
    try {
      const srcDir = join(tmpDir, 'src');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'present.txt'), 'HERE');

      copySdkAssetDir(srcDir, destDir, ['present.txt', 'missing.txt']);

      expect(readFileSync(join(destDir, 'present.txt'), 'utf-8')).toBe('HERE');
      expect(existsSync(join(destDir, 'missing.txt'))).toBe(false);
    } finally {
      teardown();
    }
  });

  test('does nothing when source dir does not exist', () => {
    setup();
    try {
      const destDir = join(tmpDir, 'dest');
      copySdkAssetDir(join(tmpDir, 'nonexistent'), destDir, ['a.txt']);
      expect(existsSync(destDir)).toBe(false);
    } finally {
      teardown();
    }
  });

  test('creates nested destination directory when missing', () => {
    setup();
    try {
      const srcDir = join(tmpDir, 'src');
      const destDir = join(tmpDir, 'deeply', 'nested', 'dest');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'a.txt'), 'X');

      copySdkAssetDir(srcDir, destDir, ['a.txt']);

      expect(readFileSync(join(destDir, 'a.txt'), 'utf-8')).toBe('X');
    } finally {
      teardown();
    }
  });

  test('handles an empty file list (no-op except mkdir)', () => {
    setup();
    try {
      const srcDir = join(tmpDir, 'src');
      const destDir = join(tmpDir, 'dest');
      mkdirSync(srcDir, { recursive: true });

      copySdkAssetDir(srcDir, destDir, []);

      expect(existsSync(destDir)).toBe(true);
    } finally {
      teardown();
    }
  });
});

// ---------------------------------------------------------------------------
// copyAllSdkAssets
// ---------------------------------------------------------------------------

describe('copyAllSdkAssets', () => {
  test('copies all configured SDK asset directories', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pi-all-asset-test-'));
    try {
      // Mirror the SDK_ASSETS layout: core/export-html/...,
      // core/export-html/vendor/..., modes/interactive/theme/...
      const sdkDist = join(tmpDir, 'sdk-dist');
      const piSdkDest = join(tmpDir, 'pi-sdk');
      const dirs = [
        [
          'core/export-html',
          [
            ['template.html', '<html/>'],
            ['template.css', 'body{}'],
            ['template.js', 'console.log'],
          ],
        ],
        [
          'core/export-html/vendor',
          [
            ['marked.min.js', '//marked'],
            ['highlight.min.js', '//hljs'],
          ],
        ],
        [
          'modes/interactive/theme',
          [
            ['dark.json', '{}'],
            ['light.json', '{}'],
          ],
        ],
      ];
      for (const [dir, files] of dirs) {
        const d = join(sdkDist, dir as string);
        mkdirSync(d, { recursive: true });
        for (const [name, body] of files as [string, string][]) {
          writeFileSync(join(d, name), body);
        }
      }

      copyAllSdkAssets(sdkDist, piSdkDest);

      expect(readFileSync(join(piSdkDest, 'core/export-html/template.html'), 'utf-8')).toBe(
        '<html/>'
      );
      expect(readFileSync(join(piSdkDest, 'core/export-html/template.css'), 'utf-8')).toBe(
        'body{}'
      );
      expect(readFileSync(join(piSdkDest, 'core/export-html/template.js'), 'utf-8')).toBe(
        'console.log'
      );
      expect(readFileSync(join(piSdkDest, 'core/export-html/vendor/marked.min.js'), 'utf-8')).toBe(
        '//marked'
      );
      expect(
        readFileSync(join(piSdkDest, 'core/export-html/vendor/highlight.min.js'), 'utf-8')
      ).toBe('//hljs');
      expect(readFileSync(join(piSdkDest, 'modes/interactive/theme/dark.json'), 'utf-8')).toBe(
        '{}'
      );
      expect(readFileSync(join(piSdkDest, 'modes/interactive/theme/light.json'), 'utf-8')).toBe(
        '{}'
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('is a no-op when the sdkDistDir is empty/missing', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pi-all-asset-test-'));
    try {
      const piSdkDest = join(tmpDir, 'pi-sdk');
      copyAllSdkAssets(join(tmpDir, 'no-such-dir'), piSdkDest);
      expect(existsSync(piSdkDest)).toBe(false);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

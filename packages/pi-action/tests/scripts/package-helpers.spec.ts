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
  copyAllSdkAssets,
  copySdkAssetDir,
  composeActionVersion,
  formatGitMetadata,
  readJsonVersion,
} from '../../scripts/package';

// ---------------------------------------------------------------------------
// formatGitMetadata
// ---------------------------------------------------------------------------

describe('formatGitMetadata', () => {
  test('returns a populated object when both inputs are present', () => {
    expect(formatGitMetadata('feature/foo', 'abcdef1234567890')).toEqual({
      branch: 'feature/foo',
      sha: 'abcdef1',
    });
  });

  test('truncates SHA to 7 characters even when input is shorter', () => {
    expect(formatGitMetadata('main', 'abc').sha).toBe('abc');
    expect(formatGitMetadata('main', 'abcdefg').sha).toBe('abcdefg');
    expect(formatGitMetadata('main', 'abcdefgh').sha).toBe('abcdefg');
  });

  test('coerces null branch to "unknown"', () => {
    expect(formatGitMetadata(null, 'deadbeef')).toEqual({
      branch: 'unknown',
      sha: 'deadbee',
    });
  });

  test('coerces void (undefined) branch to "unknown"', () => {
    // isomorphic-git's `currentBranch` returns `string | void`
    expect(formatGitMetadata(undefined, 'deadbeef')).toEqual({
      branch: 'unknown',
      sha: 'deadbee',
    });
  });

  test('coerces undefined headOid to "unknown"', () => {
    expect(formatGitMetadata('main', undefined)).toEqual({
      branch: 'main',
      sha: 'unknown',
    });
  });

  test('"unknown" sha is preserved by .slice (still 7 chars)', () => {
    expect(formatGitMetadata(null, undefined).sha).toBe('unknown');
  });

  test('handles all-undefined input', () => {
    expect(formatGitMetadata(null, undefined)).toEqual({
      branch: 'unknown',
      sha: 'unknown',
    });
  });
});

// ---------------------------------------------------------------------------
// composeActionVersion
// ---------------------------------------------------------------------------

describe('composeActionVersion', () => {
  const meta = { branch: 'develop', sha: 'a1b2c3d' };

  test('returns bare semver for release builds regardless of branch', () => {
    expect(composeActionVersion('2.19.3', meta, true)).toBe('2.19.3');
  });

  test('returns bare semver for release builds even on non-v2 branch', () => {
    // This is the key fix: release is explicit, not branch-based.
    // A release build on 'develop' (or any branch) still gets bare semver.
    expect(composeActionVersion('2.19.3', { branch: 'develop', sha: 'deadbeef' }, true)).toBe(
      '2.19.3'
    );
  });

  test('composes dev version with branch and sha for dev builds', () => {
    expect(composeActionVersion('2.19.3', meta, false)).toBe('2.19.3-dev+develop.a1b2c3d');
  });

  test('sanitizes branch names with slashes for dev builds', () => {
    expect(composeActionVersion('2.19.3', { branch: 'feature/foo', sha: 'a1b2c3d' }, false)).toBe(
      '2.19.3-dev+feature-foo.a1b2c3d'
    );
  });

  test('handles unknown git metadata for dev builds', () => {
    expect(composeActionVersion('2.19.3', { branch: 'unknown', sha: 'unknown' }, false)).toBe(
      '2.19.3-dev+unknown.unknown'
    );
  });

  test('dev build on v2 branch still gets dev suffix (release is explicit)', () => {
    // Without RELEASE_BUILD=true, even a build on v2 is treated as dev.
    // This prevents stale dev builds masquerading as releases.
    expect(composeActionVersion('2.19.3', { branch: 'v2', sha: 'a1b2c3d' }, false)).toBe(
      '2.19.3-dev+v2.a1b2c3d'
    );
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

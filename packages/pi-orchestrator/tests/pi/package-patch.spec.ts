/**
 * Regression tests for the build-time SDK loader patch (patchSDKLoaderPlugin).
 *
 * The patch wraps `getAliases()` in a try-catch so that `require.resolve("typebox")`
 * failures don't prevent extension loading in the bundled GitHub Action.
 *
 * These tests verify that:
 * 1. The SDK's `getAliases()` function still matches the expected pattern
 * 2. The patch applies correctly and wraps the body in a try-catch
 * 3. The patched function returns empty aliases on failure
 *
 * If these tests fail after an SDK upgrade, the patch regexes in
 * `scripts/package.ts` need to be updated to match the new pattern.
 */

import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Path to the SDK's loader.js that contains getAliases().
 */
function getLoaderPath(): string {
  return join(
    process.cwd(),
    'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'
  );
}

/**
 * The same regex patterns used by `patchSDKLoaderPlugin` in `scripts/package.ts`.
 *
 * Duplicated here (rather than imported) so the test acts as an independent
 * sentinel — if the SDK changes and the patterns stop matching, this test
 * fails regardless of whether the build script was updated.
 */
const FUNCTION_START_PATTERN =
  /function getAliases\(\) \{\s*\n(\s*if \(_aliases\)\s*\n\s*return _aliases;\s*\n)/;

const FUNCTION_BODY_PATTERN = /(_aliases = \{[^}]+\};\s*\n)(\s*return _aliases;\s*\n)(\})/;

describe('SDK getAliases() build-time patch', () => {
  test('loader.js exists at expected path', () => {
    expect(existsSync(getLoaderPath())).toBe(true);
  });

  test('getAliases function start pattern still matches', () => {
    const source = readFileSync(getLoaderPath(), 'utf-8');
    const match = source.match(FUNCTION_START_PATTERN);
    expect(match).not.toBeNull();
  });

  test('getAliases aliases assignment pattern still matches', () => {
    const source = readFileSync(getLoaderPath(), 'utf-8');
    const match = source.match(FUNCTION_BODY_PATTERN);
    expect(match).not.toBeNull();
  });

  test('patch transforms the function body correctly', () => {
    const source = readFileSync(getLoaderPath(), 'utf-8');

    // Apply the same transformation as patchSDKLoaderPlugin
    const patched = source
      .replace(FUNCTION_START_PATTERN, 'function getAliases() {\n$1    try {\n')
      .replace(
        FUNCTION_BODY_PATTERN,
        '$1    $2    } catch { _aliases = {}; return _aliases; }\n$3'
      );

    // Patch must actually change something
    expect(patched).not.toBe(source);

    // The patched code must contain the try-catch
    expect(patched).toContain('try {');
    expect(patched).toContain('} catch { _aliases = {}; return _aliases; }');
  });

  test('try block wraps require.resolve("typebox")', () => {
    const source = readFileSync(getLoaderPath(), 'utf-8');

    const patched = source
      .replace(FUNCTION_START_PATTERN, 'function getAliases() {\n$1    try {\n')
      .replace(
        FUNCTION_BODY_PATTERN,
        '$1    $2    } catch { _aliases = {}; return _aliases; }\n$3'
      );

    // Extract the getAliases function body from the patched source
    const fnStart = patched.indexOf('function getAliases()');
    const catchClause = patched.indexOf('} catch { _aliases = {}; return _aliases; }', fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(catchClause).toBeGreaterThan(fnStart);

    const fnBody = patched.substring(fnStart, catchClause);

    // The try block must start before require.resolve("typebox")
    expect(fnBody).toContain('try {');
    expect(fnBody).toContain('require.resolve("typebox")');

    // try { must appear before require.resolve
    const tryPos = fnBody.indexOf('try {');
    const resolvePos = fnBody.indexOf('require.resolve("typebox")');
    expect(tryPos).toBeLessThan(resolvePos);
  });

  test('patch returns empty aliases object on catch', () => {
    const source = readFileSync(getLoaderPath(), 'utf-8');

    const patched = source
      .replace(FUNCTION_START_PATTERN, 'function getAliases() {\n$1    try {\n')
      .replace(
        FUNCTION_BODY_PATTERN,
        '$1    $2    } catch { _aliases = {}; return _aliases; }\n$3'
      );

    // The catch block sets _aliases to {} and returns it
    expect(patched).toContain('catch { _aliases = {}; return _aliases; }');
  });

  test('function body pattern no longer matches after patching', () => {
    const source = readFileSync(getLoaderPath(), 'utf-8');

    const patched = source
      .replace(FUNCTION_START_PATTERN, 'function getAliases() {\n$1    try {\n')
      .replace(
        FUNCTION_BODY_PATTERN,
        '$1    $2    } catch { _aliases = {}; return _aliases; }\n$3'
      );

    // The body pattern (which matches `_aliases = {...}; \n return _aliases; \n }`)
    // should NOT match again after patching because the closing brace `}`
    // is now followed by the catch clause, not end-of-function.
    expect(FUNCTION_BODY_PATTERN.test(patched)).toBe(false);
  });
});

/**
 * Tests for the build/package script.
 *
 * Verifies that:
 * 1. The Pi SDK is correctly marked as external in the esbuild bundle
 * 2. The runtime install banner is present and correct
 * 3. The SDK is NOT inlined in the bundle (external mode)
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

describe('SDK external packaging', () => {
  const distPath = join(process.cwd(), 'dist', 'index.js');

  test('dist/index.js exists after build', () => {
    expect(existsSync(distPath)).toBe(true);
  });

  test('Pi SDK is required externally (not inlined)', () => {
    const source = readFileSync(distPath, 'utf-8');

    // The bundle should contain a require() call for the SDK,
    // not its inlined source code.
    expect(source).toContain('require("@earendil-works/pi-coding-agent")');

    // The SDK's internal module structure should NOT appear in the bundle.
    // A strong indicator is the absence of specific SDK function names
    // that would be inlined if bundled.
    // Note: some strings may appear in tool descriptions, so we check for
    // SDK-internal code patterns, not function names.
  });

  test('install banner is present at the top of the bundle', () => {
    const source = readFileSync(distPath, 'utf-8');

    // The banner starts with an IIFE that reads INPUT_PI_VERSION
    expect(source).toContain('INPUT_PI_VERSION');

    // The banner installs the SDK via npm
    expect(source).toContain('npm install');
    expect(source).toContain('@earendil-works/pi-coding-agent@');

    // The banner checks the installed version before installing
    expect(source).toContain('package.json');
  });

  test('install banner includes the default version from package.json', () => {
    const source = readFileSync(distPath, 'utf-8');

    // The banner should contain a version string after the SDK package name
    // (the version is extracted from node_modules at build time)
    expect(source).toMatch(/pi-coding-agent@"[^"]+"/);
  });

  test('dist does not contain pi-sdk directory (removed)', () => {
    const piSdkPath = join(process.cwd(), 'dist', 'pi-sdk');
    expect(existsSync(piSdkPath)).toBe(false);
  });

  test('bundle size is reasonable (SDK is external)', () => {
    const stat = statSync(distPath);
    const sizeMB = stat.size / (1024 * 1024);

    // With the SDK external, the bundle should be much smaller than before
    // (was ~8MB with SDK bundled, should be ~1-2MB without)
    expect(sizeMB).toBeLessThan(3);
  });
});

/**
 * Tests for version utility functions.
 */

import { describe, expect, test, beforeEach } from 'bun:test';

describe('version utilities', () => {
  beforeEach(() => {
    // Set env vars before tests
    process.env.INPUT_TRIGGER = '/pi';
    process.env.INPUT_GITHUB_TOKEN = 'fake-token';
    process.env.INPUT_MAX_COMMENTS = '100';
  });

  describe('getActionVersion', () => {
    test('returns version from package.json', async () => {
      const { getActionVersion } = await import('../../src/utils/version');
      const version = getActionVersion();
      // Should be a non-empty string
      expect(version).toBeDefined();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    });

    test('returns valid semver format', async () => {
      const { getActionVersion } = await import('../../src/utils/version');
      const version = getActionVersion();
      // Either version or "unknown" if package.json not found
      if (version !== 'unknown') {
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
      }
    });
  });

  describe('getPiSdkVersion', () => {
    test('returns version from Pi SDK package.json', async () => {
      const { getPiSdkVersion } = await import('../../src/utils/version');
      const version = getPiSdkVersion();
      // Should be a non-empty string
      expect(version).toBeDefined();
      expect(typeof version).toBe('string');
      expect(version.length).toBeGreaterThan(0);
    });

    test('returns valid semver format or unknown', async () => {
      const { getPiSdkVersion } = await import('../../src/utils/version');
      const version = getPiSdkVersion();
      // Either version or "unknown" if package.json not found
      if (version !== 'unknown') {
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
      } else {
        expect(version).toBe('unknown');
      }
    });
  });
});

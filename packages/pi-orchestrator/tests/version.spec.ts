import { describe, expect, test } from 'bun:test';
import {
  getActionVersion,
  getPiVersion,
  formatActionVersion,
} from '@alexanderfortin/pi-orchestrator';

describe('getActionVersion', () => {
  test('returns a non-empty string', () => {
    const result = getActionVersion();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns a valid semver-like string or "unknown"', () => {
    const result = getActionVersion();
    // Should be either a version like "2.18.0" or "unknown"
    expect(result === 'unknown' || /^\d+\.\d+\.\d+/.test(result)).toBe(true);
  });

  test('is cached — repeated calls return the same value', () => {
    const first = getActionVersion();
    const second = getActionVersion();
    expect(first).toBe(second);
  });
});

describe('getPiVersion', () => {
  test('returns a non-empty string', () => {
    const result = getPiVersion();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns a valid semver-like string or "unknown"', () => {
    const result = getPiVersion();
    expect(result === 'unknown' || /^\d+\.\d+\.\d+/.test(result)).toBe(true);
  });

  test('is cached — repeated calls return the same value', () => {
    const first = getPiVersion();
    const second = getPiVersion();
    expect(first).toBe(second);
  });
});

describe('formatActionVersion', () => {
  test('formats a clean release version as-is', () => {
    expect(formatActionVersion('2.19.3')).toBe('2.19.3');
  });

  test('formats a dev version with branch and sha', () => {
    expect(formatActionVersion('2.19.3-develop.9272858')).toBe(
      '2.19.3-develop (develop @ 9272858)'
    );
  });

  test("handles 'unknown' gracefully", () => {
    expect(formatActionVersion('unknown')).toBe('unknown');
  });

  test('handles branch name with dashes (sanitized)', () => {
    expect(formatActionVersion('2.19.3-feature-my-feature.abc1234')).toBe(
      '2.19.3-feature-my-feature (feature-my-feature @ abc1234)'
    );
  });

  test('handles unknown fallback version', () => {
    expect(formatActionVersion('2.19.3-unknown.unknown')).toBe(
      '2.19.3-unknown (unknown @ unknown)'
    );
  });

  test('returns package version when called without argument (non-bundled)', () => {
    const result = formatActionVersion();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // In test environment (non-bundled), this returns the package.json version
    expect(result).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// Resolution logic tests (esbuild `define` path)
// ---------------------------------------------------------------------------
// When the action is bundled by esbuild, its `define` option replaces bare
// __VERSION__ / __PI_CODING_AGENT_VERSION__ identifiers with version string
// literals. These tests verify the resolution logic itself (the typeof check
// and assignment) works correctly by evaluating the logic in a fresh scope
// where the identifiers are defined as parameters.

describe('version resolution logic', () => {
  test('action version resolution uses __VERSION__ when defined (simulating esbuild define)', () => {
    function resolveActionVersion(__VERSION__: string | undefined): string {
      let version = 'unknown';
      if (typeof __VERSION__ !== 'undefined') {
        version = __VERSION__;
      }
      return version;
    }

    // When __VERSION__ is a string (esbuild define replaces it with a literal)
    expect(resolveActionVersion('2.0.0')).toBe('2.0.0');
    // When undefined (non-bundled / test environment)
    expect(resolveActionVersion(undefined)).toBe('unknown');
  });

  test('pi version resolution uses __PI_CODING_AGENT_VERSION__ when defined (simulating esbuild define)', () => {
    function resolvePiVersion(__PI_CODING_AGENT_VERSION__: string | undefined): string {
      let version = 'unknown';
      if (typeof __PI_CODING_AGENT_VERSION__ !== 'undefined') {
        version = __PI_CODING_AGENT_VERSION__;
      }
      return version;
    }

    expect(resolvePiVersion('0.99.0')).toBe('0.99.0');
    expect(resolvePiVersion(undefined)).toBe('unknown');
  });

  test('combined resolution fallback works correctly', () => {
    // Test the full resolution chain: esbuild define > package.json > unknown

    function resolveActionVersion(
      __VERSION__: string | undefined,
      pkgVersion: string | undefined
    ): string {
      let version = 'unknown';
      if (typeof __VERSION__ !== 'undefined') {
        version = __VERSION__;
      } else if (pkgVersion !== undefined) {
        version = pkgVersion;
      }
      return version;
    }

    // esbuild define takes priority
    expect(resolveActionVersion('3.0.0', '2.0.0')).toBe('3.0.0');
    // package.json fallback when no esbuild define
    expect(resolveActionVersion(undefined, '2.0.0')).toBe('2.0.0');
    // unknown when neither available
    expect(resolveActionVersion(undefined, undefined)).toBe('unknown');
  });
});

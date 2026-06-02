import { describe, expect, test } from 'bun:test';
import { getActionVersion, getPiVersion } from '../src/version';

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

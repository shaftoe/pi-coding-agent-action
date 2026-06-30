/**
 * Tests for the gist-provider resolver (`resolveGistProvider`, `resolveShareToken`).
 *
 * Verifies backend selection and token fallback without exercising the network.
 */

import { describe, expect, test } from 'bun:test';
import { resolveGistProvider, resolveShareToken } from '../../src/share/provider';
import { githubGistProvider } from '../../src/share/gist';
import { opengistGistProvider } from '../../src/share/opengist';

describe('resolveGistProvider', () => {
  test('defaults to the github provider when the field is unset', () => {
    expect(resolveGistProvider({}).name).toBe('github');
    expect(resolveGistProvider({})).toBe(githubGistProvider);
  });

  test('selects the github provider explicitly', () => {
    expect(resolveGistProvider({ shareGistProvider: 'github' })).toBe(githubGistProvider);
  });

  test('selects the opengist provider', () => {
    expect(resolveGistProvider({ shareGistProvider: 'opengist' })).toBe(opengistGistProvider);
  });

  test('falls back to github when the field is unset', () => {
    expect(resolveGistProvider({}).name).toBe('github');
  });
});

describe('resolveShareToken', () => {
  test('prefers shareGistToken over githubToken for the opengist provider', () => {
    expect(
      resolveShareToken({
        shareGistProvider: 'opengist',
        shareGistToken: 'og_123',
        githubToken: 'ghp_456',
      })
    ).toBe('og_123');
  });

  test('returns undefined for opengist when shareGistToken is unset (no github crossover)', () => {
    // A GitHub token can never authenticate against a self-hosted Opengist
    // instance, so falling back to githubToken would only produce a confusing
    // `401 Bad credentials`. Returning undefined yields the clear "no share
    // token configured" notice instead.
    expect(
      resolveShareToken({ shareGistProvider: 'opengist', githubToken: 'ghp_456' })
    ).toBeUndefined();
  });

  test('prefers githubToken over shareGistToken for the github provider', () => {
    expect(
      resolveShareToken({
        shareGistProvider: 'github',
        shareGistToken: 'og_123',
        githubToken: 'ghp_456',
      })
    ).toBe('ghp_456');
  });

  test('crosses over to shareGistToken for github when githubToken is unset', () => {
    expect(resolveShareToken({ shareGistProvider: 'github', shareGistToken: 'og_123' })).toBe(
      'og_123'
    );
  });

  test('defaults to the githubToken preference when the provider is unset', () => {
    expect(resolveShareToken({ githubToken: 'ghp_456' })).toBe('ghp_456');
  });

  test('returns undefined when neither token is set', () => {
    expect(resolveShareToken({})).toBeUndefined();
  });

  test('ignores an empty shareGistToken for opengist and returns undefined', () => {
    expect(
      resolveShareToken({
        shareGistProvider: 'opengist',
        shareGistToken: '',
        githubToken: 'ghp_456',
      })
    ).toBeUndefined();
  });

  test('ignores an empty githubToken and crosses over to shareGistToken for github', () => {
    expect(
      resolveShareToken({ shareGistProvider: 'github', githubToken: '', shareGistToken: 'og_123' })
    ).toBe('og_123');
  });
});

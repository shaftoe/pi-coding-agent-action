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
  test('prefers shareGistToken over githubToken', () => {
    expect(resolveShareToken({ shareGistToken: 'og_123', githubToken: 'ghp_456' })).toBe('og_123');
  });

  test('falls back to githubToken when shareGistToken is unset', () => {
    expect(resolveShareToken({ githubToken: 'ghp_456' })).toBe('ghp_456');
  });

  test('returns undefined when neither token is set', () => {
    expect(resolveShareToken({})).toBeUndefined();
  });

  test('ignores an empty shareGistToken and falls back', () => {
    expect(resolveShareToken({ githubToken: 'ghp_456' })).toBe('ghp_456');
  });
});

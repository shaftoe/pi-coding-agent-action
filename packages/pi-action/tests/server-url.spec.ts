/**
 * Tests for resolveServerUrl() — the action-side server URL resolution.
 *
 * Covers the precedence chain: `server_url` input → runner-advertised
 * (`GITHUB_SERVER_URL`) → default github.com. The function is pure, so these
 * tests exercise it directly without `@actions/core` / `@actions/github`.
 */

import { describe, expect, test } from 'bun:test';
import { resolveServerUrl, DEFAULT_SERVER_URL } from '../src/server-url';

describe('resolveServerUrl', () => {
  describe('input override (highest precedence)', () => {
    test('uses the action input when provided', () => {
      expect(resolveServerUrl('https://git.example.com', 'http://localhost:3000')).toBe(
        'https://git.example.com'
      );
    });

    test('input wins even when the runner URL is the default', () => {
      expect(resolveServerUrl('https://git.example.com', 'https://github.com')).toBe(
        'https://git.example.com'
      );
    });

    test('input wins even when context URL is undefined', () => {
      expect(resolveServerUrl('https://forgejo.example.com', undefined)).toBe(
        'https://forgejo.example.com'
      );
    });

    test('trims whitespace from the input', () => {
      expect(resolveServerUrl('  https://git.example.com  ', 'http://localhost:3000')).toBe(
        'https://git.example.com'
      );
    });
  });

  describe('fallback to runner-advertised URL', () => {
    test('uses the context URL when input is empty', () => {
      expect(resolveServerUrl('', 'https://github.example.internal')).toBe(
        'https://github.example.internal'
      );
    });

    test('uses the context URL when input is undefined', () => {
      expect(resolveServerUrl(undefined, 'https://codeberg.org')).toBe('https://codeberg.org');
    });

    test('uses the context URL when input is whitespace-only', () => {
      expect(resolveServerUrl('   ', 'https://forgejo.example.com')).toBe(
        'https://forgejo.example.com'
      );
    });
  });

  describe('default fallback', () => {
    test('falls back to github.com when both input and context are empty', () => {
      expect(resolveServerUrl('', undefined)).toBe(DEFAULT_SERVER_URL);
    });

    test('falls back to github.com when both input and context are whitespace/undefined', () => {
      expect(resolveServerUrl('  ', '')).toBe(DEFAULT_SERVER_URL);
    });

    test('default is the canonical GitHub URL', () => {
      expect(DEFAULT_SERVER_URL).toBe('https://github.com');
    });
  });

  describe('self-hosted Forgejo scenario (issue #339)', () => {
    // A Forgejo instance reachable from the host as http://localhost:3000 but
    // externally as https://git.example.com. The runner advertises the internal
    // URL; the user overrides it via the action input so links & platform
    // detection target the external host.
    test('override corrects an internal-only localhost URL', () => {
      expect(resolveServerUrl('https://git.example.com', 'http://localhost:3000')).toBe(
        'https://git.example.com'
      );
    });

    test('without override, the internal URL is passed through', () => {
      expect(resolveServerUrl('', 'http://localhost:3000')).toBe('http://localhost:3000');
    });
  });
});

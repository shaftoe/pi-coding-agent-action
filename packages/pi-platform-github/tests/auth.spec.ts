/**
 * @file Tests for {@link packages/pi-platform-github/src/auth.ts}.
 *
 * Canonical coverage for `resolveGitHubToken`, shared by `pi-cli` and the
 * `pi-action-bridge` extension (both re-export / consume it rather than each
 * keeping a copy).
 */
import { describe, it, expect } from 'vitest';
import { resolveGitHubToken } from '../src/auth.js';

describe('resolveGitHubToken', () => {
  it('prefers GITHUB_TOKEN over GH_TOKEN', () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: 'long-token', GH_TOKEN: 'short-token' })).toBe(
      'long-token'
    );
  });

  it('falls back to GH_TOKEN when GITHUB_TOKEN is absent', () => {
    expect(resolveGitHubToken({ GH_TOKEN: 'short-token' })).toBe('short-token');
  });

  it('treats a whitespace-only GITHUB_TOKEN as missing and falls back to GH_TOKEN', () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: '   ', GH_TOKEN: 'short-token' })).toBe(
      'short-token'
    );
  });

  it('returns the raw token value (does not mutate surrounding whitespace)', () => {
    // The guard checks non-emptiness after trim, but the value itself is
    // returned unmodified — no silent trimming.
    expect(resolveGitHubToken({ GITHUB_TOKEN: '  token-with-space  ' })).toBe(
      '  token-with-space  '
    );
  });

  it('throws naming both env vars when neither is set', () => {
    expect(() => resolveGitHubToken({})).toThrow(/Missing GitHub token/);
    expect(() => resolveGitHubToken({})).toThrow(/GITHUB_TOKEN.*GH_TOKEN|GH_TOKEN.*GITHUB_TOKEN/);
  });

  it('throws when only whitespace values are present', () => {
    expect(() => resolveGitHubToken({ GITHUB_TOKEN: '\t', GH_TOKEN: ' ' })).toThrow(
      /Missing GitHub token/
    );
  });
});

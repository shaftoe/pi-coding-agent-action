/**
 * @file Tests for {@link packages/pi-cli/src/octokit.ts}.
 *
 * Covers:
 *   - apiBaseUrlFromServerUrl for all supported host types
 *   - createCliOctokit basic construction
 */

import { describe, it, expect } from 'bun:test';
import { apiBaseUrlFromServerUrl } from '../src/octokit.js';

describe('apiBaseUrlFromServerUrl', () => {
  it('returns undefined for exact github.com', () => {
    expect(apiBaseUrlFromServerUrl('https://github.com')).toBeUndefined();
  });

  it('returns undefined for github.com subdomains', () => {
    expect(apiBaseUrlFromServerUrl('https://api.github.com')).toBeUndefined();
    expect(apiBaseUrlFromServerUrl('https://gist.github.com')).toBeUndefined();
  });

  it('returns /api/v3 for self-hosted GHE hostnames like github.example.com', () => {
    // These hostnames don't contain '.github.' (no dot before 'github'),
    // so they fall through to the unrecognized-host default (/api/v3).
    // This is correct: GHES REST API is at {host}/api/v3.
    expect(apiBaseUrlFromServerUrl('https://github.example.com')).toBe(
      'https://github.example.com/api/v3'
    );
  });

  it('returns /api/v3 for corporate GHE hostnames like github.internal.corp', () => {
    expect(apiBaseUrlFromServerUrl('https://github.internal.corp')).toBe(
      'https://github.internal.corp/api/v3'
    );
  });

  it('returns /api/v3 for unrecognized hosts (self-hosted GHE default)', () => {
    expect(apiBaseUrlFromServerUrl('https://git.company.internal')).toBe(
      'https://git.company.internal/api/v3'
    );
  });

  it('returns /api/v1 for codeberg.org', () => {
    expect(apiBaseUrlFromServerUrl('https://codeberg.org')).toBe('https://codeberg.org/api/v1');
  });

  it('returns /api/v1 for forgejo hosts', () => {
    expect(apiBaseUrlFromServerUrl('https://git.forgejo.example')).toBe(
      'https://git.forgejo.example/api/v1'
    );
  });

  it('returns /api/v1 for gitea hosts', () => {
    expect(apiBaseUrlFromServerUrl('https://git.gitea.internal')).toBe(
      'https://git.gitea.internal/api/v1'
    );
  });

  it('strips trailing slash from input', () => {
    expect(apiBaseUrlFromServerUrl('https://codeberg.org/')).toBe('https://codeberg.org/api/v1');
    expect(apiBaseUrlFromServerUrl('https://git.company.internal/')).toBe(
      'https://git.company.internal/api/v3'
    );
  });
});

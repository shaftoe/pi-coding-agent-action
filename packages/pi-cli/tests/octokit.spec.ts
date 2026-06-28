/**
 * @file Tests for {@link packages/pi-cli/src/octokit.ts}.
 *
 * Covers `createCliOctokit` construction — specifically that the conditional
 * `baseUrl` option is applied (or omitted) correctly per `apiBaseUrlFromServerUrl`.
 * `apiBaseUrlFromServerUrl` itself is tested in `pi-platform-github` (its home
 * since the co-location move); these tests cover only the CLI-side wiring.
 */

import { describe, it, expect } from 'bun:test';
import { createCliOctokit } from '../src/octokit.js';

describe('createCliOctokit', () => {
  it('uses Octokit default baseUrl for github.com (no baseUrl option set)', () => {
    const octokit = createCliOctokit('fake-token', 'https://github.com');
    // apiBaseUrlFromServerUrl returns undefined for github.com, so baseUrl is
    // not passed and Octokit falls back to its built-in api.github.com default.
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe('https://api.github.com');
  });

  it('sets baseUrl to /api/v1 for codeberg', () => {
    const octokit = createCliOctokit('fake-token', 'https://codeberg.org');
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe('https://codeberg.org/api/v1');
  });

  it('sets baseUrl to /api/v1 for forgejo', () => {
    const octokit = createCliOctokit('fake-token', 'https://git.forgejo.example');
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe('https://git.forgejo.example/api/v1');
  });

  it('sets baseUrl to /api/v3 for self-hosted GHE', () => {
    const octokit = createCliOctokit('fake-token', 'https://github.company.internal');
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe(
      'https://github.company.internal/api/v3'
    );
  });

  it('passes the token as auth', () => {
    const octokit = createCliOctokit('my-token', 'https://github.com');
    expect(octokit.auth).toBeTypeOf('function');
    // No network call: just confirm auth was wired (auth() returns the stored
    // token without making a request when only `type: 'token'` is used).
  });

  it('uses /api/v1 for a forgejo host with no hostname indicator when platformType=forgejo', () => {
    // forge.l3x.in has no forgejo/codeberg/gitea substring, so hostname
    // matching alone would return /api/v3. The explicit platform override
    // forces /api/v1 so API calls don't 404.
    const octokit = createCliOctokit('fake-token', 'https://forge.l3x.in', 'forgejo');
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe('https://forge.l3x.in/api/v1');
  });

  it('still uses hostname matching when platformType is omitted', () => {
    // Without the override, forge.l3x.in falls through to the /api/v3 default.
    const octokit = createCliOctokit('fake-token', 'https://forge.l3x.in');
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe('https://forge.l3x.in/api/v3');
  });
});

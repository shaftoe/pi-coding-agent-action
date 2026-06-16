/**
 * @file Tests for {@link packages/pi-action-bridge/src/detect.ts}.
 *
 * Pure-function tests — no git repo, no network. Covers SSH/HTTPS remote
 * normalization, `.git` stripping, port + userinfo handling, subpath
 * rejection, and delegation to `detectPlatform` (the co-located natural pair).
 */

import { describe, it, expect } from 'bun:test';
import { parseRemoteUrl, detectPlatformFromRemote } from '../src/detect.js';

describe('parseRemoteUrl', () => {
  it('parses an SSH github.com remote', () => {
    expect(parseRemoteUrl('git@github.com:shaftoe/pi-coding-agent-action.git')).toEqual({
      serverUrl: 'https://github.com',
      owner: 'shaftoe',
      repo: 'pi-coding-agent-action',
    });
  });

  it('parses an SSH remote without a trailing .git', () => {
    expect(parseRemoteUrl('git@github.com:shaftoe/repo')).toEqual({
      serverUrl: 'https://github.com',
      owner: 'shaftoe',
      repo: 'repo',
    });
  });

  it('parses an HTTPS github.com remote', () => {
    expect(parseRemoteUrl('https://github.com/shaftoe/pi-coding-agent-action.git')).toEqual({
      serverUrl: 'https://github.com',
      owner: 'shaftoe',
      repo: 'pi-coding-agent-action',
    });
  });

  it('parses an HTTPS remote with user:token userinfo (stripped)', () => {
    expect(parseRemoteUrl('https://x-access-token:ghp_secret@github.com/org/repo.git')).toEqual({
      serverUrl: 'https://github.com',
      owner: 'org',
      repo: 'repo',
    });
  });

  it('parses an HTTPS remote with a port (preserved in serverUrl)', () => {
    expect(parseRemoteUrl('https://git.company.internal:8443/team/repo.git')).toEqual({
      serverUrl: 'https://git.company.internal:8443',
      owner: 'team',
      repo: 'repo',
    });
  });

  it('parses a self-hosted Forgejo SSH remote', () => {
    expect(parseRemoteUrl('git@forge.company.internal:team/repo.git')).toEqual({
      serverUrl: 'https://forge.company.internal',
      owner: 'team',
      repo: 'repo',
    });
  });

  it('returns undefined for an empty string', () => {
    expect(parseRemoteUrl('')).toBeUndefined();
    expect(parseRemoteUrl('   ')).toBeUndefined();
  });

  it('returns undefined for a local filesystem path', () => {
    expect(parseRemoteUrl('/home/alex/repo.git')).toBeUndefined();
  });

  it('returns undefined for a git:// protocol remote', () => {
    expect(parseRemoteUrl('git://github.com/shaftoe/repo.git')).toBeUndefined();
  });

  it('returns undefined for a subpath-hosted remote (more than owner/repo)', () => {
    // We don't model nested paths — go inert rather than guess.
    expect(parseRemoteUrl('https://github.com/org/sub/repo.git')).toBeUndefined();
  });
});

describe('detectPlatformFromRemote', () => {
  it('returns github for github.com', () => {
    expect(detectPlatformFromRemote('git@github.com:shaftoe/repo.git')).toBe('github');
  });

  it('returns codeberg for codeberg.org', () => {
    expect(detectPlatformFromRemote('git@codeberg.org:user/repo.git')).toBe('codeberg');
  });

  it('returns forgejo for a forgejo host', () => {
    expect(detectPlatformFromRemote('https://git.forgejo.example/u/repo.git')).toBe('forgejo');
  });

  it('returns github (silent fallback) for an unknown self-hosted host', () => {
    // detectPlatform defaults unrecognized hosts to 'github' (GHE-compatible).
    expect(detectPlatformFromRemote('git@gh.internal.corp:u/repo.git')).toBe('github');
  });

  it('returns undefined for an unparseable remote', () => {
    expect(detectPlatformFromRemote('/local/path/repo.git')).toBeUndefined();
    expect(detectPlatformFromRemote('')).toBeUndefined();
  });
});

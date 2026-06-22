/**
 * @file Tests for {@link packages/pi-action-bridge/src/git.ts}.
 *
 * Covers the two helpers not exercised through the orchestration tests:
 *   - `shouldIsolateGitConfig` — the conditional git-config isolation policy
 *     (all decision branches, deterministically, via an injected `access` probe
 *     so the sandbox `EACCES` path doesn't depend on OS file perms / root).
 *   - `pickRemote` — `origin` preference + first-available fallback + empty.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldIsolateGitConfig, pickRemote } from '../src/git.js';
import type { RemoteWithRefs } from 'simple-git';

/** A probe that always reports the file as readable (no throw). */
const readable = (): void => undefined;

/** Build a probe that throws with the given errno `code`. */
const throws =
  (code: string): ((path: string) => void) =>
  () => {
    const err: NodeJS.ErrnoException = new Error(`probe: ${code}`);
    err.code = code;
    throw err;
  };

describe('shouldIsolateGitConfig', () => {
  it('does not isolate when ~/.gitconfig is readable (local TUI)', () => {
    expect(shouldIsolateGitConfig({ HOME: '/home/user' }, readable)).toBe(false);
  });

  it('isolates when ~/.gitconfig exists but is unreadable (sandbox EACCES)', () => {
    expect(shouldIsolateGitConfig({ HOME: '/home/user' }, throws('EACCES'))).toBe(true);
  });

  it('also isolates on EPERM ("Operation not permitted")', () => {
    expect(shouldIsolateGitConfig({ HOME: '/home/user' }, throws('EPERM'))).toBe(true);
  });

  it('does not isolate when ~/.gitconfig is simply absent (ENOENT)', () => {
    // A missing global gitconfig is benign — git tolerates it, so the system
    // config is not dropped unnecessarily.
    expect(shouldIsolateGitConfig({ HOME: '/home/user' }, throws('ENOENT'))).toBe(false);
  });

  it('respects an explicit GIT_CONFIG_GLOBAL already in the env', () => {
    // User/CI set their own — never override, regardless of readability.
    expect(
      shouldIsolateGitConfig({ HOME: '/home/user', GIT_CONFIG_GLOBAL: '/x' }, throws('EACCES'))
    ).toBe(false);
  });

  it('does not isolate when HOME is unset', () => {
    expect(shouldIsolateGitConfig({}, readable)).toBe(false);
  });

  // Real-filesystem integration: confirms the default probe resolves an actual
  // readable gitconfig / an absent one correctly (no injected access fn).
  describe('with the real default probe (default accessSync)', () => {
    let home: string;
    const savedHome = process.env.HOME;

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'bridge-git-'));
      process.env.HOME = home;
    });

    afterEach(() => {
      process.env.HOME = savedHome;
      rmSync(home, { recursive: true, force: true });
    });

    it('returns false when a readable ~/.gitconfig exists', () => {
      writeFileSync(join(home, '.gitconfig'), '[user]\n');
      expect(shouldIsolateGitConfig(process.env)).toBe(false);
    });

    it('returns false when ~/.gitconfig is absent', () => {
      expect(shouldIsolateGitConfig(process.env)).toBe(false);
    });
  });
});

describe('pickRemote', () => {
  function remote(name: string, url = `git@github.com:o/${name}.git`): RemoteWithRefs {
    return { name, refs: { fetch: url, push: url } };
  }

  it('prefers origin when present', () => {
    const remotes = [remote('upstream'), remote('origin'), remote('fork')];
    expect(pickRemote(remotes)?.name).toBe('origin');
  });

  it('prefers origin regardless of position', () => {
    const remotes = [remote('origin'), remote('upstream')];
    expect(pickRemote(remotes)?.name).toBe('origin');
  });

  it('falls back to the first remote when there is no origin', () => {
    const remotes = [remote('upstream'), remote('fork')];
    expect(pickRemote(remotes)?.name).toBe('upstream');
  });

  it('returns undefined when there are no remotes', () => {
    expect(pickRemote([])).toBeUndefined();
  });
});

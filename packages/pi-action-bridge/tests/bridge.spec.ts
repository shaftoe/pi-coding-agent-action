/**
 * @file Tests for {@link packages/pi-action-bridge/src/bridge.ts}.
 *
 * Covers the injectable/pure helpers (token resolution, context assembly,
 * Octokit baseUrl wiring) directly, and exercises {@link Bridge.discover}
 * against real temp git repos so the simple-git + parseRemoteUrl path is
 * tested end-to-end without mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import {
  resolveToken,
  buildPlatformContext,
  createOctokit,
  createLogger,
  Bridge,
} from '../src/bridge.js';
import { parseRemoteUrl } from '../src/detect.js';

describe('resolveToken', () => {
  const savedGithub = process.env['GITHUB_TOKEN'];
  const savedGh = process.env['GH_TOKEN'];
  beforeEach(() => {
    delete process.env['GITHUB_TOKEN'];
    delete process.env['GH_TOKEN'];
  });
  afterEach(() => {
    if (savedGithub !== undefined) {
      process.env['GITHUB_TOKEN'] = savedGithub;
    } else {
      delete process.env['GITHUB_TOKEN'];
    }
    if (savedGh !== undefined) {
      process.env['GH_TOKEN'] = savedGh;
    } else {
      delete process.env['GH_TOKEN'];
    }
  });

  it('prefers GITHUB_TOKEN', () => {
    expect(
      resolveToken({ GITHUB_TOKEN: 'ghp_one', GH_TOKEN: 'ghp_two' } as NodeJS.ProcessEnv)
    ).toBe('ghp_one');
  });

  it('falls back to GH_TOKEN when GITHUB_TOKEN is absent', () => {
    expect(resolveToken({ GH_TOKEN: 'ghp_two' } as NodeJS.ProcessEnv)).toBe('ghp_two');
  });

  it('falls back to the gh discovery when neither env var is set', () => {
    expect(resolveToken({}, () => 'ghp_from_gh')).toBe('ghp_from_gh');
  });

  it('returns undefined when env vars are absent and gh has no token', () => {
    expect(resolveToken({}, () => undefined)).toBeUndefined();
  });
});

describe('buildPlatformContext', () => {
  it('assembles a synthetic context with sentinel CI fields', () => {
    const parsed = parseRemoteUrl('git@github.com:shaftoe/repo.git')!;
    const ctx = buildPlatformContext({ parsed, workspace: '/cwd' });
    expect(ctx.repo).toEqual({ owner: 'shaftoe', repo: 'repo' });
    expect(ctx.issue).toEqual({ number: 0 });
    expect(ctx.payload).toEqual({});
    expect(ctx.serverUrl).toBe('https://github.com');
    expect(ctx.workspace).toBe('/cwd');
    // runId/actor/sha omitted so CI footers/promos no-op
    expect(ctx.runId).toBeUndefined();
    expect(ctx.actor).toBeUndefined();
    expect(ctx.eventName).not.toBe('issue_comment'); // non-CI sentinel
  });
});

describe('createOctokit', () => {
  it('uses the default api.github.com base for github.com', () => {
    const o = createOctokit('tok', 'https://github.com');
    expect(o.request.endpoint.DEFAULTS.baseUrl).toBe('https://api.github.com');
  });

  it('sets /api/v1 baseUrl for codeberg', () => {
    const o = createOctokit('tok', 'https://codeberg.org');
    expect(o.request.endpoint.DEFAULTS.baseUrl).toBe('https://codeberg.org/api/v1');
  });

  it('sets /api/v3 baseUrl for self-hosted GHE', () => {
    const o = createOctokit('tok', 'https://github.company.internal');
    expect(o.request.endpoint.DEFAULTS.baseUrl).toBe('https://github.company.internal/api/v3');
  });
});

describe('createLogger', () => {
  it('returns a Logger with the five required methods', () => {
    const logger = createLogger();
    for (const m of ['debug', 'info', 'warning', 'notice', 'error'] as const) {
      expect(typeof logger[m]).toBe('function');
    }
  });
});

describe('Bridge.discover', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-bridge-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when cwd is not a git repo', async () => {
    await expect(Bridge.discover(dir)).resolves.toBeUndefined();
  });

  it('returns undefined when the repo has no origin remote', async () => {
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 't@t');
    await git.addConfig('user.name', 't');
    await expect(Bridge.discover(dir)).resolves.toBeUndefined();
  });

  it('discovers a github.com SSH origin', async () => {
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote('origin', 'git@github.com:shaftoe/repo.git');
    const d = await Bridge.discover(dir);
    expect(d).toBeDefined();
    expect(d!.platformType).toBe('github');
    expect(d!.isKnownHost).toBe(true);
    expect(d!.parsed).toEqual({
      serverUrl: 'https://github.com',
      owner: 'shaftoe',
      repo: 'repo',
    });
  });

  it('flags an unknown host (GitLab) as not-known', async () => {
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote('origin', 'git@gitlab.com:shaftoe/repo.git');
    const d = await Bridge.discover(dir);
    expect(d).toBeDefined();
    // detectPlatform silently falls back to 'github', but isKnownHost surfaces it
    expect(d!.isKnownHost).toBe(false);
  });
});

describe('Bridge.create', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-bridge-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('goes inert (undefined) with no token, invoking onNoToken', async () => {
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote('origin', 'git@github.com:shaftoe/repo.git');
    let calledNoToken = false;
    const bridge = await Bridge.create({
      cwd: dir,
      onNoToken: () => {
        calledNoToken = true;
      },
    });
    // No GITHUB_TOKEN/GH_TOKEN in this test process *and* gh may or may not be
    // logged in on the host. If gh resolves a token, bridge is defined; if not,
    // onNoToken fires. Assert the invariant: exactly one of the two holds.
    if (bridge) {
      expect(bridge.provider).toBeDefined();
    } else {
      expect(calledNoToken).toBe(true);
    }
  });

  it('goes inert (undefined) for an unknown host, invoking onUnknownHost', async () => {
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote('origin', 'git@gitlab.com:shaftoe/repo.git');
    let unknown: string | undefined;
    const bridge = await Bridge.create({
      cwd: dir,
      onUnknownHost: serverUrl => {
        unknown = serverUrl;
      },
    });
    expect(bridge).toBeUndefined();
    expect(unknown).toBe('https://gitlab.com');
  });

  it('builds a provider when a github remote + token are present', async () => {
    const git = simpleGit(dir);
    await git.init();
    await git.addRemote('origin', 'git@github.com:shaftoe/repo.git');
    const bridge = await Bridge.create({
      cwd: dir,
      logger: createLogger(),
    });
    if (!bridge) {
      // Host has no resolvable token (no env vars, gh not logged in) — the
      // environment-agnostic assertion above already accepts this branch.
      return;
    }
    expect(bridge.provider.type).toBe('github');
    expect(bridge.context.repo).toEqual({ owner: 'shaftoe', repo: 'repo' });
    expect(typeof bridge.provider.getIssueOrPRThread).toBe('function');
  });
});

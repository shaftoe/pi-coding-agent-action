/**
 * @file Tests for the fork-management helpers in `git/fork.ts`.
 *
 * Covers the pure remote-URL derivation (`buildForkRemoteUrl`), the
 * get-or-create fork logic (`ensureFork`), authenticated-user resolution,
 * the fork readiness wait, and the workspace-origin-based URL resolution.
 *
 * The PR-level integration (push + PR creation from the fork) lives in
 * `tests/pull-request-fork.spec.ts`.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  buildForkRemoteUrl,
  canPushToRepository,
  ensureFork,
  getAuthenticatedLogin,
  resolveForkRemoteUrl,
  waitForForkReady,
} from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';
import { setupForkGitRepo, cleanupGitRepo, isolateGitConfig } from '../helpers/git-repo';

// Isolate git ops from the host's global/system git config (see isolateGitConfig).
isolateGitConfig();

const noop = (): void => {};

/** Build minimal deps with an octokit mock. */
function createDeps(octokit: unknown): GitHubModuleDeps {
  return {
    octokit: octokit as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'issue_comment',
      payload: { repository: { default_branch: 'main' } },
      serverUrl: 'https://github.com',
      runId: 1,
      workspace: '/tmp',
    },
    logger: {
      debug: noop,
      info: noop,
      warning: noop,
      notice: noop,
      error: noop,
    },
  } as GitHubModuleDeps;
}

/** Octokit-style error with a status code. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

// ---------------------------------------------------------------------------
// buildForkRemoteUrl
// ---------------------------------------------------------------------------

describe('buildForkRemoteUrl', () => {
  const fork = { owner: 'pi-bot', repo: 'test-repo' };

  test('rewrites the owner/repo segments of an HTTPS URL', () => {
    expect(buildForkRemoteUrl('https://github.com/test-owner/test-repo', fork)).toBe(
      'https://github.com/pi-bot/test-repo'
    );
  });

  test('preserves a trailing .git suffix', () => {
    expect(buildForkRemoteUrl('https://github.com/test-owner/test-repo.git', fork)).toBe(
      'https://github.com/pi-bot/test-repo.git'
    );
  });

  test('preserves embedded credentials', () => {
    expect(
      buildForkRemoteUrl(
        'https://x-access-token:ghp_secret@github.com/test-owner/test-repo.git',
        fork
      )
    ).toBe('https://x-access-token:ghp_secret@github.com/pi-bot/test-repo.git');
  });

  test('rewrites SCP-like SSH URLs', () => {
    expect(buildForkRemoteUrl('git@github.com:test-owner/test-repo.git', fork)).toBe(
      'git@github.com:pi-bot/test-repo.git'
    );
  });

  test('rewrites ssh:// URLs', () => {
    expect(buildForkRemoteUrl('ssh://git@github.com/test-owner/test-repo.git', fork)).toBe(
      'ssh://git@github.com/pi-bot/test-repo.git'
    );
  });

  test('preserves host ports (not confused with the path separator)', () => {
    expect(
      buildForkRemoteUrl('https://forge.example.com:3000/test-owner/test-repo.git', fork)
    ).toBe('https://forge.example.com:3000/pi-bot/test-repo.git');
  });

  test('preserves URL-prefix paths (Forgejo under a subpath)', () => {
    expect(buildForkRemoteUrl('https://forge.example.com/git/test-owner/test-repo.git', fork)).toBe(
      'https://forge.example.com/git/pi-bot/test-repo.git'
    );
  });

  test('uses the fork repo name when it differs from the parent', () => {
    expect(
      buildForkRemoteUrl('https://github.com/test-owner/test-repo.git', {
        owner: 'pi-bot',
        repo: 'test-repo-1',
      })
    ).toBe('https://github.com/pi-bot/test-repo-1.git');
  });

  test('rewrites local filesystem paths (two trailing segments)', () => {
    expect(buildForkRemoteUrl('/tmp/remotes/test-owner/test-repo.git', fork)).toBe(
      '/tmp/remotes/pi-bot/test-repo.git'
    );
  });

  test('falls back to a server URL when the origin has no owner/repo segments', () => {
    expect(buildForkRemoteUrl('foobar', fork, 'https://github.com')).toBe(
      'https://github.com/pi-bot/test-repo.git'
    );
  });

  test('falls back to github.com when no server URL is given', () => {
    expect(buildForkRemoteUrl('weird-remote', fork)).toBe(
      'https://github.com/pi-bot/test-repo.git'
    );
  });

  test('strips a trailing slash from the fallback server URL', () => {
    expect(buildForkRemoteUrl('weird-remote', fork, 'https://forge.example.com/')).toBe(
      'https://forge.example.com/pi-bot/test-repo.git'
    );
  });

  test('trims surrounding whitespace from the origin URL', () => {
    expect(buildForkRemoteUrl('  https://github.com/test-owner/test-repo.git  ', fork)).toBe(
      'https://github.com/pi-bot/test-repo.git'
    );
  });
});

// ---------------------------------------------------------------------------
// getAuthenticatedLogin
// ---------------------------------------------------------------------------

describe('getAuthenticatedLogin', () => {
  test('returns the login of the token user', async () => {
    const getAuthenticated = vi.fn(() => Promise.resolve({ data: { login: 'octocat' } }));
    const login = await getAuthenticatedLogin(
      createDeps({ rest: { users: { getAuthenticated } } })
    );
    expect(login).toBe('octocat');
    expect(getAuthenticated).toHaveBeenCalled();
  });

  test('wraps API failures with an actionable message', async () => {
    const getAuthenticated = vi.fn(() => Promise.reject(httpError(401, 'Bad credentials')));
    await expect(
      getAuthenticatedLogin(createDeps({ rest: { users: { getAuthenticated } } }))
    ).rejects.toThrow(/Failed to resolve the authenticated user.*personal access token/s);
  });

  test('fails when the response has no login', async () => {
    const getAuthenticated = vi.fn(() => Promise.resolve({ data: {} }));
    await expect(
      getAuthenticatedLogin(createDeps({ rest: { users: { getAuthenticated } } }))
    ).rejects.toThrow(/did not include a login/);
  });

  test('handles rejections that are not Error instances', async () => {
    // Non-Error throwables (plain objects without a numeric status, strings)
    // must still produce the actionable message instead of crashing.
    const getAuthenticated = vi.fn(() => Promise.reject({ status: 'nope' }));
    await expect(
      getAuthenticatedLogin(createDeps({ rest: { users: { getAuthenticated } } }))
    ).rejects.toThrow(/Failed to resolve the authenticated user.*HTTP unknown/s);
  });
});

// ---------------------------------------------------------------------------
// ensureFork
// ---------------------------------------------------------------------------

describe('ensureFork', () => {
  test('reuses an existing fork of the target repository', async () => {
    const reposGet = vi.fn(() =>
      Promise.resolve({
        data: {
          name: 'test-repo',
          fork: true,
          parent: { full_name: 'test-owner/test-repo' },
        },
      })
    );
    const createFork = vi.fn();
    const deps = createDeps({ rest: { repos: { get: reposGet, createFork } } });

    const fork = await ensureFork(deps, 'pi-bot');

    expect(fork).toEqual({ owner: 'pi-bot', repo: 'test-repo', created: false });
    expect(reposGet).toHaveBeenCalledWith({ owner: 'pi-bot', repo: 'test-repo' });
    expect(createFork).not.toHaveBeenCalled();
  });

  test('creates the fork when none exists (404)', async () => {
    const reposGet = vi.fn(() => Promise.reject(httpError(404, 'Not Found')));
    const createFork = vi.fn(() => Promise.resolve({ data: { name: 'test-repo' } }));
    const deps = createDeps({ rest: { repos: { get: reposGet, createFork } } });

    const fork = await ensureFork(deps, 'pi-bot');

    expect(fork).toEqual({ owner: 'pi-bot', repo: 'test-repo', created: true });
    expect(createFork).toHaveBeenCalledWith({ owner: 'test-owner', repo: 'test-repo' });
  });

  test('uses the platform-provided fork name (Forgejo name collisions)', async () => {
    const reposGet = vi.fn(() => Promise.reject(httpError(404, 'Not Found')));
    const createFork = vi.fn(() => Promise.resolve({ data: { name: 'test-repo-1' } }));
    const deps = createDeps({ rest: { repos: { get: reposGet, createFork } } });

    const fork = await ensureFork(deps, 'pi-bot');

    expect(fork).toEqual({ owner: 'pi-bot', repo: 'test-repo-1', created: true });
  });

  test('falls back to the target repo name when the create response has none', async () => {
    const reposGet = vi.fn(() => Promise.reject(httpError(404, 'Not Found')));
    const createFork = vi.fn(() => Promise.resolve({ status: 202, data: {} }));
    const deps = createDeps({ rest: { repos: { get: reposGet, createFork } } });

    const fork = await ensureFork(deps, 'pi-bot');

    expect(fork).toEqual({ owner: 'pi-bot', repo: 'test-repo', created: true });
  });

  test('falls through to createFork when a same-named non-fork repo exists', async () => {
    // A repo named test-repo exists under pi-bot's account, but it is not a
    // fork of the target. The platform's create-fork endpoint decides what
    // happens (GitHub: 422; Forgejo: suffixed fork).
    const reposGet = vi.fn(() =>
      Promise.resolve({
        data: { name: 'test-repo', fork: false, parent: null },
      })
    );
    const createFork = vi.fn(() => Promise.resolve({ data: { name: 'test-repo-1' } }));
    const deps = createDeps({ rest: { repos: { get: reposGet, createFork } } });

    const fork = await ensureFork(deps, 'pi-bot');

    expect(fork).toEqual({ owner: 'pi-bot', repo: 'test-repo-1', created: true });
    expect(createFork).toHaveBeenCalled();
  });

  test('does not reuse an existing fork of a different repository', async () => {
    const reposGet = vi.fn(() =>
      Promise.resolve({
        data: { name: 'test-repo', fork: true, parent: { full_name: 'other/other-repo' } },
      })
    );
    const createFork = vi.fn(() => Promise.resolve({ data: { name: 'test-repo' } }));
    const deps = createDeps({ rest: { repos: { get: reposGet, createFork } } });

    const fork = await ensureFork(deps, 'pi-bot');
    expect(fork.created).toBe(true);
    expect(createFork).toHaveBeenCalled();
  });

  test('propagates fork-existence check failures (non-404)', async () => {
    const reposGet = vi.fn(() => Promise.reject(httpError(403, 'Forbidden')));
    const deps = createDeps({ rest: { repos: { get: reposGet } } });

    await expect(ensureFork(deps, 'pi-bot')).rejects.toThrow(
      /Failed to check for an existing fork at "pi-bot\/test-repo".*Forbidden/s
    );
  });

  test('wraps fork-creation failures with an actionable PAT hint', async () => {
    const reposGet = vi.fn(() => Promise.reject(httpError(404, 'Not Found')));
    const createFork = vi.fn(() =>
      Promise.reject(httpError(403, 'Resource not accessible by integration'))
    );
    const deps = createDeps({ rest: { repos: { get: reposGet, createFork } } });

    await expect(ensureFork(deps, 'pi-bot')).rejects.toThrow(
      /Failed to create a fork of "test-owner\/test-repo" for "pi-bot".*personal access token.*GITHUB_TOKEN/s
    );
  });
});

// ---------------------------------------------------------------------------
// canPushToRepository
// ---------------------------------------------------------------------------

describe('canPushToRepository', () => {
  test('returns false when the permission lookup fails', async () => {
    // Older Forgejo/Gitea instances, scope gaps, network errors — the
    // conservative answer is "assume no push access; use the fork flow".
    const reposGet = vi.fn(() => Promise.reject(httpError(403, 'Forbidden')));
    const deps = createDeps({ rest: { repos: { get: reposGet } } });

    await expect(canPushToRepository(deps)).resolves.toBe(false);
  });
});

// ---------------------------------------------------------------------------
// waitForForkReady
// ---------------------------------------------------------------------------

describe('waitForForkReady', () => {
  const fork = { owner: 'pi-bot', repo: 'test-repo', created: true };

  function depsWith(getBranch: ReturnType<typeof vi.fn>): GitHubModuleDeps {
    return createDeps({ rest: { repos: { getBranch } } });
  }

  test('returns true immediately when the default branch is visible', async () => {
    const getBranch = vi.fn(() => Promise.resolve({ data: { name: 'main' } }));
    const sleep = vi.fn(() => Promise.resolve());

    const ready = await waitForForkReady(depsWith(getBranch), fork, 'main', { sleep });

    expect(ready).toBe(true);
    expect(getBranch).toHaveBeenCalledWith({
      owner: 'pi-bot',
      repo: 'test-repo',
      branch: 'main',
    });
    expect(sleep).not.toHaveBeenCalled();
  });

  test('retries while the branch is not yet visible (404)', async () => {
    const getBranch = vi
      .fn()
      .mockRejectedValueOnce(httpError(404, 'Not Found'))
      .mockResolvedValueOnce({ data: { name: 'main' } });
    const sleep = vi.fn(() => Promise.resolve());

    const ready = await waitForForkReady(depsWith(getBranch), fork, 'main', {
      sleep,
      attempts: 3,
      delayMs: 10,
    });

    expect(ready).toBe(true);
    expect(getBranch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(10);
  });

  test('gives up after the attempt budget and returns false', async () => {
    const getBranch = vi.fn(() => Promise.reject(httpError(404, 'Not Found')));
    const sleep = vi.fn(() => Promise.resolve());

    const ready = await waitForForkReady(depsWith(getBranch), fork, 'main', {
      sleep,
      attempts: 3,
      delayMs: 1,
    });

    expect(ready).toBe(false);
    expect(getBranch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // no sleep after the final attempt
  });

  test('works without options (default budget, default sleep)', async () => {
    // The default sleep is created but never awaited when the branch is
    // visible on the first attempt — exercises the non-injected code path.
    const getBranch = vi.fn(() => Promise.resolve({ data: { name: 'main' } }));

    const ready = await waitForForkReady(depsWith(getBranch), fork, 'main');

    expect(ready).toBe(true);
  });

  test('uses the default sleep when options omit it', async () => {
    const getBranch = vi.fn(() => Promise.resolve({ data: { name: 'main' } }));

    const ready = await waitForForkReady(depsWith(getBranch), fork, 'main', { attempts: 2 });

    expect(ready).toBe(true);
    expect(getBranch).toHaveBeenCalledTimes(1);
  });

  test('stops retrying on non-404 errors and returns false', async () => {
    const getBranch = vi.fn(() => Promise.reject(httpError(403, 'Forbidden')));
    const sleep = vi.fn(() => Promise.resolve());

    const ready = await waitForForkReady(depsWith(getBranch), fork, 'main', {
      sleep,
      attempts: 5,
      delayMs: 1,
    });

    expect(ready).toBe(false);
    expect(getBranch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveForkRemoteUrl
// ---------------------------------------------------------------------------

describe('resolveForkRemoteUrl', () => {
  let repo: ReturnType<typeof setupForkGitRepo>;

  beforeEach(() => {
    repo = setupForkGitRepo({
      upstreamOwner: 'test-owner',
      upstreamRepo: 'test-repo',
      forkOwner: 'pi-bot',
      forkRepo: 'test-repo',
    });
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test('derives the fork URL from the origin remote URL', async () => {
    if (!repo) {
      return;
    }
    const url = await resolveForkRemoteUrl(
      repo.workspace,
      { owner: 'pi-bot', repo: 'test-repo' },
      'https://github.com'
    );
    expect(url).toBe(repo.forkDir);
  });

  test('falls back to the server URL when no origin remote exists', async () => {
    if (!repo) {
      return;
    }
    // A plain git repo without any remote configured.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-fork-noremote-'));
    try {
      execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
      const url = await resolveForkRemoteUrl(
        tmpDir,
        { owner: 'pi-bot', repo: 'test-repo' },
        'https://forge.example.com'
      );
      expect(url).toBe('https://forge.example.com/pi-bot/test-repo.git');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

/**
 * @file Integration tests for fork-based pull request flows.
 *
 * Covers the `create_pull_request` / `update_pull_request` paths where the
 * token cannot push to the target repository and the agent's own fork is
 * used instead: fork get-or-create, the readiness wait for freshly created
 * forks, pushing the branch to the fork remote (`pi-fork`), cross-repository
 * PR heads (`forkOwner:branch`), and the compare-URL fallback.
 *
 * Fork-helper unit tests live in `tests/git/fork.spec.ts`; the git plumbing
 * (remote option, push failure) in `tests/git/git-cli.spec.ts`.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { createPullRequest, updatePullRequest } from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';
import { setupForkGitRepo, cleanupGitRepo, isolateGitConfig } from './helpers/git-repo';

// Isolate git ops from the host's global/system config (see isolateGitConfig).
isolateGitConfig();

/** Octokit-style error with a status code. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

const noop = (): void => {};

/** Mock responses for the fork flow: sam cannot push to alex/ansible. */
interface ForkFlowMocks {
  getAuthenticated: ReturnType<typeof vi.fn>;
  reposGet: ReturnType<typeof vi.fn>;
  createFork: ReturnType<typeof vi.fn>;
  getBranch: ReturnType<typeof vi.fn>;
  pullsCreate: ReturnType<typeof vi.fn>;
}

function forkFlowMocks(): ForkFlowMocks {
  const mocks: ForkFlowMocks = {
    // Permission lookup for the target repository (alex): no push access.
    // The fork-existence check (sam) is configured per-test.
    getAuthenticated: vi.fn(() => Promise.resolve({ data: { login: 'sam' } })),
    reposGet: vi.fn(({ owner }: { owner: string }) =>
      owner === 'sam'
        ? Promise.reject(httpError(404, 'Not Found'))
        : Promise.resolve({
            data: {
              default_branch: 'master',
              permissions: {
                admin: false,
                maintain: false,
                push: false,
                pull: true,
                triage: false,
              },
            },
          })
    ),
    createFork: vi.fn(() => Promise.resolve({ status: 202, data: { name: 'ansible' } })),
    getBranch: vi.fn(() => Promise.resolve({ data: { commit: { sha: 'fork-sha' } } })),
    pullsCreate: vi.fn(() =>
      Promise.resolve({
        data: {
          number: 77,
          html_url: 'https://github.com/alex/ansible/pull/77',
          head: { ref: 'pi/issue18-1234567890' },
          base: { ref: 'master' },
        },
      })
    ),
  };
  return mocks;
}

function createForkDeps(workspace: string, mocks: ForkFlowMocks): GitHubModuleDeps {
  return {
    octokit: {
      rest: {
        users: { getAuthenticated: mocks.getAuthenticated },
        pulls: { create: mocks.pullsCreate },
        repos: {
          get: mocks.reposGet,
          createFork: mocks.createFork,
          getBranch: mocks.getBranch,
        },
      },
    } as any,
    context: {
      repo: { owner: 'alex', repo: 'ansible' },
      issue: { number: 18 },
      eventName: 'issue_comment',
      payload: { repository: { default_branch: 'master' } },
      serverUrl: 'https://github.com',
      runId: 1,
      runNumber: 1,
      workspace,
    },
    logger: {
      debug: noop,
      info: noop,
      warning: noop,
      notice: noop,
      error: noop,
    },
  } as unknown as GitHubModuleDeps;
}

describe('createPullRequest — fork-based flow', () => {
  let repo: ReturnType<typeof setupForkGitRepo>;
  let mocks: ForkFlowMocks;

  beforeEach(() => {
    repo = setupForkGitRepo({
      upstreamOwner: 'alex',
      upstreamRepo: 'ansible',
      forkOwner: 'sam',
      forkRepo: 'ansible',
    });
    if (repo) {
      fs.writeFileSync(path.join(repo.workspace, 'new-file.txt'), 'hello world');
    }
    mocks = forkFlowMocks();
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test('creates the fork, pushes the branch to it, and opens a fork-based PR', async () => {
    if (!repo) {
      return;
    }
    const deps = createForkDeps(repo.workspace, mocks);
    const result = await createPullRequest(deps, { title: 'Fix bug' });

    // The fork was created via the API
    expect(mocks.createFork).toHaveBeenCalledWith({ owner: 'alex', repo: 'ansible' });

    // Readiness wait ran for the freshly created fork
    expect(mocks.getBranch).toHaveBeenCalledWith({
      owner: 'sam',
      repo: 'ansible',
      branch: 'master',
    });

    // PR opened with the cross-repository "fork:branch" head
    expect(mocks.pullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'alex',
        repo: 'ansible',
        base: 'master',
        head: expect.stringMatching(/^sam:pi\/issue18-/),
      })
    );

    // Details record the fork so consumers can tell fork-based PRs apart
    expect(result.details.prCreated).toBe(true);
    expect(result.details.forkOwner).toBe('sam');
    expect(result.details.forkRepo).toBe('ansible');

    // The branch landed on the fork remote, not on origin
    const forkBranches = execSync('git branch', {
      cwd: repo.forkDir,
      encoding: 'utf-8',
    });
    expect(forkBranches).toContain('pi/issue18-');
    const upstreamBranches = execSync('git branch', {
      cwd: repo.upstreamDir,
      encoding: 'utf-8',
    });
    expect(upstreamBranches).not.toContain('pi/issue18-');
  });

  test('reuses an existing fork and skips the readiness wait', async () => {
    if (!repo) {
      return;
    }
    // sam/ansible already exists and is a fork of the target repository.
    mocks.reposGet.mockImplementation(({ owner }: { owner: string }) =>
      owner === 'sam'
        ? Promise.resolve({
            data: { name: 'ansible', fork: true, parent: { full_name: 'alex/ansible' } },
          })
        : Promise.resolve({
            data: {
              default_branch: 'master',
              permissions: { push: false, pull: true },
            },
          })
    );

    const deps = createForkDeps(repo.workspace, mocks);
    const result = await createPullRequest(deps, { title: 'Fix bug' });

    // No fork creation, no readiness polling for a reused fork
    expect(mocks.createFork).not.toHaveBeenCalled();
    expect(mocks.getBranch).not.toHaveBeenCalled();

    // PR still opened from the fork
    expect(mocks.pullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ head: expect.stringMatching(/^sam:pi\/issue18-/) })
    );
    expect(result.details.prCreated).toBe(true);
    expect(result.details.forkOwner).toBe('sam');
  });

  test('warns and pushes anyway when the fork is not ready', async () => {
    if (!repo) {
      return;
    }
    // A freshly created fork may not report its default branch in time.
    // A non-404 readiness error aborts the wait immediately (bounded
    // best-effort), and the flow proceeds to push regardless.
    mocks.getBranch.mockRejectedValue(httpError(403, 'Forbidden'));

    const deps = createForkDeps(repo.workspace, mocks);
    const result = await createPullRequest(deps, { title: 'Fix bug' });

    // The readiness check ran exactly once (no retry loop on non-404s)…
    expect(mocks.getBranch).toHaveBeenCalledTimes(1);

    // …but the push and PR creation were still attempted.
    expect(mocks.pullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ head: expect.stringMatching(/^sam:pi\/issue18-/) })
    );
    expect(result.details.prCreated).toBe(true);
    const forkBranches = execSync('git branch', {
      cwd: repo.forkDir,
      encoding: 'utf-8',
    });
    expect(forkBranches).toContain('pi/issue18-');
  });

  test('falls back to a fork compare URL when pulls.create lacks permission', async () => {
    if (!repo) {
      return;
    }
    // Reuse an existing fork so only the PR-creation step fails.
    mocks.reposGet.mockImplementation(({ owner }: { owner: string }) =>
      owner === 'sam'
        ? Promise.resolve({
            data: { name: 'ansible', fork: true, parent: { full_name: 'alex/ansible' } },
          })
        : Promise.resolve({
            data: {
              default_branch: 'master',
              permissions: { push: false, pull: true },
            },
          })
    );
    mocks.pullsCreate.mockRejectedValue(httpError(403, 'Resource not accessible by integration'));

    const deps = createForkDeps(repo.workspace, mocks);
    const result = await createPullRequest(deps, { title: 'Fix bug' });

    expect(result.details.prCreated).toBe(false);
    expect(result.details.forkOwner).toBe('sam');
    expect(result.details.forkRepo).toBe('ansible');

    // The compare URL uses the cross-repository "fork:branch" head form
    expect(result.details.compareUrl).toContain(
      'https://github.com/alex/ansible/compare/master...sam:pi/issue18-'
    );
    expect(result.content[0]!.text).toContain(result.details.compareUrl!);

    // The branch was still pushed to the fork
    const forkBranches = execSync('git branch', {
      cwd: repo.forkDir,
      encoding: 'utf-8',
    });
    expect(forkBranches).toContain('pi/issue18-');
  });
});

describe('updatePullRequest — fork-based PR', () => {
  let repo: ReturnType<typeof setupForkGitRepo>;

  beforeEach(() => {
    repo = setupForkGitRepo({
      upstreamOwner: 'alex',
      upstreamRepo: 'ansible',
      forkOwner: 'sam',
      forkRepo: 'ansible',
    });
    if (repo) {
      // The PR's head branch lives in the fork: publish it there.
      execSync(`git push ${repo.forkDir} main:refs/heads/feature-branch`, {
        cwd: repo.workspace,
        stdio: 'pipe',
      });
    }
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test('pushes follow-up commits to the fork remote', async () => {
    if (!repo) {
      return;
    }
    const pullsUpdate = vi.fn(() =>
      Promise.resolve({
        data: { number: 77, html_url: 'https://github.com/alex/ansible/pull/77' },
      })
    );
    const deps = {
      octokit: {
        rest: {
          pulls: {
            // The PR head repository is the fork (sam/ansible), not the
            // target repository (alex/ansible) the action runs on.
            get: vi.fn(() =>
              Promise.resolve({
                status: 200,
                data: {
                  number: 77,
                  html_url: 'https://github.com/alex/ansible/pull/77',
                  head: {
                    ref: 'feature-branch',
                    sha: 'head-sha-123',
                    repo: { owner: { login: 'sam' }, name: 'ansible' },
                  },
                  base: { ref: 'master' },
                },
              })
            ),
            update: pullsUpdate,
          },
        },
      } as any,
      context: {
        repo: { owner: 'alex', repo: 'ansible' },
        issue: { number: 18 },
        eventName: 'issue_comment',
        payload: {},
        serverUrl: 'https://github.com',
        runId: 1,
        runNumber: 1,
        workspace: repo.workspace,
      },
      logger: {
        debug: noop,
        info: noop,
        warning: noop,
        notice: noop,
        error: noop,
      },
    } as unknown as GitHubModuleDeps;

    fs.writeFileSync(path.join(repo.workspace, 'follow-up.txt'), 'follow up');

    const result = await updatePullRequest(deps, {
      pull_number: 77,
      message: 'Add follow-up',
    });

    // A new commit was created and reported
    expect(result.details.commitSha).toMatch(/^[0-9a-f]{7,40}$/);
    expect(result.details.headBranch).toBe('feature-branch');

    // The follow-up landed on the fork's head branch, not on origin
    const forkLog = execSync('git log --oneline feature-branch', {
      cwd: repo.forkDir,
      encoding: 'utf-8',
    });
    expect(forkLog).toContain('Add follow-up');
    const upstreamLog = execSync('git log --oneline --all', {
      cwd: repo.upstreamDir,
      encoding: 'utf-8',
    });
    expect(upstreamLog).not.toContain('Add follow-up');

    // No title/body given — metadata untouched
    expect(pullsUpdate).not.toHaveBeenCalled();
  });

  test('pushes to a same-owner fork whose repo name differs', async () => {
    if (!repo) {
      return;
    }
    // Edge case: the head repository belongs to the context owner but has a
    // different name (e.g. a renamed fork). The branch still lives outside
    // the context repository, so updates must go to the fork remote.
    const forkRepo = setupForkGitRepo({
      upstreamOwner: 'alex',
      upstreamRepo: 'ansible',
      forkOwner: 'alex',
      forkRepo: 'ansible-fork',
    });
    if (!forkRepo) {
      return;
    }
    try {
      execSync(`git push ${forkRepo.forkDir} main:refs/heads/feature-branch`, {
        cwd: forkRepo.workspace,
        stdio: 'pipe',
      });

      const deps = {
        octokit: {
          rest: {
            pulls: {
              get: vi.fn(() =>
                Promise.resolve({
                  status: 200,
                  data: {
                    number: 78,
                    html_url: 'https://github.com/alex/ansible/pull/78',
                    head: {
                      ref: 'feature-branch',
                      sha: 'head-sha-456',
                      repo: { owner: { login: 'alex' }, name: 'ansible-fork' },
                    },
                    base: { ref: 'master' },
                  },
                })
              ),
              update: vi.fn(),
            },
          },
        } as any,
        context: {
          repo: { owner: 'alex', repo: 'ansible' },
          issue: { number: 18 },
          eventName: 'issue_comment',
          payload: {},
          serverUrl: 'https://github.com',
          runId: 1,
          runNumber: 1,
          workspace: forkRepo.workspace,
        },
        logger: {
          debug: noop,
          info: noop,
          warning: noop,
          notice: noop,
          error: noop,
        },
      } as unknown as GitHubModuleDeps;

      fs.writeFileSync(path.join(forkRepo.workspace, 'follow-up.txt'), 'follow up');

      const result = await updatePullRequest(deps, { pull_number: 78, message: 'Edge update' });

      expect(result.details.commitSha).toMatch(/^[0-9a-f]{7,40}$/);
      const forkLog = execSync('git log --oneline feature-branch', {
        cwd: forkRepo.forkDir,
        encoding: 'utf-8',
      });
      expect(forkLog).toContain('Edge update');
    } finally {
      cleanupGitRepo(forkRepo.workspace);
    }
  });
});

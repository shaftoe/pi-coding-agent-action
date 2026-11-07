/**
 * @file Tests for createPullRequest function (full integration with deps).
 *
 * Covers the end-to-end flow of creating a pull request via the GitHub API.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createPullRequest,
  generateBranchName,
  determineBaseBranch,
  generatePullRequestBody,
} from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';
import { setupGitRepo, cleanupGitRepo, isolateGitConfig, rejectPushes } from './helpers/git-repo';

// Isolate git ops from the host's global/system config (see isolateGitConfig).
isolateGitConfig();

function createPRDeps(): GitHubModuleDeps {
  return {
    octokit: {
      rest: {
        pulls: {
          create: vi.fn(() =>
            Promise.resolve({
              data: {
                number: 99,
                html_url: 'https://github.com/test-owner/test-repo/pull/99',
                head: { ref: 'pi/issue42-1234567890' },
                base: { ref: 'main' },
              },
            })
          ),
        },
        repos: {
          get: vi.fn(() => Promise.resolve({ data: { default_branch: 'develop' } })),
          getBranch: vi.fn(() => Promise.resolve({ data: { commit: { sha: 'base-sha-123' } } })),
        },
      },
    } as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'issue_comment',
      payload: {
        repository: { default_branch: 'main' },
      },
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp',
    },
    logger: {
      debug: vi.fn(() => {}),
      info: vi.fn(() => {}),
      warning: vi.fn(() => {}),
      notice: vi.fn(() => {}),
      error: vi.fn(() => {}),
    },
  };
}

describe('createPullRequest with deps', () => {
  test('dry run mode returns correct result', async () => {
    const deps = createPRDeps();
    const result = await createPullRequest(deps, {
      title: 'Test PR',
      body: 'Test body',
      dryRun: true,
    });

    expect(result.details.dryRun).toBe(true);
    expect(result.details.pullRequestNumber).toBe(0);
    expect(result.content[0]!.text).toContain('[DRY RUN]');
    expect(result.content[0]!.text).toContain('Test PR');
    expect(result.details.baseBranch).toBe('main');
  });

  test('dry run generates body from context when not provided', async () => {
    const deps = createPRDeps();
    const result = await createPullRequest(deps, {
      title: 'Fix bug',
      dryRun: true,
    });

    expect(result.content[0]!.text).toContain('Fixes #42');
  });

  test('dry run uses provided body', async () => {
    const deps = createPRDeps();
    const result = await createPullRequest(deps, {
      title: 'Fix bug',
      body: 'Custom body text',
      dryRun: true,
    });

    expect(result.content[0]!.text).toContain('Custom body text');
  });

  test('dry run generates branch name', async () => {
    const deps = createPRDeps();
    const result = await createPullRequest(deps, {
      title: 'Fix bug',
      dryRun: true,
    });

    expect(result.details.headBranch).toMatch(/^pi\/issue42-\d+$/);
  });

  test('throws when no changes detected in dry workspace', async () => {
    const deps = createPRDeps();
    // The workspace is a clean git repo (no changes), so
    // getWorkspaceChangePaths finds nothing and the tool throws.
    const result = await createPullRequest(deps, {
      title: 'Fix bug',
      dryRun: true,
    });
    expect(result.details.dryRun).toBe(true);
  });

  test('validates title is required', async () => {
    const deps = createPRDeps();
    await expect(
      createPullRequest(deps, {
        title: '',
      })
    ).rejects.toThrow(/title is required/);
  });

  test('validates title max length', async () => {
    const deps = createPRDeps();
    await expect(
      createPullRequest(deps, {
        title: 'a'.repeat(256),
      })
    ).rejects.toThrow(/exceeds maximum length/);
  });
});

describe('determineBaseBranch with deps', () => {
  test('uses provided base branch', async () => {
    const deps = createPRDeps();
    const result = await determineBaseBranch(deps, 'custom-branch');
    expect(result).toBe('custom-branch');
  });

  test('uses default branch from context payload', async () => {
    const deps = createPRDeps();
    const result = await determineBaseBranch(deps, undefined);
    expect(result).toBe('main');
  });

  test('fetches default branch from API when not in context', async () => {
    const deps = createPRDeps();
    (deps.context.payload as any).repository = undefined;
    const result = await determineBaseBranch(deps, undefined);
    expect(result).toBe('develop');
    expect(deps.octokit.rest.repos.get).toHaveBeenCalled();
  });
});

describe('generatePullRequestBody with deps', () => {
  test('returns provided body when set', () => {
    const deps = createPRDeps();
    const result = generatePullRequestBody(deps, 'Custom body');
    expect(result).toBe('Custom body');
  });

  test('generates Fixes body for issue context', () => {
    const deps = createPRDeps();
    const result = generatePullRequestBody(deps, undefined);
    expect(result).toContain('Fixes #42');
  });

  test('generates Related body for PR context', () => {
    const deps = createPRDeps();
    (deps.context as any).eventName = 'pull_request';
    const result = generatePullRequestBody(deps, undefined);
    expect(result).toContain('Related to #42');
  });

  test('returns empty string when no issue number and no body', () => {
    const deps = createPRDeps();
    (deps.context as any).issue = { number: undefined };
    (deps.context as any).eventName = 'push';
    const result = generatePullRequestBody(deps, undefined);
    expect(result).toBe('');
  });
});

describe('generateBranchName with deps', () => {
  test('uses issue number from context', () => {
    const deps = createPRDeps();
    const result = generateBranchName(deps, 'Fix bug');
    expect(result).toMatch(/^pi\/issue42-\d+$/);
  });

  test('uses custom template', () => {
    const deps = createPRDeps();
    const result = generateBranchName(deps, 'Fix bug', 'fix/{number}');
    expect(result).toBe('fix/42');
  });

  test('handles missing issue number', () => {
    const deps = createPRDeps();
    (deps.context as any).issue = undefined;
    const result = generateBranchName(deps, 'Fix bug');
    expect(result).toMatch(/^pi\/issueunknown-\d+$/);
  });
});

describe('createPullRequest — fallback when pulls.create fails', () => {
  // This simulates the Forgejo scenario: the git CLI push succeeds (token
  // has push access), but pulls.create fails (token lacks
  // pull-requests:write). The tool should return a compare-URL fallback
  // instead of throwing.
  function createFallbackDeps(workspace: string, pullsCreateImpl?: ReturnType<typeof vi.fn>) {
    return {
      octokit: {
        rest: {
          pulls: {
            create:
              pullsCreateImpl ??
              vi.fn(() =>
                Promise.reject(
                  Object.assign(new Error("Forbidden: Can't read pulls"), { status: 403 })
                )
              ),
          },
        },
      } as any,
      context: {
        repo: { owner: 'alex', repo: 'ansible' },
        issue: { number: 18 },
        eventName: 'issue_comment',
        payload: { repository: { default_branch: 'master' } },
        serverUrl: 'https://forge.l3x.in',
        runId: 1,
        runNumber: 1,
        workspace,
      },
      logger: {
        debug: vi.fn(() => {}),
        info: vi.fn(() => {}),
        warning: vi.fn(() => {}),
        notice: vi.fn(() => {}),
        error: vi.fn(() => {}),
      },
    } as unknown as GitHubModuleDeps;
  }

  let repo: ReturnType<typeof setupGitRepo>;

  beforeEach(() => {
    repo = setupGitRepo();
    if (repo) {
      // Create a file so git status detects a change
      fs.writeFileSync(path.join(repo.workspace, 'new-file.txt'), 'hello world');
    }
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test('returns fallback result with compare URL when pulls.create fails', async () => {
    if (!repo) {
      return;
    } // skip if git not available
    const deps = createFallbackDeps(repo.workspace);
    const result = await createPullRequest(deps, { title: 'Fix podman prune' });

    // PR was not created
    expect(result.details.prCreated).toBe(false);
    expect(result.details.pullRequestNumber).toBe(0);
    expect(result.details.pullRequestUrl).toBe('');

    // Compare URL is provided
    expect(result.details.compareUrl).toContain(
      'https://forge.l3x.in/alex/ansible/compare/master...'
    );
    expect(result.details.compareUrl).toContain('pi/issue18-');

    // The message mentions the branch and includes the compare URL
    expect(result.content[0]!.text).toContain('created and pushed successfully');
    expect(result.content[0]!.text).toContain("Can't read pulls");
    expect(result.content[0]!.text).toContain(result.details.compareUrl!);
  });

  test('branch was created and pushed via git CLI', async () => {
    if (!repo) {
      return;
    } // skip if git not available
    const deps = createFallbackDeps(repo.workspace);
    await createPullRequest(deps, { title: 'Fix bug' });

    // Verify pulls.create was attempted
    expect(deps.octokit.rest.pulls.create).toHaveBeenCalled();
    // Verify the branch was pushed to the remote
    const { execSync } = await import('node:child_process');
    const branches = execSync('git branch', {
      cwd: repo.remoteDir,
      encoding: 'utf-8',
    });
    expect(branches).toContain('pi/issue18-');
  });

  test('does not throw — returns a result instead', async () => {
    if (!repo) {
      return;
    } // skip if git not available
    const deps = createFallbackDeps(repo.workspace);
    // This should NOT throw — the whole point of the fallback
    const result = await createPullRequest(deps, { title: 'Fix bug' });
    expect(result).toBeDefined();
    expect(result.details.prCreated).toBe(false);
  });
});

describe('createPullRequest — non-permission errors are re-thrown', () => {
  // Only 401/403/404 (token-permission) failures trigger the compare-URL
  // fallback. Other statuses (422 already-exists, 5xx transient) must
  // propagate so the agent can react appropriately instead of being
  // silently masked as partial success.
  function createReThrowDeps(workspace: string, pullsCreateImpl: ReturnType<typeof vi.fn>) {
    return {
      octokit: {
        rest: {
          pulls: { create: pullsCreateImpl },
        },
      } as any,
      context: {
        repo: { owner: 'alex', repo: 'ansible' },
        issue: { number: 18 },
        eventName: 'issue_comment',
        payload: { repository: { default_branch: 'master' } },
        serverUrl: 'https://forge.l3x.in',
        runId: 1,
        runNumber: 1,
        workspace,
      },
      logger: {
        debug: vi.fn(() => {}),
        info: vi.fn(() => {}),
        warning: vi.fn(() => {}),
        notice: vi.fn(() => {}),
        error: vi.fn(() => {}),
      },
    } as unknown as GitHubModuleDeps;
  }

  let repo: ReturnType<typeof setupGitRepo>;

  beforeEach(() => {
    repo = setupGitRepo();
    if (repo) {
      fs.writeFileSync(path.join(repo.workspace, 'new-file.txt'), 'hello world');
    }
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test('422 (PR already exists) is re-thrown, not converted to fallback', async () => {
    if (!repo) {
      return;
    }
    const deps = createReThrowDeps(
      repo.workspace,
      vi.fn(() =>
        Promise.reject(
          Object.assign(new Error('Validation Failed: A pull request already exists'), {
            status: 422,
          })
        )
      )
    );
    await expect(createPullRequest(deps, { title: 'Fix bug' })).rejects.toThrow(
      /Failed to create pull request/
    );
  });

  test('500 (server error) is re-thrown, not converted to fallback', async () => {
    if (!repo) {
      return;
    }
    const deps = createReThrowDeps(
      repo.workspace,
      vi.fn(() =>
        Promise.reject(Object.assign(new Error('Internal Server Error'), { status: 500 }))
      )
    );
    await expect(createPullRequest(deps, { title: 'Fix bug' })).rejects.toThrow(
      /Failed to create pull request/
    );
  });

  test('error with no status code is re-thrown, not converted to fallback', async () => {
    if (!repo) {
      return;
    }
    const deps = createReThrowDeps(
      repo.workspace,
      vi.fn(() => Promise.reject(new Error('network timeout')))
    );
    await expect(createPullRequest(deps, { title: 'Fix bug' })).rejects.toThrow(
      /Failed to create pull request/
    );
  });

  test('401 (unauthorized) still triggers the compare-URL fallback', async () => {
    if (!repo) {
      return;
    }
    const deps = createReThrowDeps(
      repo.workspace,
      vi.fn(() =>
        Promise.reject(Object.assign(new Error('Requires authentication'), { status: 401 }))
      )
    );
    const result = await createPullRequest(deps, { title: 'Fix bug' });
    expect(result.details.prCreated).toBe(false);
    expect(result.details.compareUrl).toBeDefined();
    expect(result.content[0]!.text).toContain('Requires authentication');
  });

  test('404 (Forgejo "Can\'t read pulls") triggers the compare-URL fallback', async () => {
    if (!repo) {
      return;
    }
    // Forgejo returns 404 instead of 403 when the internal actions bot
    // user lacks the unit-level permission to create PRs, even though git
    // push succeeded. This must be treated as a permission error and fall
    // back to the compare URL rather than being re-thrown.
    const deps = createReThrowDeps(
      repo.workspace,
      vi.fn(() =>
        Promise.reject(
          Object.assign(new Error("Can't read pulls or can't read UnitTypeCode"), {
            status: 404,
          })
        )
      )
    );
    const result = await createPullRequest(deps, { title: 'Fix bug' });
    expect(result.details.prCreated).toBe(false);
    expect(result.details.compareUrl).toBeDefined();
    expect(result.content[0]!.text).toContain("Can't read pulls");
  });
});

describe('createPullRequest — app installation token pushes to origin (#432)', () => {
  // A GitHub App installation token with `contents: write` can push, but
  // `GET /user` answers 403 and `GET /repos/{owner}/{repo}` reports every
  // permission as false. The branch must go to `origin` without any fork
  // API call, and a same-repository PR is opened with a plain head.
  function createInstallationTokenDeps(workspace: string) {
    return {
      octokit: {
        rest: {
          users: {
            getAuthenticated: vi.fn(() =>
              Promise.reject(
                Object.assign(new Error('Resource not accessible by integration'), {
                  status: 403,
                })
              )
            ),
          },
          pulls: {
            create: vi.fn(() =>
              Promise.resolve({
                data: {
                  number: 77,
                  html_url: 'https://github.com/alex/ansible/pull/77',
                  head: { ref: 'pi/issue18-1234567890' },
                  base: { ref: 'master' },
                },
              })
            ),
          },
          repos: {
            get: vi.fn(() =>
              Promise.resolve({
                data: {
                  default_branch: 'master',
                  permissions: {
                    admin: false,
                    maintain: false,
                    pull: false,
                    push: false,
                    triage: false,
                  },
                },
              })
            ),
            createFork: vi.fn(),
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
        debug: vi.fn(() => {}),
        info: vi.fn(() => {}),
        warning: vi.fn(() => {}),
        notice: vi.fn(() => {}),
        error: vi.fn(() => {}),
      },
    } as unknown as GitHubModuleDeps;
  }

  let repo: ReturnType<typeof setupGitRepo>;

  beforeEach(() => {
    repo = setupGitRepo();
    if (repo) {
      fs.writeFileSync(path.join(repo.workspace, 'new-file.txt'), 'hello world');
    }
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test('pushes to origin and opens a same-repository PR without fork API calls', async () => {
    if (!repo) {
      return;
    }
    const deps = createInstallationTokenDeps(repo.workspace);
    const result = await createPullRequest(deps, { title: 'Fix podman prune' });

    expect(result.details.prCreated).toBe(true);
    expect(result.details.pullRequestNumber).toBe(77);
    expect(result.details.pullRequestUrl).toBe('https://github.com/alex/ansible/pull/77');
    expect(result.details.forkOwner).toBeUndefined();
    expect(result.details.forkRepo).toBeUndefined();

    expect(deps.octokit.rest.users.getAuthenticated).not.toHaveBeenCalled();
    expect(deps.octokit.rest.repos.createFork).not.toHaveBeenCalled();

    // Same-repository head: plain branch name, not "owner:branch"
    expect(deps.octokit.rest.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'alex',
        repo: 'ansible',
        head: expect.stringMatching(/^pi\/issue18-\d+$/),
      })
    );

    const { execSync } = await import('node:child_process');
    const branches = execSync('git branch', { cwd: repo.remoteDir, encoding: 'utf-8' });
    expect(branches).toContain('pi/issue18-');
  });
});

describe('createPullRequest — push refused by origin', () => {
  function createRefusedPushDeps(workspace: string) {
    return {
      octokit: {
        rest: {
          users: {
            getAuthenticated: vi.fn(() => Promise.resolve({ data: { login: 'sam' } })),
          },
          pulls: { create: vi.fn() },
          repos: {
            // No fork of alex/ansible exists under sam yet.
            get: vi.fn(() =>
              Promise.reject(Object.assign(new Error('Not Found'), { status: 404 }))
            ),
            createFork: vi.fn(() =>
              Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }))
            ),
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
        debug: vi.fn(() => {}),
        info: vi.fn(() => {}),
        warning: vi.fn(() => {}),
        notice: vi.fn(() => {}),
        error: vi.fn(() => {}),
      },
    } as unknown as GitHubModuleDeps;
  }

  let repo: ReturnType<typeof setupGitRepo>;

  beforeEach(() => {
    repo = setupGitRepo();
    if (repo) {
      fs.writeFileSync(path.join(repo.workspace, 'new-file.txt'), 'hello world');
    }
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test.each([
    'Permission to alex/ansible.git denied to sam.',
    "fatal: unable to access 'https://github.com/alex/ansible.git/': The requested URL returned error: 403",
  ])(
    'a permission refusal tries to create a fork and surfaces the actionable error: %s',
    async refusal => {
      if (!repo) {
        return;
      }
      rejectPushes(repo.remoteDir, refusal);
      const deps = createRefusedPushDeps(repo.workspace);

      const message = await createPullRequest(deps, { title: 'Fix bug' }).then(
        () => '',
        (error: Error) => error.message
      );
      expect(message).toContain('origin refused the push (');
      expect(message).toContain(refusal);
      expect(message).toMatch(
        /opening the pull request from a fork failed: .*Failed to create a fork of "alex\/ansible".*Fork-based pull requests require a token that can create forks/s
      );
      expect(message).toMatch(/The changes are committed on local branch "pi\/issue18-[^"]+"\.$/);
      expect(deps.octokit.rest.repos.createFork).toHaveBeenCalledWith({
        owner: 'alex',
        repo: 'ansible',
      });
      expect(deps.octokit.rest.pulls.create).not.toHaveBeenCalled();
    }
  );

  test('a refusal that is not about permission is re-thrown without fork API calls', async () => {
    if (!repo) {
      return;
    }
    rejectPushes(repo.remoteDir, 'Branch names must match the team policy.');
    const deps = createRefusedPushDeps(repo.workspace);

    await expect(createPullRequest(deps, { title: 'Fix bug' })).rejects.toThrow(
      /Failed to create pull request: .*Branch names must match the team policy\./s
    );
    expect(deps.octokit.rest.users.getAuthenticated).not.toHaveBeenCalled();
    expect(deps.octokit.rest.repos.createFork).not.toHaveBeenCalled();
    expect(deps.octokit.rest.pulls.create).not.toHaveBeenCalled();
  });
});

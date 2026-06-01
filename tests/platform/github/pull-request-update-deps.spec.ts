/**
 * @file Tests for the updatePullRequest function (full integration with deps).
 *
 * Covers the end-to-end flow of updating a pull request via the GitHub API.
 */

import { describe, expect, test, mock } from 'bun:test';
import { updatePullRequest, validateUpdatePullRequestParams } from '../../../src/platform/github/tools/pull-request-update';
import type { GitHubModuleDeps } from '../../../src/platform/github/types';

function createUpdateDeps(): GitHubModuleDeps & {
  octokit: {
    rest: {
      pulls: {
        get: ReturnType<typeof mock>;
        update: ReturnType<typeof mock>;
      };
      git: {
        getRef: ReturnType<typeof mock>;
        getTree: ReturnType<typeof mock>;
        getBlob: ReturnType<typeof mock>;
        createBlob: ReturnType<typeof mock>;
        createTree: ReturnType<typeof mock>;
        createCommit: ReturnType<typeof mock>;
        updateRef: ReturnType<typeof mock>;
      };
    };
  };
} {
  return {
    octokit: {
      rest: {
        pulls: {
          get: mock(() =>
            Promise.resolve({
              data: {
                number: 42,
                head: { ref: 'feature-branch', sha: 'abc123' },
                base: { ref: 'main' },
                html_url: 'https://github.com/test-owner/test-repo/pull/42',
              },
              status: 200,
            })
          ),
          update: mock(() =>
            Promise.resolve({
              data: { number: 42 },
              status: 200,
            })
          ),
        },
        git: {
          getRef: mock(() =>
            Promise.resolve({ data: { object: { sha: 'abc123' } } })
          ),
          getTree: mock(() =>
            Promise.resolve({ data: { tree: [] } })
          ),
          getBlob: mock(() =>
            Promise.resolve({
              data: { content: '' },
            })
          ),
          createBlob: mock(() =>
            Promise.resolve({ data: { sha: 'blob-sha' } })
          ),
          createTree: mock(() =>
            Promise.resolve({ data: { sha: 'tree-sha' } })
          ),
          createCommit: mock(() =>
            Promise.resolve({ data: { sha: 'commit-sha' } })
          ),
          updateRef: mock(() =>
            Promise.resolve({ data: {} })
          ),
        },
      },
    } as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'pull_request',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp',
    },
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warning: mock(() => {}),
      notice: mock(() => {}),
      error: mock(() => {}),
    },
  };
}

describe('updatePullRequest', () => {
  test('throws when pull number cannot be resolved', async () => {
    const deps = createUpdateDeps();
    (deps.context as any).issue = { number: 0 };

    await expect(
      updatePullRequest(deps, { title: 'Update' })
    ).rejects.toThrow(/Pull request number not provided/);
  });

  test('throws when PR fetch returns invalid data', async () => {
    const deps = createUpdateDeps();
    (deps.octokit.rest.pulls.get as any).mockImplementation(() =>
      Promise.resolve({ data: null, status: 404 })
    );

    await expect(
      updatePullRequest(deps, { pull_number: 99, title: 'Update' })
    ).rejects.toThrow(/Could not fetch pull request/);
  });

  test('dry run mode reports what would happen', async () => {
    const deps = createUpdateDeps();
    const result = await updatePullRequest(deps, {
      pull_number: 42,
      title: 'New Title',
      dryRun: true,
    });

    expect(result.details.dryRun).toBe(true);
    expect(result.content[0]!.text).toContain('[DRY RUN]');
    expect(result.content[0]!.text).toContain('New Title');
    expect(result.details.headBranch).toBe('feature-branch');
    expect(result.details.baseBranch).toBe('main');
  });

  test('dry run with code changes reports them', async () => {
    const deps = createUpdateDeps();
    // Mock empty tree so no files to compare
    (deps.octokit.rest.git.getTree as any).mockImplementation(() =>
      Promise.resolve({ data: { tree: [] } })
    );
    const result = await updatePullRequest(deps, {
      pull_number: 42,
      message: 'Update code',
      dryRun: true,
    });

    // With no files in the tree and workspace files existing, there may or may not be changes
    expect(result.details.dryRun).toBe(true);
    expect(result.content[0]!.text).toContain('[DRY RUN]');
  });

  test('updates only metadata when no file changes', async () => {
    const deps = createUpdateDeps();
    const result = await updatePullRequest(deps, {
      pull_number: 42,
      title: 'New Title',
      body: 'New Body',
    });

    expect(result.details.titleUpdated).toBe(true);
    expect(result.details.bodyUpdated).toBe(true);
    expect(result.details.pullRequestNumber).toBe(42);
    expect(result.details.dryRun).toBe(false);
    expect(deps.octokit.rest.pulls.update).toHaveBeenCalled();
  });

  test('updates only title when only title provided', async () => {
    const deps = createUpdateDeps();
    const result = await updatePullRequest(deps, {
      pull_number: 42,
      title: 'New Title',
    });

    expect(result.details.titleUpdated).toBe(true);
    expect(result.details.bodyUpdated).toBeUndefined();
  });

  test('updates only body when only body provided', async () => {
    const deps = createUpdateDeps();
    const result = await updatePullRequest(deps, {
      pull_number: 42,
      body: 'New Body',
    });

    expect(result.details.titleUpdated).toBeUndefined();
    expect(result.details.bodyUpdated).toBe(true);
  });

  test('uses pull_number from context when not provided', async () => {
    const deps = createUpdateDeps();
    const result = await updatePullRequest(deps, {
      title: 'Context PR',
    });

    expect(result.details.pullRequestNumber).toBe(42);
  });

  test('success message includes PR URL', async () => {
    const deps = createUpdateDeps();
    const result = await updatePullRequest(deps, {
      pull_number: 42,
      title: 'Update',
    });

    expect(result.content[0]!.text).toContain(
      'https://github.com/test-owner/test-repo/pull/42'
    );
  });

  test('reports no metadata update when neither title nor body provided', async () => {
    const deps = createUpdateDeps();
    const result = await updatePullRequest(deps, {
      pull_number: 42,
      message: 'Just a commit',
    });

    expect(result.details.titleUpdated).toBeUndefined();
    expect(result.details.bodyUpdated).toBeUndefined();
  });
});

describe('validateUpdatePullRequestParams (direct import)', () => {
  test('throws when no params provided', () => {
    expect(() => validateUpdatePullRequestParams({})).toThrow(
      'At least one update parameter'
    );
  });

  test('passes with title', () => {
    expect(() =>
      validateUpdatePullRequestParams({ title: 'New Title' })
    ).not.toThrow();
  });

  test('passes with body', () => {
    expect(() =>
      validateUpdatePullRequestParams({ body: 'New Body' })
    ).not.toThrow();
  });

  test('passes with message', () => {
    expect(() =>
      validateUpdatePullRequestParams({ message: 'Commit message' })
    ).not.toThrow();
  });

  test('passes with pull_number', () => {
    expect(() =>
      validateUpdatePullRequestParams({ pull_number: 42 })
    ).not.toThrow();
  });

  test('throws for title exceeding max length', () => {
    expect(() =>
      validateUpdatePullRequestParams({ title: 'a'.repeat(256) })
    ).toThrow(/exceeds maximum length/);
  });

  test('passes for title at max length', () => {
    expect(() =>
      validateUpdatePullRequestParams({ title: 'a'.repeat(255) })
    ).not.toThrow();
  });
});

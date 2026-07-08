/**
 * @file Tests for the updatePullRequest function (full integration with deps).
 *
 * Covers the end-to-end flow of updating a pull request via the GitHub API.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import {
  updatePullRequest,
  validateUpdatePullRequestParams,
} from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

function createUpdateDeps(): GitHubModuleDeps {
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
      },
    } as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'pull_request',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: emptyWorkspace,
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

/**
 * Create a clean git repo workspace so `git status --porcelain` works.
 * The repo starts clean (no pending changes) so scanForChanges finds nothing.
 */
let emptyWorkspace: string;

beforeEach(() => {
  emptyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-pr-update-empty-'));
  // Initialise as a git repo with one commit so it has a clean working tree
  execSync('git init', { cwd: emptyWorkspace, stdio: 'pipe' });
  execSync('git config user.name test', { cwd: emptyWorkspace, stdio: 'pipe' });
  execSync('git config user.email test@test', { cwd: emptyWorkspace, stdio: 'pipe' });
  execSync('git commit --allow-empty -m init', { cwd: emptyWorkspace, stdio: 'pipe' });
});

afterEach(() => {
  fs.rmSync(emptyWorkspace, { recursive: true, force: true });
});

describe('updatePullRequest', () => {
  test('throws when pull number cannot be resolved', async () => {
    const deps = createUpdateDeps();
    (deps.context as any).issue = { number: 0 };

    await expect(updatePullRequest(deps, { title: 'Update' })).rejects.toThrow(
      /Pull request number not provided/
    );
  });

  test('throws when PR fetch returns invalid data', async () => {
    const deps = createUpdateDeps();
    (deps.octokit.rest.pulls.get as any).mockImplementation(() =>
      Promise.resolve({ data: null, status: 404 })
    );

    await expect(updatePullRequest(deps, { pull_number: 99, title: 'Update' })).rejects.toThrow(
      /Could not fetch pull request/
    );
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
    // Create a file so git status detects a change
    fs.writeFileSync(path.join(emptyWorkspace, 'new-file.ts'), 'export {};');

    const result = await updatePullRequest(deps, {
      pull_number: 42,
      message: 'Update code',
      dryRun: true,
    });

    // Should report the file change
    expect(result.details.dryRun).toBe(true);
    expect(result.content[0]!.text).toContain('[DRY RUN]');
    expect(result.content[0]!.text).toContain('1 modified/new file(s)');
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

    expect(result.content[0]!.text).toContain('https://github.com/test-owner/test-repo/pull/42');
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
    expect(() => validateUpdatePullRequestParams({})).toThrow('At least one update parameter');
  });

  test('passes with title', () => {
    expect(() => validateUpdatePullRequestParams({ title: 'New Title' })).not.toThrow();
  });

  test('passes with body', () => {
    expect(() => validateUpdatePullRequestParams({ body: 'New Body' })).not.toThrow();
  });

  test('passes with message', () => {
    expect(() => validateUpdatePullRequestParams({ message: 'Commit message' })).not.toThrow();
  });

  test('passes with pull_number', () => {
    expect(() => validateUpdatePullRequestParams({ pull_number: 42 })).not.toThrow();
  });

  test('throws for title exceeding max length', () => {
    expect(() => validateUpdatePullRequestParams({ title: 'a'.repeat(256) })).toThrow(
      /exceeds maximum length/
    );
  });

  test('passes for title at max length', () => {
    expect(() => validateUpdatePullRequestParams({ title: 'a'.repeat(255) })).not.toThrow();
  });
});

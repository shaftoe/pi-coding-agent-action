import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { isolateGitConfig } from './helpers/git-repo';

import { setupGitHubTestEnv } from './helpers/github-test-env';
setupGitHubTestEnv({ envPathPrefix: 'gh-event-pr-update' });

// Isolate git ops from the host's global/system config (see isolateGitConfig).
isolateGitConfig();

const noop = (): void => {};
const mockGetInput = vi.fn((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  return '';
});

// Mock octokit
const mockPullsUpdate = vi.fn(() =>
  Promise.resolve({
    data: {
      number: 42,
      html_url: 'https://github.com/test-owner/test-repo/pull/42',
    },
  })
);
const mockPullsGet = vi.fn(() =>
  Promise.resolve({
    status: 200,
    data: {
      number: 42,
      html_url: 'https://github.com/test-owner/test-repo/pull/42',
      head: { ref: 'feature-branch', sha: 'head-sha-123' },
      base: { ref: 'main' },
    },
  })
);
// octokit mock no longer needed - deps pattern

// Setup default GitHub context
const mockContext = {
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 42,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  payload: {},
  eventName: 'pull_request',
};

// Mock @actions/github context
vi.mock('@actions/github', () => ({
  context: mockContext,
}));

const mockOctokit = {
  rest: {
    pulls: {
      get: mockPullsGet,
      update: mockPullsUpdate,
    },
  },
};

// Create a test CoreAdapter
const testCoreAdapter = {
  getInput: mockGetInput,
  setFailed: vi.fn(noop),
  setOutput: vi.fn(noop),
  notice: vi.fn(noop),
  info: vi.fn(noop),
  debug: vi.fn(noop),
  warning: vi.fn(noop),
  error: vi.fn(noop),
};

// Dynamic import to ensure mocks are set before module loads
const pullRequestUpdateModulePromise = import('@alexanderfortin/pi-platform-github');

import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

function createTestDeps(): GitHubModuleDeps {
  return {
    octokit: mockOctokit as any,
    context: {
      repo: mockContext.repo,
      issue: mockContext.issue,
      eventName: mockContext.eventName,
      payload: mockContext.payload,
      serverUrl: mockContext.serverUrl,
      runId: mockContext.runId,
      workspace: emptyWorkspace,
    },
    logger: testCoreAdapter,
  };
}

/**
 * Create a clean git repo workspace so `git status --porcelain` works.
 * The repo starts clean (no pending changes).
 */
let emptyWorkspace: string;

beforeEach(() => {
  emptyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-pr-update-int-'));
  // Initialise as a git repo with one commit so it has a clean working tree
  execSync('git init', { cwd: emptyWorkspace, stdio: 'pipe' });
  execSync('git config user.name test', { cwd: emptyWorkspace, stdio: 'pipe' });
  execSync('git config user.email test@test', { cwd: emptyWorkspace, stdio: 'pipe' });
  execSync('git commit --allow-empty -m init', { cwd: emptyWorkspace, stdio: 'pipe' });
});

afterEach(() => {
  fs.rmSync(emptyWorkspace, { recursive: true, force: true });
});

// Cache the module after first import
let pullRequestUpdateModule: any | null = null;

async function getModule() {
  pullRequestUpdateModule ??= await pullRequestUpdateModulePromise;
  return pullRequestUpdateModule;
}

describe('updatePullRequest - integration tests', () => {
  beforeEach(async () => {
    mockPullsUpdate.mockClear();
    mockPullsGet.mockClear();
    // Reset to default context
    mockContext.issue = { number: 42 };
    mockContext.eventName = 'pull_request';
    mockContext.payload = {};
  });

  test('updates PR title successfully', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest(createTestDeps(), {
      title: 'Updated PR title',
    });

    expect(result.details.titleUpdated).toBe(true);
    expect(mockPullsUpdate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
      title: 'Updated PR title',
    });
  });

  test('updates PR body successfully', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest(createTestDeps(), {
      body: 'Updated PR description',
    });

    expect(result.details.bodyUpdated).toBe(true);
    expect(mockPullsUpdate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
      body: 'Updated PR description',
    });
  });

  test('updates both title and body', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest(createTestDeps(), {
      title: 'New title',
      body: 'New body',
    });

    expect(result.details.titleUpdated).toBe(true);
    expect(result.details.bodyUpdated).toBe(true);
    expect(mockPullsUpdate).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
      title: 'New title',
      body: 'New body',
    });
  });

  test('uses provided pull_number parameter', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest(createTestDeps(), {
      pull_number: 999,
      title: 'Custom PR',
    });

    expect(result.details.pullRequestNumber).toBe(999);
    expect(mockPullsGet).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 999,
    });
  });

  test('resolves PR number from context when not provided', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest(createTestDeps(), {
      title: 'Context PR',
    });

    expect(result.details.pullRequestNumber).toBe(42);
    expect(mockPullsGet).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
    });
  });

  test('throws error when PR number not provided and not in context', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    // @ts-expect-error - Testing with undefined issue
    mockContext.issue = undefined;

    // With the new deps pattern, the error message is more descriptive
    await expect(
      updatePullRequest(createTestDeps(), {
        title: 'Test',
      })
    ).rejects.toThrow('Pull request number not provided');
  });

  test('returns PR details in result', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest(createTestDeps(), {
      title: 'Return details test',
    });

    expect(result.details.pullRequestNumber).toBe(42);
    expect(result.details.pullRequestUrl).toBe('https://github.com/test-owner/test-repo/pull/42');
    expect(result.details.headBranch).toBe('feature-branch');
    expect(result.details.baseBranch).toBe('main');
  });

  test('includes success message in content', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest(createTestDeps(), {
      title: 'Success test',
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Pull request #42 updated');
    expect(result.content[0].text).toContain('https://github.com/test-owner/test-repo/pull/42');
  });

  test('handles PR fetch failure', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    mockPullsGet.mockImplementationOnce(() => Promise.reject(new Error('PR not found')));

    await expect(updatePullRequest(createTestDeps(), { title: 'Fail test' })).rejects.toThrow();
  });

  test('updates PR with dryRun=true', async () => {
    const module = await getModule();
    const { updatePullRequest } = module;

    const result = await updatePullRequest(createTestDeps(), {
      title: 'Dry run title',
      dryRun: true,
    });

    expect(result.details.dryRun).toBe(true);
    expect(mockPullsUpdate).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('[DRY RUN]');
  });
});

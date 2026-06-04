import { describe, expect, test, mock, beforeEach } from 'bun:test';

import { setupGitHubTestEnv } from './helpers/github-test-env';
setupGitHubTestEnv({ envPathPrefix: 'gh-event-pr-update' });

const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  return '';
});

// Mock octokit
const mockPullsUpdate = mock(() =>
  Promise.resolve({
    data: {
      number: 42,
      html_url: 'https://github.com/test-owner/test-repo/pull/42',
    },
  })
);
const mockPullsGet = mock(() =>
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
const mockGetTree = mock(() =>
  Promise.resolve({
    data: {
      sha: 'tree-sha-123',
      tree: [],
    },
  })
);
const mockCreateBlob = mock(() =>
  Promise.resolve({
    data: { sha: 'blob-sha-123' },
  })
);
const mockCreateTree = mock(() =>
  Promise.resolve({
    data: { sha: 'new-tree-sha' },
  })
);
const mockCreateCommit = mock(() =>
  Promise.resolve({
    data: { sha: 'commit-sha-123' },
  })
);
const mockUpdateRef = mock(() =>
  Promise.resolve({
    data: { ref: 'refs/heads/feature-branch' },
  })
);
const mockOctokit = {
  rest: {
    pulls: {
      get: mockPullsGet,
      update: mockPullsUpdate,
    },
    git: {
      getTree: mockGetTree,
      createBlob: mockCreateBlob,
      createTree: mockCreateTree,
      createCommit: mockCreateCommit,
      updateRef: mockUpdateRef,
    },
  },
};
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
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Create a test CoreAdapter
const testCoreAdapter = {
  getInput: mockGetInput,
  setFailed: mock(noop),
  setOutput: mock(noop),
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  warning: mock(noop),
  error: mock(noop),
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
      workspace: process.cwd(),
    },
    logger: testCoreAdapter,
  };
}

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
    mockGetTree.mockClear();
    mockCreateBlob.mockClear();
    mockCreateTree.mockClear();
    mockCreateCommit.mockClear();
    mockUpdateRef.mockClear();
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

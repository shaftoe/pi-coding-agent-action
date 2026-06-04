import { describe, expect, test, mock, beforeEach } from 'bun:test';

import { setupGitHubTestEnv } from '../helpers/github-test-env';
setupGitHubTestEnv({ envPathPrefix: 'gh-event-commit' });

// Mock octokit
const mockCreateCommit = mock(() =>
  Promise.resolve({
    data: { sha: 'new-commit-sha-123' },
  })
);
const mockUpdateRef = mock(() =>
  Promise.resolve({
    data: { ref: 'refs/heads/test-branch' },
  })
);
const mockOctokit = {
  rest: {
    git: {
      createCommit: mockCreateCommit,
      updateRef: mockUpdateRef,
    },
  },
};
// octokit singleton mock no longer needed - deps pattern

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
};
// Mock @actions/github context
mock.module('@actions/github', () => ({
  context: mockContext,
}));

import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

// We need a mutable actor for the appendCoAuthoredBy tests
let testActor: string | undefined = 'test-user';

function createTestDeps(payloadOverrides?: Record<string, unknown>): GitHubModuleDeps {
  return {
    octokit: mockOctokit as any,
    context: {
      repo: mockContext.repo,
      issue: mockContext.issue,
      eventName: 'push',
      ...(testActor !== undefined ? { actor: testActor } : {}),
      payload: { ...payloadOverrides },
      serverUrl: mockContext.serverUrl,
      runId: mockContext.runId,
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

// Dynamic import to ensure mocks are set before module loads
const commitCreatorModule = import('@alexanderfortin/pi-platform-github');

describe('createCommitAndUpdateBranch', () => {
  beforeEach(() => {
    mockCreateCommit.mockClear();
    mockUpdateRef.mockClear();
    // Reset to default context
    mockContext.repo = { owner: 'test-owner', repo: 'test-repo' };
  });

  test('creates a commit and updates branch reference', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    const result = await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test-branch',
      message: 'Test commit message',
    });

    expect(result).toBe('new-commit-sha-123');
    expect(mockCreateCommit).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      message:
        'Test commit message\n\nCo-authored-by: test-user <test-user@users.noreply.github.com>',
      tree: 'tree-sha-abc',
      parents: ['parent-sha-def'],
    });
    expect(mockUpdateRef).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      ref: 'heads/test-branch',
      sha: 'new-commit-sha-123',
    });
  });

  test('creates commit with single parent', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'feature-branch',
      message: 'Add feature',
    });

    expect(mockCreateCommit).toHaveBeenCalled();
    const commitCall = mockCreateCommit.mock.calls[0] as any[];
    expect(commitCall[0].parents).toEqual(['parent-sha-def']);
  });

  test('updates branch with correct ref format', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'main',
      message: 'Update main',
    });

    expect(mockUpdateRef).toHaveBeenCalled();
    const updateCall = mockUpdateRef.mock.calls[0] as any[];
    expect(updateCall[0].ref).toBe('heads/main');
  });

  test('handles special characters in commit message', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    const message = 'Fix: handle special chars: émojis 🎉 and "quotes"';
    await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test',
      message,
    });

    expect(mockCreateCommit).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      message: `${message}\n\nCo-authored-by: test-user <test-user@users.noreply.github.com>`,
      tree: 'tree-sha-abc',
      parents: ['parent-sha-def'],
    });
  });

  test('uses provided logger for debug output', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    const mockLog = {
      debug: mock(() => {}),
      info: mock(() => {}),
    };

    await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test',
      message: 'Test',
      log: mockLog as any,
    });

    expect(mockLog.debug).toHaveBeenCalled();
  });

  test('creates default logger when none provided', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test',
      message: 'Test',
    } as any);

    // Should not throw, default logger is created
    expect(mockCreateCommit).toHaveBeenCalled();
  });

  test('returns correct commit SHA', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    const result = await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test',
      message: 'Test',
    });

    expect(result).toBe('new-commit-sha-123');
  });

  test('handles branch names with slashes', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'feature/sub/branch',
      message: 'Test',
    });

    expect(mockUpdateRef).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      ref: 'heads/feature/sub/branch',
      sha: 'new-commit-sha-123',
    });
  });

  test('appends Co-authored-by trailer to commit message', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    testActor = 'octocat';

    await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test',
      message: 'Fix bug',
    });

    expect(mockCreateCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Fix bug\n\nCo-authored-by: octocat <octocat@users.noreply.github.com>',
      })
    );
  });

  test('ommits Co-authored-by trailer when actor is empty', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    testActor = '';

    await createCommitAndUpdateBranch(createTestDeps(), {
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test',
      message: 'Fix bug',
    });

    expect(mockCreateCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Fix bug',
      })
    );
  });
});

describe('appendCoAuthoredBy', () => {
  let module: any;

  // Dynamic import (reuses the module already loaded above)
  const modulePromise = commitCreatorModule;

  beforeEach(() => {
    testActor = 'test-user';
  });

  test('appends Co-authored-by trailer with actor', async () => {
    module ??= await modulePromise;
    const { appendCoAuthoredBy } = module;

    testActor = 'alice';
    const result = appendCoAuthoredBy(createTestDeps(), 'Fix the bug');

    expect(result).toBe('Fix the bug\n\nCo-authored-by: alice <alice@users.noreply.github.com>');
  });

  test('returns message unchanged when actor is empty string', async () => {
    module ??= await modulePromise;
    const { appendCoAuthoredBy } = module;

    testActor = '';
    const result = appendCoAuthoredBy(createTestDeps(), 'Fix the bug');

    expect(result).toBe('Fix the bug');
  });

  test('returns message unchanged when actor is undefined', async () => {
    module ??= await modulePromise;
    const { appendCoAuthoredBy } = module;

    testActor = undefined;
    const result = appendCoAuthoredBy(createTestDeps(), 'Fix the bug');

    expect(result).toBe('Fix the bug');
  });

  test('preserves multi-line commit messages', async () => {
    module ??= await modulePromise;
    const { appendCoAuthoredBy } = module;

    testActor = 'bob';
    const message = 'Fix critical bug\n\nThis fixes the edge case in auth.';
    const result = appendCoAuthoredBy(createTestDeps(), message);

    expect(result).toBe(
      'Fix critical bug\n\nThis fixes the edge case in auth.\n\nCo-authored-by: bob <bob@users.noreply.github.com>'
    );
  });
});

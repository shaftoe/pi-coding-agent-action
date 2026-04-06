/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const _mockedWrite = mock((...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock @actions/core
const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  return '';
});

mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  warning: mock(noop),
}));

// Set env vars BEFORE importing commit-creator.ts
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

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
mock.module('../../../src/github/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

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

// Dynamic import to ensure mocks are set before module loads
const commitCreatorModule = import('../../../src/github/git/commit-creator.js');

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

    const result = await createCommitAndUpdateBranch({
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test-branch',
      message: 'Test commit message',
    });

    expect(result).toBe('new-commit-sha-123');
    expect(mockCreateCommit).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      message: 'Test commit message',
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

    await createCommitAndUpdateBranch({
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

    await createCommitAndUpdateBranch({
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
    await createCommitAndUpdateBranch({
      treeSha: 'tree-sha-abc',
      parentSha: 'parent-sha-def',
      branchName: 'test',
      message,
    });

    expect(mockCreateCommit).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      message,
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

    await createCommitAndUpdateBranch({
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

    await createCommitAndUpdateBranch({
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

    const result = await createCommitAndUpdateBranch({
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

    await createCommitAndUpdateBranch({
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
});

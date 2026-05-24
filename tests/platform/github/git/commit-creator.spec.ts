/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
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
  setOutput: mock(noop),
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
mock.module('../../../../src/platform/github/octokit', () => ({
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

// Import module context helper for test isolation
import { resetModuleContext } from '../../../../src/platform/github';

// We need a mutable actor for the appendCoAuthoredBy tests
let testActor: string | undefined = 'test-user';

// Re-mock @actions/github with mutable actor (must override the earlier mock)
mock.module('@actions/github', () => ({
  context: new Proxy(mockContext, {
    get(target, prop) {
      if (prop === 'actor') {
        return testActor;
      }
      return (target as any)[prop];
    },
  }),
}));

// Set up mock CoreAdapter so createLogger() -> getCoreAdapter() works
const mockCoreAdapter = {
  debug: mock(() => {}),
  info: mock(() => {}),
  warning: mock(() => {}),
  notice: mock(() => {}),
  setFailed: mock(() => {}),
  setOutput: mock(() => {}),
  getInput: mockGetInput,
};

resetModuleContext(mockCoreAdapter as any);

// Dynamic import to ensure mocks are set before module loads
const commitCreatorModule = import('../../../../src/platform/github/git/commit-creator.js');

describe('createCommitAndUpdateBranch', () => {
  beforeEach(() => {
    mockCreateCommit.mockClear();
    mockUpdateRef.mockClear();
    // Reset to default context
    mockContext.repo = { owner: 'test-owner', repo: 'test-repo' };
    // Ensure module context is initialized for each test
    resetModuleContext(mockCoreAdapter as any);
  });

  afterEach(() => {
    resetModuleContext(undefined);
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
      message: 'Test commit message\n\nCo-authored-by: test-user <test-user@users.noreply.github.com>',
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

  test('appends Co-authored-by trailer to commit message', async () => {
    const module = await commitCreatorModule;
    const { createCommitAndUpdateBranch } = module;

    testActor = 'octocat';

    await createCommitAndUpdateBranch({
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

    await createCommitAndUpdateBranch({
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
    const result = appendCoAuthoredBy('Fix the bug');

    expect(result).toBe('Fix the bug\n\nCo-authored-by: alice <alice@users.noreply.github.com>');
  });

  test('returns message unchanged when actor is empty string', async () => {
    module ??= await modulePromise;
    const { appendCoAuthoredBy } = module;

    testActor = '';
    const result = appendCoAuthoredBy('Fix the bug');

    expect(result).toBe('Fix the bug');
  });

  test('returns message unchanged when actor is undefined', async () => {
    module ??= await modulePromise;
    const { appendCoAuthoredBy } = module;

    testActor = undefined;
    const result = appendCoAuthoredBy('Fix the bug');

    expect(result).toBe('Fix the bug');
  });

  test('preserves multi-line commit messages', async () => {
    module ??= await modulePromise;
    const { appendCoAuthoredBy } = module;

    testActor = 'bob';
    const message = 'Fix critical bug\n\nThis fixes the edge case in auth.';
    const result = appendCoAuthoredBy(message);

    expect(result).toBe(
      'Fix critical bug\n\nThis fixes the edge case in auth.\n\nCo-authored-by: bob <bob@users.noreply.github.com>'
    );
  });
});

import { describe, expect, test, mock, beforeEach } from 'bun:test';

import { setupGitHubTestEnv } from '../helpers/github-test-env';
setupGitHubTestEnv({ envPathPrefix: 'gh-event-tree' });

// Mock octokit
const mockCreateBlob = mock((params: any) =>
  Promise.resolve({
    data: { sha: `blob-${params.content.substring(0, 10)}-sha` },
  })
);
const mockCreateTree = mock(() =>
  Promise.resolve({
    data: { sha: 'tree-sha-123' },
  })
);
const mockOctokit = {
  rest: {
    git: {
      createBlob: mockCreateBlob,
      createTree: mockCreateTree,
    },
  },
};
// octokit mock no longer needed - deps pattern

import { setupGitHubContextMock, defaultMockContext } from '../helpers/github-test-env';
const mockContext = defaultMockContext;
setupGitHubContextMock(mockContext);

import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

function createTestDeps(): GitHubModuleDeps {
  return {
    octokit: mockOctokit as any,
    context: {
      repo: mockContext.repo,
      issue: mockContext.issue,
      eventName: 'push',
      payload: {},
      serverUrl: mockContext.serverUrl,
      runId: mockContext.runId,
      workspace: '/tmp',
    },
    logger: {
      debug: () => {},
      info: () => {},
      warning: () => {},
      notice: () => {},
      error: () => {},
    },
  };
}

// Dynamic import to ensure mocks are set before module loads
const treeBuilderModule = import('@alexanderfortin/pi-platform-github');

describe('createBlobsAndTree', () => {
  beforeEach(() => {
    mockCreateBlob.mockClear();
    mockCreateTree.mockClear();
    // Reset to default context
    mockContext.repo = { owner: 'test-owner', repo: 'test-repo' };
  });

  test('creates blobs for changed files', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    const result = await createBlobsAndTree(createTestDeps(), {
      changedFiles: [{ path: 'test.txt', content: 'hello world', mode: '100644' as any }],
      deletedFiles: [],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(result).toBe('tree-sha-123');
    expect(mockCreateBlob).toHaveBeenCalledTimes(1);
    expect(mockCreateBlob).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      content: Buffer.from('hello world').toString('base64'),
      encoding: 'base64',
    });
  });

  test('creates multiple blobs for multiple changed files', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [
        { path: 'file1.txt', content: 'content1', mode: '100644' as any },
        { path: 'file2.txt', content: 'content2', mode: '100644' as any },
        { path: 'file3.txt', content: 'content3', mode: '100644' as any },
      ],
      deletedFiles: [],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(mockCreateBlob).toHaveBeenCalledTimes(3);
  });

  test('creates tree with correct base tree', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [{ path: 'test.txt', content: 'content', mode: '100644' as any }],
      deletedFiles: [],
      parentSha: 'parent-commit-sha',
      log: mockLog as any,
    });

    expect(mockCreateTree).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      base_tree: 'parent-commit-sha',
      tree: expect.arrayContaining([
        expect.objectContaining({
          path: 'test.txt',
          mode: '100644',
          type: 'blob',
          sha: expect.any(String),
        }),
      ]),
    });
  });

  test('handles deleted files with null sha', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [],
      deletedFiles: ['deleted.txt', 'removed.txt'],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(mockCreateTree).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      base_tree: 'parent-sha',
      tree: expect.arrayContaining([
        expect.objectContaining({ path: 'deleted.txt', sha: null }),
        expect.objectContaining({ path: 'removed.txt', sha: null }),
      ]),
    });
  });

  test('handles both changed and deleted files', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [{ path: 'new.txt', content: 'new content', mode: '100644' as any }],
      deletedFiles: ['old.txt'],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    const treeCall = mockCreateTree.mock.calls[0] as any[];
    const treeEntries = treeCall[0].tree;

    expect(treeEntries).toHaveLength(2);
    expect(treeEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'new.txt', sha: expect.any(String) }),
        expect.objectContaining({ path: 'old.txt', sha: null }),
      ])
    );
  });

  test('handles binary content', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff]).toString('binary');

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [{ path: 'binary.bin', content: binaryContent, mode: '100644' as any }],
      deletedFiles: [],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(mockCreateBlob).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      content: Buffer.from(binaryContent).toString('base64'),
      encoding: 'base64',
    });
  });

  test('handles special characters in file paths', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [
        { path: 'path/with spaces/file.txt', content: 'content', mode: '100644' as any },
      ],
      deletedFiles: [],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(mockCreateTree).toHaveBeenCalled();
    const treeCall = mockCreateTree.mock.calls[0] as any[];
    expect(treeCall[0].tree[0].path).toBe('path/with spaces/file.txt');
  });

  test('handles empty content', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [{ path: 'empty.txt', content: '', mode: '100644' as any }],
      deletedFiles: [],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(mockCreateBlob).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      content: Buffer.from('').toString('base64'),
      encoding: 'base64',
    });
  });

  test('uses provided logger for debug output', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;

    const mockLog = {
      debug: mock(() => {}),
      info: mock(() => {}),
    };

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [{ path: 'test.txt', content: 'content', mode: '100644' as any }],
      deletedFiles: [],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(mockLog.debug).toHaveBeenCalled();
  });

  test('returns correct tree SHA', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    const result = await createBlobsAndTree(createTestDeps(), {
      changedFiles: [{ path: 'test.txt', content: 'content', mode: '100644' as any }],
      deletedFiles: [],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(result).toBe('tree-sha-123');
  });

  test('handles nested file paths', async () => {
    const module = await treeBuilderModule;
    const { createBlobsAndTree } = module;
    const mockLog = { debug: mock(() => {}), info: mock(() => {}) };

    await createBlobsAndTree(createTestDeps(), {
      changedFiles: [
        { path: 'src/nested/deep/file.txt', content: 'nested content', mode: '100644' as any },
      ],
      deletedFiles: [],
      parentSha: 'parent-sha',
      log: mockLog as any,
    });

    expect(mockCreateTree).toHaveBeenCalled();
    const treeCall = mockCreateTree.mock.calls[0] as any[];
    expect(treeCall[0].tree[0].path).toBe('src/nested/deep/file.txt');
  });
});

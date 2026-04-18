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

// Set env vars BEFORE importing tree-builder.ts
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

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
mock.module('../../../src/git/octokit', () => ({
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
const treeBuilderModule = import('../../../src/git/git/tree-builder.js');

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

    const result = await createBlobsAndTree({
      changedFiles: [
        { path: 'test.txt', content: 'hello world', mode: '100644' as any },
      ],
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

    await createBlobsAndTree({
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

    await createBlobsAndTree({
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

    await createBlobsAndTree({
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

    await createBlobsAndTree({
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

    await createBlobsAndTree({
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

    await createBlobsAndTree({
      changedFiles: [{ path: 'path/with spaces/file.txt', content: 'content', mode: '100644' as any }],
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

    await createBlobsAndTree({
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

    await createBlobsAndTree({
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

    const result = await createBlobsAndTree({
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

    await createBlobsAndTree({
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

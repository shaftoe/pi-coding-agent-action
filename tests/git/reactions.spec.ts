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

const mockDebugLog: string[] = [];
const debugLogger = (msg: string): void => {
  mockDebugLog.push(msg);
};

mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mock(noop),
  info: mock(noop),
  debug: mock(debugLogger),
  setFailed: mock(noop),
  warning: mock(noop),
}));

// Set env vars BEFORE importing reactions.ts
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// Mock octokit
const mockCreateIssueReaction = mock(() =>
  Promise.resolve({
    data: { id: 12345, content: 'eyes' },
    headers: {},
    status: 200,
    url: '',
  } as any)
);
const mockCreatePRReviewReaction = mock(() =>
  Promise.resolve({
    data: { id: 12345, content: 'eyes' },
    headers: {},
    status: 200,
    url: '',
  } as any)
);
const mockDeleteIssueReaction = mock(() =>
  Promise.resolve({
    data: {},
    headers: {},
    status: 204,
    url: '',
  } as any)
);
const mockDeletePRReviewReaction = mock(() =>
  Promise.resolve({
    data: {},
    headers: {},
    status: 204,
    url: '',
  } as any)
);
const mockOctokit = {
  rest: {
    reactions: {
      createForIssueComment: mockCreateIssueReaction,
      createForPullRequestReviewComment: mockCreatePRReviewReaction,
      deleteForIssueComment: mockDeleteIssueReaction,
      deleteForPullRequestComment: mockDeletePRReviewReaction,
    },
  },
};
mock.module('../../src/git/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

// Create a test CoreAdapter
const testCoreAdapter = {
  debug: (msg: string): void => {
    mockDebugLog.push(msg);
  },
  getInput: mockGetInput,
  setFailed: mock(noop),
  notice: mock(noop),
  info: mock(noop),
  warning: mock(noop),
};

const githubModulePromise = import('../../src/git/index.js');

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
  payload: {
    comment: {
      id: 999,
      body: 'test comment',
    },
  },
};

// Mock @actions/github context
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Dynamic import to ensure mocks are set before module loads
const reactionsModule = import('../../src/git/reactions.js');

describe('addReaction', () => {
  beforeEach(async () => {
    mockCreateIssueReaction.mockClear();
    mockCreatePRReviewReaction.mockClear();
    mockDebugLog.length = 0;
    // Reset to default context with comment
    mockContext.payload.comment = {
      id: 999,
      body: 'test comment',
    };

    // Initialize the github module context with test adapter
    const githubExports = await githubModulePromise;
    githubExports.setCoreAdapter(testCoreAdapter);
  });

  test('adds eyes reaction to comment', async () => {
    const module = await reactionsModule;
    const { addReaction } = module;

    const result = await addReaction();

    expect(result).toBeDefined();
    expect(result?.data.id).toBe(12345);
    expect(result?.data.content).toBe('eyes');
    expect(mockCreateIssueReaction).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 999,
      content: 'eyes',
    });
  });

  test('returns undefined when no comment in context', async () => {
    const module = await reactionsModule;
    const { addReaction } = module;

    // @ts-expect-error - Testing with no comment
    mockContext.payload.comment = undefined;

    const result = await addReaction();

    expect(result).toBeUndefined();
    expect(mockCreateIssueReaction).not.toHaveBeenCalled();
    expect(mockCreatePRReviewReaction).not.toHaveBeenCalled();
    expect(mockDebugLog.length).toBeGreaterThan(0);
    expect(mockDebugLog[0]).toContain('[reactions] no comment found');
  });

  test('logs debug message when no comment', async () => {
    const module = await reactionsModule;
    const { addReaction } = module;

    // @ts-expect-error - Testing with no comment
    mockContext.payload.comment = undefined;

    await addReaction();

    expect(mockDebugLog.length).toBeGreaterThan(0);
    expect(mockDebugLog[0]).toContain('no comment found');
  });

  test('uses correct repo owner and name', async () => {
    const module = await reactionsModule;
    const { addReaction } = module;

    await addReaction();

    const callArgs = mockCreateIssueReaction.mock.calls[0] as any[];
    expect(callArgs[0].owner).toBe('test-owner');
    expect(callArgs[0].repo).toBe('test-repo');
  });

  test('handles different comment IDs', async () => {
    const module = await reactionsModule;
    const { addReaction } = module;

    mockContext.payload.comment = {
      id: 888,
      body: 'another comment',
    };

    await addReaction();

    const callArgs = mockCreateIssueReaction.mock.calls[0] as any[];
    expect(callArgs[0].comment_id).toBe(888);
  });

  test('adds eyes reaction to PR review comment (inline comment)', async () => {
    const module = await reactionsModule;
    const { addReaction } = module;

    // Set up PR review comment context
    mockContext.payload.comment = {
      id: 999,
      body: 'inline comment on code',
      pull_request_review_id: 456,
    } as any;

    const result = await addReaction();

    expect(result).toBeDefined();
    expect(result?.data.id).toBe(12345);
    expect(result?.data.content).toBe('eyes');
    expect(mockCreatePRReviewReaction).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 999,
      content: 'eyes',
    });
    expect(mockCreateIssueReaction).not.toHaveBeenCalled();
  });

  test('returns undefined for pull_request_review event (no comment in payload)', async () => {
    const module = await reactionsModule;
    const { addReaction } = module;

    // Simulate pull_request_review event: no comment, has review
    (mockContext as any).payload = {
      review: { id: 42, body: '/pi review this' },
    };

    const result = await addReaction();

    expect(result).toBeUndefined();
    expect(mockCreateIssueReaction).not.toHaveBeenCalled();
    expect(mockCreatePRReviewReaction).not.toHaveBeenCalled();
    expect(mockDebugLog.length).toBeGreaterThan(0);
    expect(mockDebugLog[0]).toContain('[reactions] no comment found');
  });
});

describe('deleteReaction', () => {
  beforeEach(() => {
    mockDeleteIssueReaction.mockClear();
    mockDeletePRReviewReaction.mockClear();
    mockDebugLog.length = 0;
    // Reset to default context with comment
    mockContext.payload.comment = {
      id: 999,
      body: 'test comment',
    };
  });

  test('deletes reaction when reaction is provided', async () => {
    const module = await reactionsModule;
    const { deleteReaction } = module;

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    const result = await deleteReaction(reaction);

    expect(result).toBeDefined();
    expect(mockDeleteIssueReaction).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 999,
      reaction_id: 12345,
    });
  });

  test('returns undefined when reaction is not provided', async () => {
    const module = await reactionsModule;
    const { deleteReaction } = module;

    const result = await deleteReaction(undefined);

    expect(result).toBeUndefined();
    expect(mockDeleteIssueReaction).not.toHaveBeenCalled();
    expect(mockDeletePRReviewReaction).not.toHaveBeenCalled();
  });

  test('returns undefined when no comment in context', async () => {
    const module = await reactionsModule;
    const { deleteReaction } = module;

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    // @ts-expect-error - Testing with no comment
    mockContext.payload.comment = undefined;

    const result = await deleteReaction(reaction);

    expect(result).toBeUndefined();
    expect(mockDeleteIssueReaction).not.toHaveBeenCalled();
    expect(mockDeletePRReviewReaction).not.toHaveBeenCalled();
  });

  test('uses correct reaction ID from reaction response', async () => {
    const module = await reactionsModule;
    const { deleteReaction } = module;

    const reaction = {
      data: { id: 99999, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    await deleteReaction(reaction);

    const callArgs = mockDeleteIssueReaction.mock.calls[0] as any[];
    expect(callArgs[0].reaction_id).toBe(99999);
  });

  test('handles comment ID matching', async () => {
    const module = await reactionsModule;
    const { deleteReaction } = module;

    mockContext.payload.comment = {
      id: 555,
      body: 'comment',
    };

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    await deleteReaction(reaction);

    const callArgs = mockDeleteIssueReaction.mock.calls[0] as any[];
    expect(callArgs[0].comment_id).toBe(555);
  });

  test('does not call API when both reaction and comment are missing', async () => {
    const module = await reactionsModule;
    const { deleteReaction } = module;

    // @ts-expect-error - Testing with no comment
    mockContext.payload.comment = undefined;

    await deleteReaction(undefined);

    expect(mockDeleteIssueReaction).not.toHaveBeenCalled();
  });

  test('deletes reaction from PR review comment (inline comment)', async () => {
    const module = await reactionsModule;
    const { deleteReaction } = module;

    // Set up PR review comment context
    mockContext.payload.comment = {
      id: 999,
      body: 'inline comment on code',
      pull_request_review_id: 456,
    } as any;

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    const result = await deleteReaction(reaction);

    expect(result).toBeDefined();
    expect(mockDeletePRReviewReaction).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 999,
      reaction_id: 12345,
    });
    expect(mockDeleteIssueReaction).not.toHaveBeenCalled();
  });

  test('returns undefined for pull_request_review event deleteReaction (no comment)', async () => {
    const module = await reactionsModule;
    const { deleteReaction } = module;

    // Simulate pull_request_review event: no comment, has review
    (mockContext as any).payload = {
      review: { id: 42, body: '/pi review this' },
    };

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    const result = await deleteReaction(reaction);

    expect(result).toBeUndefined();
    expect(mockDeleteIssueReaction).not.toHaveBeenCalled();
    expect(mockDeletePRReviewReaction).not.toHaveBeenCalled();
  });
});

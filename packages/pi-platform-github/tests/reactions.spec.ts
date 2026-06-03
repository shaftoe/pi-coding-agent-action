import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Mock @actions/core (not used by reactions.ts directly, but may be transitively loaded)
const noop = (): void => {};
const mockDebugLog: string[] = [];
const debugLogger = (msg: string): void => {
  mockDebugLog.push(msg);
};

// Mock @actions/core via shared helper (override debug to use debugLogger)
import { registerCoreMock, coreMock } from '../../../tests/helpers/core-mock';
registerCoreMock();
coreMock.debug.mockImplementation(debugLogger);

// Mock @actions/github (not used directly, but may be loaded transitively)
mock.module('@actions/github', () => ({
  context: {},
}));

import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

// Create test deps helper
function createTestDeps(payloadOverrides?: Record<string, unknown>): GitHubModuleDeps {
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

  const octokit = {
    rest: {
      reactions: {
        createForIssueComment: mockCreateIssueReaction,
        createForPullRequestReviewComment: mockCreatePRReviewReaction,
        deleteForIssueComment: mockDeleteIssueReaction,
        deleteForPullRequestComment: mockDeletePRReviewReaction,
      },
    },
  };

  return {
    octokit: octokit as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'issue_comment',
      payload: payloadOverrides ?? {
        comment: {
          id: 999,
          body: 'test comment',
        },
      },
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp',
    },
    logger: {
      debug: debugLogger,
      info: noop,
      warning: noop,
      notice: noop,
      error: noop,
    },
  } as GitHubModuleDeps & {
    octokit: typeof octokit;
  };
}

// Dynamic import to ensure mocks are set before module loads
const reactionsModule = import('@alexanderfortin/pi-platform-github');

describe('addReaction', () => {
  beforeEach(() => {
    mockDebugLog.length = 0;
  });

  test('adds eyes reaction to comment', async () => {
    const { addReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: { id: 999, body: 'test comment' },
    });

    const result = await addReaction(deps);

    expect(result).toBeDefined();
    expect(result?.data.id).toBe(12345);
    expect(result?.data.content).toBe('eyes');
    expect(deps.octokit.rest.reactions.createForIssueComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 999,
      content: 'eyes',
    });
  });

  test('returns undefined when no comment in context', async () => {
    const { addReaction } = await reactionsModule;
    const deps = createTestDeps({});

    const result = await addReaction(deps);

    expect(result).toBeUndefined();
    expect(deps.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
    expect(deps.octokit.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
    expect(mockDebugLog.length).toBeGreaterThan(0);
    expect(mockDebugLog[0]).toContain('[reactions] no comment found');
  });

  test('logs debug message when no comment', async () => {
    const { addReaction } = await reactionsModule;
    const deps = createTestDeps({});

    await addReaction(deps);

    expect(mockDebugLog.length).toBeGreaterThan(0);
    expect(mockDebugLog[0]).toContain('no comment found');
  });

  test('uses correct repo owner and name', async () => {
    const { addReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: { id: 999, body: 'test comment' },
    });

    await addReaction(deps);

    const callArgs = (deps.octokit.rest.reactions.createForIssueComment as any).mock
      .calls[0] as any[];
    expect(callArgs[0].owner).toBe('test-owner');
    expect(callArgs[0].repo).toBe('test-repo');
  });

  test('handles different comment IDs', async () => {
    const { addReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: { id: 888, body: 'another comment' },
    });

    await addReaction(deps);

    const callArgs = (deps.octokit.rest.reactions.createForIssueComment as any).mock
      .calls[0] as any[];
    expect(callArgs[0].comment_id).toBe(888);
  });

  test('adds eyes reaction to PR review comment (inline comment)', async () => {
    const { addReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: {
        id: 999,
        body: 'inline comment on code',
        pull_request_review_id: 456,
      },
    });

    const result = await addReaction(deps);

    expect(result).toBeDefined();
    expect(result?.data.id).toBe(12345);
    expect(result?.data.content).toBe('eyes');
    expect(deps.octokit.rest.reactions.createForPullRequestReviewComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 999,
      content: 'eyes',
    });
    expect(deps.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
  });

  test('returns undefined for pull_request_review event (no comment in payload)', async () => {
    const { addReaction } = await reactionsModule;
    const deps = createTestDeps({
      review: { id: 42, body: '/pi review this' },
    });

    const result = await addReaction(deps);

    expect(result).toBeUndefined();
    expect(deps.octokit.rest.reactions.createForIssueComment).not.toHaveBeenCalled();
    expect(deps.octokit.rest.reactions.createForPullRequestReviewComment).not.toHaveBeenCalled();
    expect(mockDebugLog.length).toBeGreaterThan(0);
    expect(mockDebugLog[0]).toContain('[reactions] no comment found');
  });
});

describe('deleteReaction', () => {
  beforeEach(() => {
    mockDebugLog.length = 0;
  });

  test('deletes reaction when reaction is provided', async () => {
    const { deleteReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: { id: 999, body: 'test comment' },
    });

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    const result = await deleteReaction(deps, reaction);

    expect(result).toBeDefined();
    expect(deps.octokit.rest.reactions.deleteForIssueComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 999,
      reaction_id: 12345,
    });
  });

  test('returns undefined when reaction is not provided', async () => {
    const { deleteReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: { id: 999, body: 'test comment' },
    });

    const result = await deleteReaction(deps, undefined);

    expect(result).toBeUndefined();
    expect(deps.octokit.rest.reactions.deleteForIssueComment).not.toHaveBeenCalled();
    expect(deps.octokit.rest.reactions.deleteForPullRequestComment).not.toHaveBeenCalled();
  });

  test('returns undefined when no comment in context', async () => {
    const { deleteReaction } = await reactionsModule;
    const deps = createTestDeps({});

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    const result = await deleteReaction(deps, reaction);

    expect(result).toBeUndefined();
    expect(deps.octokit.rest.reactions.deleteForIssueComment).not.toHaveBeenCalled();
    expect(deps.octokit.rest.reactions.deleteForPullRequestComment).not.toHaveBeenCalled();
  });

  test('uses correct reaction ID from reaction response', async () => {
    const { deleteReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: { id: 999, body: 'test comment' },
    });

    const reaction = {
      data: { id: 99999, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    await deleteReaction(deps, reaction);

    const callArgs = (deps.octokit.rest.reactions.deleteForIssueComment as any).mock
      .calls[0] as any[];
    expect(callArgs[0].reaction_id).toBe(99999);
  });

  test('handles comment ID matching', async () => {
    const { deleteReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: { id: 555, body: 'comment' },
    });

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    await deleteReaction(deps, reaction);

    const callArgs = (deps.octokit.rest.reactions.deleteForIssueComment as any).mock
      .calls[0] as any[];
    expect(callArgs[0].comment_id).toBe(555);
  });

  test('does not call API when both reaction and comment are missing', async () => {
    const { deleteReaction } = await reactionsModule;
    const deps = createTestDeps({});

    await deleteReaction(deps, undefined);

    expect(deps.octokit.rest.reactions.deleteForIssueComment).not.toHaveBeenCalled();
  });

  test('deletes reaction from PR review comment (inline comment)', async () => {
    const { deleteReaction } = await reactionsModule;
    const deps = createTestDeps({
      comment: {
        id: 999,
        body: 'inline comment on code',
        pull_request_review_id: 456,
      },
    });

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    const result = await deleteReaction(deps, reaction);

    expect(result).toBeDefined();
    expect(deps.octokit.rest.reactions.deleteForPullRequestComment).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      comment_id: 999,
      reaction_id: 12345,
    });
    expect(deps.octokit.rest.reactions.deleteForIssueComment).not.toHaveBeenCalled();
  });

  test('returns undefined for pull_request_review event deleteReaction (no comment)', async () => {
    const { deleteReaction } = await reactionsModule;
    const deps = createTestDeps({
      review: { id: 42, body: '/pi review this' },
    });

    const reaction = {
      data: { id: 12345, content: 'eyes' },
      headers: {},
      status: 200,
      url: '',
    } as any;

    const result = await deleteReaction(deps, reaction);

    expect(result).toBeUndefined();
    expect(deps.octokit.rest.reactions.deleteForIssueComment).not.toHaveBeenCalled();
    expect(deps.octokit.rest.reactions.deleteForPullRequestComment).not.toHaveBeenCalled();
  });
});

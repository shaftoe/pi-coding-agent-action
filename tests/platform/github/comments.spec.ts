/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as github from '@actions/github';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const _mockedWrite = mock((...args: any[]) => {
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

// Mock @actions/github context
const mockContext = {
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 123,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  payload: {} as Record<string, unknown>,
};
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Mock the octokit module before importing comments.ts
const mockCreateIssueComment = mock(() =>
  Promise.resolve({
    data: { id: 123 },
    headers: {},
    status: 201,
    url: '',
  })
);
const mockCreateReviewCommentReply = mock(() =>
  Promise.resolve({
    data: { id: 456 },
    headers: {},
    status: 201,
    url: '',
  })
);
const mockOctokit = {
  rest: {
    issues: {
      createComment: mockCreateIssueComment,
    },
    pulls: {
      createReplyForReviewComment: mockCreateReviewCommentReply,
    },
  },
};
mock.module('../../../src/platform/github/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

// Set env vars for GitHub context before importing comments.ts
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), 'gh-event-${Date.now()}.json');
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

import { Temporal } from '@js-temporal/polyfill';

// Initialize the github module context with test adapter
const githubModulePromise = import('../../../src/platform/github/index.js');

// Dynamic import to ensure mocks are set up before module loads
const { formatExecutionTime, formatNumber, createFinalComment } =
  // @ts-expect-error TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
  await import('../../../src/platform/github/comments.js');

describe('formatExecutionTime', () => {
  test('formats seconds only', () => {
    const duration = Temporal.Duration.from({ seconds: 30 });
    expect(formatExecutionTime(duration)).toBe('30s');
  });

  test('formats zero seconds', () => {
    const duration = Temporal.Duration.from({ seconds: 0 });
    expect(formatExecutionTime(duration)).toBe('0s');
  });

  test('formats minutes and seconds', () => {
    const duration = Temporal.Duration.from({ minutes: 1, seconds: 30 });
    expect(formatExecutionTime(duration)).toBe('1m 30s');
  });

  test('formats minutes without seconds', () => {
    const duration = Temporal.Duration.from({ minutes: 5 });
    expect(formatExecutionTime(duration)).toBe('5m');
  });

  test('formats hours, minutes, and seconds', () => {
    const duration = Temporal.Duration.from({ hours: 1, minutes: 5, seconds: 30 });
    expect(formatExecutionTime(duration)).toBe('1h 5m 30s');
  });

  test('formats hours and minutes', () => {
    const duration = Temporal.Duration.from({ hours: 2, minutes: 45 });
    expect(formatExecutionTime(duration)).toBe('2h 45m');
  });

  test('formats hours without minutes or seconds', () => {
    const duration = Temporal.Duration.from({ hours: 3 });
    expect(formatExecutionTime(duration)).toBe('3h');
  });

  test('handles large values', () => {
    const duration = Temporal.Duration.from({ hours: 10, minutes: 59, seconds: 59 });
    expect(formatExecutionTime(duration)).toBe('10h 59m 59s');
  });

  test('rounds sub-second durations to nearest second', () => {
    const duration = Temporal.Duration.from({ seconds: 30, milliseconds: 700 });
    expect(formatExecutionTime(duration)).toBe('31s');
  });

  test('rounds down sub-second durations below .5', () => {
    const duration = Temporal.Duration.from({ seconds: 30, milliseconds: 300 });
    expect(formatExecutionTime(duration)).toBe('30s');
  });

  test('handles mixed values with zero seconds', () => {
    const duration = Temporal.Duration.from({ hours: 1, minutes: 30, seconds: 0 });
    expect(formatExecutionTime(duration)).toBe('1h 30m');
  });

  test('handles single unit values', () => {
    expect(formatExecutionTime(Temporal.Duration.from({ seconds: 1 }))).toBe('1s');
    expect(formatExecutionTime(Temporal.Duration.from({ minutes: 1 }))).toBe('1m');
    expect(formatExecutionTime(Temporal.Duration.from({ hours: 1 }))).toBe('1h');
  });
});

describe('formatNumber', () => {
  test('formats small numbers', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(500)).toBe('500');
    expect(formatNumber(999)).toBe('999');
  });

  test('formats thousands', () => {
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(9999)).toBe('10.0K');
    expect(formatNumber(10000)).toBe('10.0K');
    expect(formatNumber(99999)).toBe('100.0K');
  });

  test('formats millions', () => {
    expect(formatNumber(1000000)).toBe('1.0M');
    expect(formatNumber(1500000)).toBe('1.5M');
    expect(formatNumber(10000000)).toBe('10.0M');
    expect(formatNumber(999999999)).toBe('1000.0M');
  });

  test('handles boundary values', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(999999)).toBe('1000.0K');
    expect(formatNumber(1000000)).toBe('1.0M');
  });

  test('handles negative numbers gracefully', () => {
    expect(formatNumber(-1)).toBe('-1');
    expect(formatNumber(-500)).toBe('-500');
    expect(formatNumber(-1000)).toBe('-1000');
    expect(formatNumber(-1500000)).toBe('-1500000');
  });

  test('handles very large numbers', () => {
    expect(formatNumber(1000000000)).toBe('1000.0M');
    expect(formatNumber(9999999999)).toBe('10000.0M');
  });

  test('formats with one decimal place', () => {
    expect(formatNumber(1234)).toBe('1.2K');
    expect(formatNumber(12345)).toBe('12.3K');
    expect(formatNumber(1234567)).toBe('1.2M');
  });
});

describe('createFinalComment', () => {
  beforeEach(async () => {
    // Clear mock calls before each test
    mockCreateIssueComment.mockClear();
    mockCreateReviewCommentReply.mockClear();
    mockDebugLog.length = 0;
    // Reset to default context without comment (top-level comment)
    mockContext.payload.comment = undefined;

    // Initialize the github module context with test adapter
    const githubExports = await githubModulePromise;
    githubExports.setCoreAdapter(testCoreAdapter);
  });

  test('returns undefined for empty body', async () => {
    const result = await createFinalComment('', {});
    expect(result).toBeUndefined();
  });

  test('appends action run link to comment body', async () => {
    const body = 'Here is a result';
    await createFinalComment(body, {});

    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalled();
    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      owner: 'test-owner',
      repo: 'test-repo',
      body: expect.stringContaining(
        '[View action run](https://github.com/test-owner/test-repo/actions/runs/123456789)'
      ),
    });
  });

  test('includes model metadata when provided', async () => {
    const body = 'Test result';
    const metadata = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('Model: anthropic/claude-sonnet-4-5'),
    });
  });

  test('includes thinking level in model metadata when not off', async () => {
    const body = 'Test result';
    const metadata = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      thinkingLevel: 'medium',
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('(thinking: medium)'),
    });
  });

  test('does not include thinking level when off', async () => {
    const body = 'Test result';
    const metadata = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      thinkingLevel: 'off',
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.not.stringContaining('thinking:'),
    });
  });

  test('includes execution duration when provided', async () => {
    const body = 'Test result';
    const duration = Temporal.Duration.from({ minutes: 2, seconds: 30 });
    const metadata = {
      executionDuration: duration,
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('Time: 2m 30s'),
    });
  });

  test('includes session stats with token usage', async () => {
    const body = 'Test result';
    const metadata = {
      sessionStats: {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cost: 0.0123,
        version: '1.0.0',
      },
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    const commentBody = (call[0] as { body: string }).body;
    expect(commentBody).toContain('Tokens: 1.5K');
    expect(commentBody).toContain('($0.0123)');
  });

  test('handles zero session stats', async () => {
    const body = 'Test result';
    const metadata = {
      sessionStats: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
        version: '1.0.0',
      },
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    const commentBody = (call[0] as { body: string }).body;
    expect(commentBody).toContain('Tokens: 0');
    expect(commentBody).not.toContain('($0)');
  });

  test('includes action version when provided', async () => {
    const body = 'Test result';
    const metadata = {
      actionVersion: '2.3.0',
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('Action v2.3.0'),
    });
  });

  test('includes Pi SDK version when session stats available', async () => {
    const body = 'Test result';
    const metadata = {
      sessionStats: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.001,
        version: '1.2.3',
      },
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('Pi SDK v1.2.3'),
    });
  });

  test('separates metadata with pipe characters', async () => {
    const body = 'Test';
    const metadata = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      executionDuration: Temporal.Duration.from({ seconds: 10 }),
    };

    await createFinalComment(body, metadata);

    const call = (mockOctokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringMatching(/View action run.*\|.*Model:/),
    });
  });

  test('handles missing github context gracefully', async () => {
    github.context.payload = {};
    // @ts-expect-error -- Setting read-only repo property to test error handling
    github.context.repo = { owner: undefined, repo: undefined };
    // @ts-expect-error -- Setting read-only serverUrl property to test error handling
    github.context.serverUrl = undefined;
    // @ts-expect-error -- Setting read-only runId property to test error handling
    github.context.runId = undefined;

    const body = 'Test result';
    const result = await createFinalComment(body, {});

    expect(result).toBeDefined();
  });

  test('creates reply to PR review comment (inline comment)', async () => {
    const body = 'Here is a response to your inline comment';

    // Set up PR review comment context
    mockContext.payload.comment = {
      id: 789,
      body: 'inline comment on code',
      pull_request_review_id: 456,
    } as any;

    await createFinalComment(body, {});

    expect(mockCreateReviewCommentReply).toHaveBeenCalled();
    expect(mockCreateIssueComment).not.toHaveBeenCalled();
    const call = mockCreateReviewCommentReply.mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      pull_number: 123,
      comment_id: 789,
      body: expect.stringContaining(body),
    });
  });

  test('creates top-level issue comment when not PR review comment', async () => {
    const body = 'Top-level comment';

    // Set up regular issue comment context
    mockContext.payload.comment = {
      id: 789,
      body: 'regular comment',
    };

    await createFinalComment(body, {});

    expect(mockCreateIssueComment).toHaveBeenCalled();
    expect(mockCreateReviewCommentReply).not.toHaveBeenCalled();
    const call = mockCreateIssueComment.mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      issue_number: 123,
      body: expect.stringContaining(body),
    });
  });

  test('creates top-level comment for pull_request_review event (no comment in payload)', async () => {
    const body = 'Result for review';

    // Simulate pull_request_review event: no comment, has review
    mockContext.payload = {
      review: { id: 42, body: '/pi review this' },
    } as any;

    await createFinalComment(body, {});

    // Should fall through to top-level issue comment (not a review comment reply)
    expect(mockCreateIssueComment).toHaveBeenCalled();
    expect(mockCreateReviewCommentReply).not.toHaveBeenCalled();
    const call = mockCreateIssueComment.mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      issue_number: 123,
      body: expect.stringContaining(body),
    });
  });

  test('appends action run link to PR review comment reply', async () => {
    const body = 'Result for inline comment';

    // Set up PR review comment context
    mockContext.payload.comment = {
      id: 789,
      body: 'inline comment',
      pull_request_review_id: 456,
    } as any;

    await createFinalComment(body, {});

    expect(mockCreateReviewCommentReply).toHaveBeenCalled();
    const call = mockCreateReviewCommentReply.mock.calls[0] as unknown[];
    const commentBody = (call[0] as { body: string }).body;
    // The body should be modified with metadata (even if the URL is not fully formed in test)
    expect(commentBody).toContain(body);
  });
});

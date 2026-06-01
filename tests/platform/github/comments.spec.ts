/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock, beforeEach } from 'bun:test';

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

// Mock @actions/core (transitive only)
const noop = (): void => {};
mock.module('@actions/core', () => ({
  getInput: mock(() => ''),
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  setOutput: mock(noop),
  warning: mock(noop),
  error: mock(noop),
}));

mock.module('@actions/github', () => ({
  context: {},
}));

import { Temporal } from '@js-temporal/polyfill';
import type { GitHubModuleDeps } from '../../../src/platform/github/types';

// Dynamic import to ensure mocks are set up before module loads
const commentsModule = import('../../../src/platform/github/comments.js');

function createTestDeps(payload: Record<string, unknown> = {}): GitHubModuleDeps & {
  octokit: {
    rest: {
      issues: { createComment: ReturnType<typeof mock> };
      pulls: { createReplyForReviewComment: ReturnType<typeof mock> };
    };
  };
} {
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

  return {
    octokit: {
      rest: {
        issues: {
          createComment: mockCreateIssueComment,
        },
        pulls: {
          createReplyForReviewComment: mockCreateReviewCommentReply,
        },
      },
    } as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 123 },
      eventName: 'issue_comment',
      payload,
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp',
    },
    logger: {
      debug: noop,
      info: noop,
      warning: noop,
      notice: noop,
      error: noop,
    },
  };
}

// @ts-expect-error TS1309 -- Top-level await in Bun test runner
const { formatExecutionTime, formatNumber, createFinalComment } = await commentsModule;

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
  beforeEach(() => {
    // No need to reset module context anymore
  });

  test('returns undefined for empty body', async () => {
    const deps = createTestDeps();
    const result = await createFinalComment(deps, '', {});
    expect(result).toBeUndefined();
  });

  test('appends action run link to comment body', async () => {
    const deps = createTestDeps();
    const body = 'Here is a result';
    await createFinalComment(deps, body, {});

    expect(deps.octokit.rest.issues.createComment).toHaveBeenCalled();
    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      owner: 'test-owner',
      repo: 'test-repo',
      body: expect.stringContaining(
        '[View action run](https://github.com/test-owner/test-repo/actions/runs/123456789)'
      ),
    });
  });

  test('includes model metadata when provided', async () => {
    const deps = createTestDeps();
    const body = 'Test result';
    const metadata = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    };

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('Model: anthropic/claude-sonnet-4-5'),
    });
  });

  test('includes thinking level in model metadata when not off', async () => {
    const deps = createTestDeps();
    const body = 'Test result';
    const metadata = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      thinkingLevel: 'medium',
    };

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('(thinking: medium)'),
    });
  });

  test('does not include thinking level when off', async () => {
    const deps = createTestDeps();
    const body = 'Test result';
    const metadata = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      thinkingLevel: 'off',
    };

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.not.stringContaining('thinking:'),
    });
  });

  test('includes execution duration when provided', async () => {
    const deps = createTestDeps();
    const body = 'Test result';
    const duration = Temporal.Duration.from({ minutes: 2, seconds: 30 });
    const metadata = {
      executionDuration: duration,
    };

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('Time: 2m 30s'),
    });
  });

  test('includes session stats with token usage', async () => {
    const deps = createTestDeps();
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

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    const commentBody = (call[0] as { body: string }).body;
    expect(commentBody).toContain('Tokens: 1.5K');
    expect(commentBody).toContain('($0.0123)');
  });

  test('handles zero session stats', async () => {
    const deps = createTestDeps();
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

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    const commentBody = (call[0] as { body: string }).body;
    expect(commentBody).toContain('Tokens: 0');
    expect(commentBody).not.toContain('($0)');
  });

  test('includes action version when provided', async () => {
    const deps = createTestDeps();
    const body = 'Test result';
    const metadata = {
      actionVersion: '2.3.0',
    };

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('Action v2.3.0'),
    });
  });

  test('includes Pi SDK version when session stats available', async () => {
    const deps = createTestDeps();
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

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringContaining('Pi SDK v1.2.3'),
    });
  });

  test('separates metadata with pipe characters', async () => {
    const deps = createTestDeps();
    const body = 'Test';
    const metadata = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      executionDuration: Temporal.Duration.from({ seconds: 10 }),
    };

    await createFinalComment(deps, body, metadata);

    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      body: expect.stringMatching(/View action run.*\|.*Model:/),
    });
  });

  test('creates reply to PR review comment (inline comment)', async () => {
    const deps = createTestDeps({
      comment: {
        id: 789,
        body: 'inline comment on code',
        pull_request_review_id: 456,
      },
    });

    const body = 'Here is a response to your inline comment';
    await createFinalComment(deps, body, {});

    expect(deps.octokit.rest.pulls.createReplyForReviewComment).toHaveBeenCalled();
    expect(deps.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    const call = (deps.octokit.rest.pulls.createReplyForReviewComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      pull_number: 123,
      comment_id: 789,
      body: expect.stringContaining(body),
    });
  });

  test('creates top-level issue comment when not PR review comment', async () => {
    const deps = createTestDeps({
      comment: {
        id: 789,
        body: 'regular comment',
      },
    });

    const body = 'Top-level comment';
    await createFinalComment(deps, body, {});

    expect(deps.octokit.rest.issues.createComment).toHaveBeenCalled();
    expect(deps.octokit.rest.pulls.createReplyForReviewComment).not.toHaveBeenCalled();
    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      issue_number: 123,
      body: expect.stringContaining(body),
    });
  });

  test('creates top-level comment for pull_request_review event (no comment in payload)', async () => {
    const deps = createTestDeps({
      review: { id: 42, body: '/pi review this' },
    });

    const body = 'Result for review';
    await createFinalComment(deps, body, {});

    // Should fall through to top-level issue comment (not a review comment reply)
    expect(deps.octokit.rest.issues.createComment).toHaveBeenCalled();
    expect(deps.octokit.rest.pulls.createReplyForReviewComment).not.toHaveBeenCalled();
    const call = (deps.octokit.rest.issues.createComment as any).mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      issue_number: 123,
      body: expect.stringContaining(body),
    });
  });

  test('appends action run link to PR review comment reply', async () => {
    const deps = createTestDeps({
      comment: {
        id: 789,
        body: 'inline comment',
        pull_request_review_id: 456,
      },
    });

    const body = 'Result for inline comment';
    await createFinalComment(deps, body, {});

    expect(deps.octokit.rest.pulls.createReplyForReviewComment).toHaveBeenCalled();
    const call = (deps.octokit.rest.pulls.createReplyForReviewComment as any).mock.calls[0] as unknown[];
    const commentBody = (call[0] as { body: string }).body;
    expect(commentBody).toContain(body);
  });

  test('returns undefined when no issue/PR number in context (unattended mode)', async () => {
    const deps = createTestDeps({
      comment: { id: 999, body: 'test' },
    });
    // Override issue number
    (deps.context as any).issue = { number: undefined };

    const body = 'Test result from unattended pipeline';
    const result = await createFinalComment(deps, body, {});

    expect(result).toBeUndefined();
    expect(deps.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(deps.octokit.rest.pulls.createReplyForReviewComment).not.toHaveBeenCalled();
  });

  test('returns undefined when issue number is 0 (unattended mode)', async () => {
    const deps = createTestDeps({
      comment: { id: 999, body: 'test' },
    });
    (deps.context as any).issue = { number: 0 };

    const body = 'Test result from unattended pipeline';
    const result = await createFinalComment(deps, body, {});

    expect(result).toBeUndefined();
    expect(deps.octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(deps.octokit.rest.pulls.createReplyForReviewComment).not.toHaveBeenCalled();
  });
});

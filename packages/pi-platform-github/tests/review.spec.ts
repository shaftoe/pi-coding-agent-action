/**
 * @file Tests for the createReview function (full integration with deps).
 *
 * Validates the createReview function that creates a GitHub PR review
 * with inline comments.
 */

import { describe, expect, test, vi } from 'vitest';
import { createReview } from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

function createReviewDeps(overrides: { issueNumber?: number } = {}): GitHubModuleDeps & {
  octokit: {
    rest: {
      pulls: {
        createReview: ReturnType<typeof vi.fn>;
      };
    };
  };
} {
  return {
    octokit: {
      rest: {
        pulls: {
          createReview: vi.fn(() =>
            Promise.resolve({
              data: {
                id: 999,
                html_url: 'https://github.com/test-owner/test-repo/pull/42#pullrequestreview-999',
              },
              status: 200,
            })
          ),
        },
      },
    } as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: overrides.issueNumber ?? 42 },
      eventName: 'pull_request',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp',
    },
    logger: {
      debug: vi.fn(() => {}),
      info: vi.fn(() => {}),
      warning: vi.fn(() => {}),
      notice: vi.fn(() => {}),
      error: vi.fn(() => {}),
    },
  };
}

describe('createReview', () => {
  test('creates a review with single inline comment', async () => {
    const deps = createReviewDeps();
    const result = await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 10, body: 'Looks good' }],
    });

    expect(result.content[0]!.text).toContain('Review created on PR #42');
    expect(result.details).toMatchObject({
      reviewId: 999,
      pullRequestNumber: 42,
      event: 'COMMENT',
      commentCount: 1,
    });
  });

  test('creates a review with explicit pull_number', async () => {
    const deps = createReviewDeps();
    const result = await createReview(deps, {
      pull_number: 100,
      comments: [{ path: 'src/main.ts', line: 5, body: 'Fix this' }],
    });

    expect(result.details.pullRequestNumber).toBe(100);
    const callArgs = (deps.octokit.rest.pulls.createReview as any).mock.calls[0][0];
    expect(callArgs.pull_number).toBe(100);
  });

  test('uses pull_number from context when not provided', async () => {
    const deps = createReviewDeps({ issueNumber: 77 });
    const result = await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 1, body: 'Test' }],
    });

    expect(result.details.pullRequestNumber).toBe(77);
    const callArgs = (deps.octokit.rest.pulls.createReview as any).mock.calls[0][0];
    expect(callArgs.pull_number).toBe(77);
  });

  test('creates an APPROVE review', async () => {
    const deps = createReviewDeps();
    const result = await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 1, body: 'LGTM' }],
      event: 'APPROVE',
    });

    expect(result.details.event).toBe('APPROVE');
    const callArgs = (deps.octokit.rest.pulls.createReview as any).mock.calls[0][0];
    expect(callArgs.event).toBe('APPROVE');
  });

  test('creates a REQUEST_CHANGES review', async () => {
    const deps = createReviewDeps();
    const result = await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 1, body: 'Fix needed' }],
      event: 'REQUEST_CHANGES',
    });

    expect(result.details.event).toBe('REQUEST_CHANGES');
  });

  test('defaults to COMMENT event', async () => {
    const deps = createReviewDeps();
    const result = await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 1, body: 'Note' }],
    });

    expect(result.details.event).toBe('COMMENT');
  });

  test('includes body in review', async () => {
    const deps = createReviewDeps();
    await createReview(deps, {
      body: 'Overall looks good but a few nits',
      comments: [{ path: 'src/main.ts', line: 1, body: 'Nit' }],
    });

    const callArgs = (deps.octokit.rest.pulls.createReview as any).mock.calls[0][0];
    expect(callArgs.body).toBe('Overall looks good but a few nits');
  });

  test('defaults body to empty string', async () => {
    const deps = createReviewDeps();
    await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 1, body: 'Test' }],
    });

    const callArgs = (deps.octokit.rest.pulls.createReview as any).mock.calls[0][0];
    expect(callArgs.body).toBe('');
  });

  test('maps multi-line comment with start_line', async () => {
    const deps = createReviewDeps();
    await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 15, start_line: 10, body: 'Multi-line issue' }],
    });

    const callArgs = (deps.octokit.rest.pulls.createReview as any).mock.calls[0][0];
    const reviewComment = callArgs.comments[0];
    expect(reviewComment).toMatchObject({
      path: 'src/main.ts',
      line: 15,
      start_line: 10,
      side: 'RIGHT',
      start_side: 'RIGHT',
    });
  });

  test('maps comment with explicit LEFT side', async () => {
    const deps = createReviewDeps();
    await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 10, side: 'LEFT', body: 'Old code' }],
    });

    const callArgs = (deps.octokit.rest.pulls.createReview as any).mock.calls[0][0];
    expect(callArgs.comments[0].side).toBe('LEFT');
  });

  test('throws when pull_number not available in context', async () => {
    const deps = createReviewDeps({ issueNumber: 0 });
    (deps.context as any).issue = { number: 0 };

    await expect(
      createReview(deps, {
        comments: [{ path: 'src/main.ts', line: 1, body: 'Test' }],
      })
    ).rejects.toThrow(/Pull request number not provided/);
  });

  test('returns correct review URL from API response', async () => {
    const deps = createReviewDeps();
    const result = await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 1, body: 'Test' }],
    });

    expect(result.details.reviewUrl).toBe(
      'https://github.com/test-owner/test-repo/pull/42#pullrequestreview-999'
    );
  });

  test('creates review with multiple comments', async () => {
    const deps = createReviewDeps();
    const result = await createReview(deps, {
      comments: [
        { path: 'src/a.ts', line: 10, body: 'Comment A' },
        { path: 'src/b.ts', line: 20, body: 'Comment B' },
        { path: 'src/c.ts', line: 30, side: 'LEFT', body: 'Comment C' },
      ],
    });

    expect(result.details.commentCount).toBe(3);
    const callArgs = (deps.octokit.rest.pulls.createReview as any).mock.calls[0][0];
    expect(callArgs.comments).toHaveLength(3);
  });

  test('success message includes review URL', async () => {
    const deps = createReviewDeps();
    const result = await createReview(deps, {
      comments: [{ path: 'src/main.ts', line: 1, body: 'Test' }],
    });

    expect(result.content[0]!.text).toContain(
      'https://github.com/test-owner/test-repo/pull/42#pullrequestreview-999'
    );
  });
});

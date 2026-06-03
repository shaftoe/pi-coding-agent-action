/**
 * @file Tests for issue/PR thread data fetching.
 *
 * Covers resolveThreadParams, fetchIssueData, fetchPRData, transformComment,
 * fetchThreadComments, fetchPRReviewComments, determineThreadState,
 * buildThreadResult, and the top-level getIssueOrPRThread function.
 */

import { describe, expect, test, mock } from 'bun:test';
import { getIssueOrPRThread } from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps, IssueOrPRThread } from '@alexanderfortin/pi-platform-github';

function createMockDeps(
  overrides: {
    issueNumber?: number;
    payload?: Record<string, unknown>;
    owner?: string;
    repo?: string;
  } = {}
): GitHubModuleDeps {
  const owner = overrides.owner ?? 'test-owner';
  const repo = overrides.repo ?? 'test-repo';
  const number = overrides.issueNumber ?? 42;

  const mockIssuesGet = mock(() =>
    Promise.resolve({
      data: {
        number,
        title: 'Test Issue',
        body: 'Test body',
        state: 'open',
        user: { login: 'testuser', type: 'User' },
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        closed_at: null,
        labels: [{ name: 'bug' }, { name: 'help wanted' }],
        pull_request: undefined,
      },
      status: 200,
    })
  );

  const mockIssuesListComments = mock(() =>
    Promise.resolve({
      data: [],
    })
  );

  const mockPullsGet = mock(() =>
    Promise.resolve({
      data: {
        number,
        head: { ref: 'feature-branch', sha: 'abc123' },
        base: { ref: 'main' },
        merged_at: null,
        html_url: `https://github.com/${owner}/${repo}/pull/${number}`,
      },
      status: 200,
    })
  );

  const mockPullsListReviewComments = mock(() =>
    Promise.resolve({
      data: [],
    })
  );

  return {
    octokit: {
      rest: {
        issues: {
          get: mockIssuesGet,
          listComments: mockIssuesListComments,
        },
        pulls: {
          get: mockPullsGet,
          listReviewComments: mockPullsListReviewComments,
        },
      },
    } as any,
    context: {
      repo: { owner, repo },
      issue: { number },
      eventName: 'issue_comment',
      payload: overrides.payload ?? {},
      serverUrl: 'https://github.com',
      runId: 123456789,
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

function asThread(result: IssueOrPRThread | undefined): IssueOrPRThread {
  expect(result).toBeDefined();
  return result!;
}

describe('getIssueOrPRThread', () => {
  test('returns undefined when owner, repo, and issue_number are all missing', async () => {
    const deps = createMockDeps({ issueNumber: 0 });
    (deps.context as any).issue = { number: 0 };
    (deps.context as any).repo = { owner: '', repo: '' };

    const result = await getIssueOrPRThread(deps, {});
    expect(result).toBeUndefined();
  });

  test('fetches issue data for a regular issue', async () => {
    const deps = createMockDeps({ issueNumber: 42 });
    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.number).toBe(42);
    expect(result.title).toBe('Test Issue');
    expect(result.body).toBe('Test body');
    expect(result.state).toBe('open');
    expect(result.author).toBe('testuser');
    expect(result.author_type).toBe('user');
    expect(result.is_pull_request).toBe(false);
    expect(result.labels).toEqual(['bug', 'help wanted']);
    expect(result.comments).toEqual([]);
    expect(result.review_comments).toEqual([]);
  });

  test('fetches PR data when issue is a pull request', async () => {
    const deps = createMockDeps({ issueNumber: 99 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 99,
          title: 'Test PR',
          body: 'PR body',
          state: 'open',
          user: { login: 'dev', type: 'User' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: null,
          labels: [],
          pull_request: { url: 'https://api.github.com/repos/test/pulls/99' },
        },
        status: 200,
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.is_pull_request).toBe(true);
    expect(result.head_branch).toBe('feature-branch');
    expect(result.base_branch).toBe('main');
    expect(result.head_sha).toBe('abc123');
    expect(deps.octokit.rest.pulls.get).toHaveBeenCalled();
  });

  test('handles merged PR state', async () => {
    const deps = createMockDeps({ issueNumber: 100 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 100,
          title: 'Merged PR',
          body: null,
          state: 'closed',
          user: { login: 'dev', type: 'User' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: '2025-01-03T00:00:00Z',
          labels: [],
          pull_request: { url: 'https://api.github.com/repos/test/pulls/100' },
        },
        status: 200,
      })
    );
    (deps.octokit.rest.pulls.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 100,
          head: { ref: 'fix', sha: 'def456' },
          base: { ref: 'main' },
          merged_at: '2025-01-03T00:00:00Z',
          html_url: 'https://github.com/test/repo/pull/100',
        },
        status: 200,
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.state).toBe('merged');
    expect(result.merged_at).toBe('2025-01-03T00:00:00Z');
  });

  test('returns closed state for non-merged closed PR', async () => {
    const deps = createMockDeps({ issueNumber: 101 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 101,
          title: 'Closed PR',
          body: null,
          state: 'closed',
          user: { login: 'dev', type: 'User' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: '2025-01-03T00:00:00Z',
          labels: [],
          pull_request: { url: 'https://api.github.com/repos/test/pulls/101' },
        },
        status: 200,
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));
    expect(result.state).toBe('closed');
  });

  test('fetches comments for issues', async () => {
    const deps = createMockDeps({ issueNumber: 42 });
    (deps.octokit.rest.issues.listComments as any).mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: 1,
            user: { login: 'alice', type: 'User' },
            created_at: '2025-01-01T12:00:00Z',
            updated_at: null,
            body: 'First comment',
          },
          {
            id: 2,
            user: { login: 'bob', type: 'Bot' },
            created_at: '2025-01-01T13:00:00Z',
            updated_at: '2025-01-01T14:00:00Z',
            body: 'Bot comment',
          },
        ],
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]!).toMatchObject({
      id: 1,
      author: 'alice',
      author_type: 'user',
      body: 'First comment',
      is_triggering_comment: false,
    });
    expect(result.comments[0]).not.toHaveProperty('updated_at');
    expect(result.comments[1]!).toMatchObject({
      id: 2,
      author: 'bob',
      author_type: 'bot',
      body: 'Bot comment',
      updated_at: '2025-01-01T14:00:00Z',
    });
  });

  test('identifies triggering comment from payload', async () => {
    const deps = createMockDeps({
      issueNumber: 42,
      payload: { comment: { id: 5 } },
    });
    (deps.octokit.rest.issues.listComments as any).mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: 4,
            user: { login: 'alice', type: 'User' },
            created_at: '2025-01-01T12:00:00Z',
            updated_at: null,
            body: 'Earlier comment',
          },
          {
            id: 5,
            user: { login: 'bob', type: 'User' },
            created_at: '2025-01-01T13:00:00Z',
            updated_at: null,
            body: 'Triggering comment',
          },
        ],
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.comments[0]!.is_triggering_comment).toBe(false);
    expect(result.comments[1]!.is_triggering_comment).toBe(true);
  });

  test('identifies triggering comment from review in payload', async () => {
    const deps = createMockDeps({
      issueNumber: 42,
      payload: { review: { id: 10 } },
    });
    (deps.octokit.rest.issues.listComments as any).mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: 10,
            user: { login: 'alice', type: 'User' },
            created_at: '2025-01-01T12:00:00Z',
            updated_at: null,
            body: 'Review comment',
          },
        ],
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));
    expect(result.comments[0]!.is_triggering_comment).toBe(true);
  });

  test('stops fetching when page returns fewer items than perPage', async () => {
    const deps = createMockDeps({ issueNumber: 42 });

    // With max_comments=10, perPage=10. First page returns 3 (< perPage), so no second page.
    let callCount = 0;
    (deps.octokit.rest.issues.listComments as any).mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        data: [
          {
            id: 1,
            user: { login: 'u1' },
            created_at: '2025-01-01T00:00:00Z',
            updated_at: null,
            body: 'c1',
          },
          {
            id: 2,
            user: { login: 'u2' },
            created_at: '2025-01-01T00:00:00Z',
            updated_at: null,
            body: 'c2',
          },
          {
            id: 3,
            user: { login: 'u3' },
            created_at: '2025-01-01T00:00:00Z',
            updated_at: null,
            body: 'c3',
          },
        ],
      });
    });

    const result = asThread(await getIssueOrPRThread(deps, { max_comments: 10 }));

    expect(result.comments).toHaveLength(3);
    expect(callCount).toBe(1);
  });

  test('respects max_comments limit', async () => {
    const deps = createMockDeps({ issueNumber: 42 });
    (deps.octokit.rest.issues.listComments as any).mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: 1,
            user: { login: 'u1' },
            created_at: '2025-01-01T00:00:00Z',
            updated_at: null,
            body: 'c1',
          },
          {
            id: 2,
            user: { login: 'u2' },
            created_at: '2025-01-01T00:00:00Z',
            updated_at: null,
            body: 'c2',
          },
          {
            id: 3,
            user: { login: 'u3' },
            created_at: '2025-01-01T00:00:00Z',
            updated_at: null,
            body: 'c3',
          },
        ],
      })
    );

    const result = asThread(await getIssueOrPRThread(deps, { max_comments: 2 }));

    expect(result.comments).toHaveLength(2);
  });

  test('fetches review comments for pull requests', async () => {
    const deps = createMockDeps({ issueNumber: 55 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 55,
          title: 'PR with review comments',
          body: '',
          state: 'open',
          user: { login: 'dev', type: 'User' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: null,
          labels: [],
          pull_request: { url: 'https://api.github.com/repos/test/pulls/55' },
        },
        status: 200,
      })
    );
    (deps.octokit.rest.pulls.listReviewComments as any).mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: 100,
            path: 'src/main.ts',
            line: 10,
            side: 'RIGHT',
            user: { login: 'reviewer', type: 'User' },
            created_at: '2025-01-02T00:00:00Z',
            body: 'Inline comment',
          },
          {
            id: 101,
            path: 'src/util.ts',
            line: 5,
            original_line: 5,
            side: 'LEFT',
            user: { login: 'bot', type: 'Bot' },
            created_at: '2025-01-02T00:00:00Z',
            body: 'Reply',
            in_reply_to_id: 100,
          },
        ],
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.review_comments).toHaveLength(2);
    expect(result.review_comments[0]!).toMatchObject({
      id: 100,
      path: 'src/main.ts',
      line: 10,
      side: 'RIGHT',
      author: 'reviewer',
      author_type: 'user',
      body: 'Inline comment',
    });
    expect(result.review_comments[1]!).toMatchObject({
      id: 101,
      path: 'src/util.ts',
      line: 5,
      side: 'LEFT',
      author: 'bot',
      author_type: 'bot',
      in_reply_to_id: 100,
    });
  });

  test('handles failed PR data fetch gracefully', async () => {
    const deps = createMockDeps({ issueNumber: 60 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 60,
          title: 'PR with failing fetch',
          body: '',
          state: 'open',
          user: { login: 'dev', type: 'User' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: null,
          labels: [],
          pull_request: { url: 'https://api.github.com/repos/test/pulls/60' },
        },
        status: 200,
      })
    );
    (deps.octokit.rest.pulls.get as any).mockImplementation(() => {
      throw new Error('API failure');
    });

    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.is_pull_request).toBe(true);
    expect(result.head_branch).toBeUndefined();
    expect(result.base_branch).toBeUndefined();
  });

  test('handles failed review comments fetch gracefully', async () => {
    const deps = createMockDeps({ issueNumber: 61 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 61,
          title: 'PR with failing review comments',
          body: '',
          state: 'open',
          user: { login: 'dev', type: 'User' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: null,
          labels: [],
          pull_request: { url: 'https://api.github.com/repos/test/pulls/61' },
        },
        status: 200,
      })
    );
    (deps.octokit.rest.pulls.listReviewComments as any).mockImplementation(() => {
      throw new Error('Review comments API failure');
    });

    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.review_comments).toEqual([]);
  });

  test('returns undefined for 404 error', async () => {
    const deps = createMockDeps({ issueNumber: 404 });
    const error = new Error('Not Found') as any;
    error.status = 404;
    (deps.octokit.rest.issues.get as any).mockImplementation(() => {
      throw error;
    });

    const result = await getIssueOrPRThread(deps);
    expect(result).toBeUndefined();
  });

  test('re-throws non-404 errors', async () => {
    const deps = createMockDeps({ issueNumber: 500 });
    const error = new Error('Internal Server Error') as any;
    error.status = 500;
    (deps.octokit.rest.issues.get as any).mockImplementation(() => {
      throw error;
    });

    await expect(getIssueOrPRThread(deps)).rejects.toThrow('Internal Server Error');
  });

  test('uses params to override context defaults', async () => {
    const deps = createMockDeps({ issueNumber: 1, owner: 'default-owner', repo: 'default-repo' });
    await getIssueOrPRThread(deps, {
      owner: 'other-owner',
      repo: 'other-repo',
      issue_number: 99,
    });

    const callArgs = (deps.octokit.rest.issues.get as any).mock.calls[0][0];
    expect(callArgs.owner).toBe('other-owner');
    expect(callArgs.repo).toBe('other-repo');
    expect(callArgs.issue_number).toBe(99);
  });

  test('handles labels as strings', async () => {
    const deps = createMockDeps({ issueNumber: 42 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 42,
          title: 'String Labels',
          body: '',
          state: 'open',
          user: { login: 'dev', type: 'User' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: null,
          labels: ['bug', 'enhancement'],
          pull_request: undefined,
        },
        status: 200,
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));
    expect(result.labels).toEqual(['bug', 'enhancement']);
  });

  test('handles missing user gracefully', async () => {
    const deps = createMockDeps({ issueNumber: 42 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 42,
          title: 'No User',
          body: null,
          state: 'open',
          user: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: null,
          labels: [],
          pull_request: undefined,
        },
        status: 200,
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));
    expect(result.author).toBe('unknown');
    expect(result.author_type).toBe('user');
  });

  test('handles null comment body', async () => {
    const deps = createMockDeps({ issueNumber: 42 });
    (deps.octokit.rest.issues.listComments as any).mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: 1,
            user: { login: 'alice' },
            created_at: '2025-01-01T00:00:00Z',
            updated_at: null,
            body: null,
          },
        ],
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));
    expect(result.comments[0]!.body).toBe('');
  });

  test('handles review comment with null line (falls back to original_line)', async () => {
    const deps = createMockDeps({ issueNumber: 42 });
    (deps.octokit.rest.issues.get as any).mockImplementation(() =>
      Promise.resolve({
        data: {
          number: 42,
          title: 'PR',
          body: '',
          state: 'open',
          user: { login: 'dev', type: 'User' },
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          closed_at: null,
          labels: [],
          pull_request: { url: 'https://api.github.com/repos/test/pulls/42' },
        },
        status: 200,
      })
    );
    (deps.octokit.rest.pulls.listReviewComments as any).mockImplementation(() =>
      Promise.resolve({
        data: [
          {
            id: 200,
            path: 'src/file.ts',
            line: null,
            original_line: 42,
            side: null,
            user: { login: 'reviewer' },
            created_at: '2025-01-02T00:00:00Z',
            body: 'No side',
          },
        ],
      })
    );

    const result = asThread(await getIssueOrPRThread(deps));
    expect(result.review_comments[0]!.line).toBe(42);
    expect(result.review_comments[0]!.side).toBe('RIGHT');
  });

  test('uses defaults for PR-specific fields on issues', async () => {
    const deps = createMockDeps({ issueNumber: 42 });
    const result = asThread(await getIssueOrPRThread(deps));

    expect(result.is_pull_request).toBe(false);
    expect(result.head_branch).toBeUndefined();
    expect(result.base_branch).toBeUndefined();
    expect(result.head_sha).toBeUndefined();
    expect(result.merged_at).toBeUndefined();
  });

  test('resolves params from context when not explicitly provided', async () => {
    const deps = createMockDeps({ issueNumber: 77, owner: 'my-org', repo: 'my-repo' });
    await getIssueOrPRThread(deps);

    const callArgs = (deps.octokit.rest.issues.get as any).mock.calls[0][0];
    expect(callArgs.owner).toBe('my-org');
    expect(callArgs.repo).toBe('my-repo');
    expect(callArgs.issue_number).toBe(77);
  });
});

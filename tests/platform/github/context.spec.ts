import { describe, expect, test, mock } from 'bun:test';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations
const realStdoutWrite = process.stdout.write.bind(process.stdout);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

import type { GitHubModuleDeps } from '../../../src/platform/github/types';
import type { PlatformContext } from '../../../src/platform/types';

function createTestDeps(
  contextOverrides: Partial<PlatformContext> = {}
): GitHubModuleDeps {
  const payload: Record<string, unknown> =
    (contextOverrides.payload as Record<string, unknown>) ?? {};
  return {
    octokit: {} as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'issue_comment',
      payload,
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp',
      ...contextOverrides,
    },
    logger: {
      getInput: () => '/pi',
      debug: noop,
      info: noop,
      warning: noop,
      notice: noop,
      error: noop,
    } as any,
  };
}

// Dynamic imports
const contextModule = import('../../../src/platform/github/context.js');
const githubModule = import('../../../src/platform/github/index.js');

describe('getPrompt', () => {
  test('returns undefined when no comment in payload', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({ eventName: 'issue_comment', payload: {} });
    const result = await getPrompt(deps);
    expect(result).toBeUndefined();
  });

  test('returns enriched prompt with issue context', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'issue_comment',
      payload: {
        comment: { id: 1, body: '/pi Review this' },
        issue: {
          number: 42,
          title: 'Test Issue',
          body: 'Test description',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #42: Test Issue');
    expect(result).toContain('Description:');
    expect(result).toContain('Test description');
    expect(result).toContain('Comment/Instruction:');
    expect(result).toContain('Review this');
  });

  test('returns only comment body when no issue context', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'issue_comment',
      payload: {
        comment: { id: 1, body: '/pi Just comment' },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBe('Just comment');
  });

  test('returns enriched prompt with PR context', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request',
      payload: {
        comment: { id: 1, body: '/pi Review this PR' },
        pull_request: {
          number: 123,
          title: 'Fix bug',
          body: 'This PR fixes the bug',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #123: Fix bug');
    expect(result).toContain('Description:');
    expect(result).toContain('This PR fixes the bug');
  });

  test('returns enriched prompt from pull_request_review event', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review',
      payload: {
        review: { id: 99, body: '/pi Review this please' },
        pull_request: {
          number: 55,
          title: 'Add feature',
          body: 'Feature description',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #55: Add feature');
    expect(result).toContain('Feature description');
    expect(result).toContain('Review this please');
  });

  test('strips trigger from pull_request_review body', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review',
      payload: {
        review: { id: 99, body: '/pi Review this please' },
        pull_request: {
          number: 55,
          title: 'Add feature',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeDefined();
    expect(result).not.toContain('/pi');
    expect(result).toContain('Review this please');
  });

  test('returns undefined for pull_request_review with null body (approve-only)', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review',
      payload: {
        review: { id: 99, body: null },
        pull_request: {
          number: 55,
          title: 'Add feature',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeUndefined();
  });

  test('returns undefined for pull_request_review with empty string body', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review',
      payload: {
        review: { id: 99, body: '' },
        pull_request: {
          number: 55,
          title: 'Add feature',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeUndefined();
  });

  test('returns enriched prompt from pull_request_review_comment event', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review_comment',
      payload: {
        comment: { id: 200, body: '/pi Fix this line', pull_request_review_id: 99 },
        pull_request: {
          number: 77,
          title: 'Bugfix PR',
          body: 'Fixes a bug',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #77: Bugfix PR');
    expect(result).toContain('Fix this line');
  });

  test('strips trigger from pull_request_review_comment body', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review_comment',
      payload: {
        comment: { id: 200, body: '/pi Fix this line', pull_request_review_id: 99 },
        pull_request: {
          number: 77,
          title: 'Bugfix PR',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeDefined();
    expect(result).not.toContain('/pi');
    expect(result).toContain('Fix this line');
  });

  test('returns undefined when comment is empty', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      payload: {
        comment: { id: 1, body: '/pi' },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeUndefined();
  });

  test('strips trigger from comment body', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      payload: {
        comment: { id: 1, body: '/pi Review this' },
      },
    });

    const result = await getPrompt(deps);
    expect(result).not.toContain('/pi');
    expect(result).toContain('Review this');
  });

  test('handles issue with title but no body', async () => {
    const { getPrompt } = await contextModule;
    const deps = createTestDeps({
      payload: {
        comment: { id: 1, body: '/pi Fix this' },
        issue: {
          number: 456,
          title: 'Title only issue',
        },
      },
    });

    const result = await getPrompt(deps);
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #456: Title only issue');
    expect(result).not.toContain('Description:');
  });

  describe('with prompt input', () => {
    test('uses prompt input when provided, enriched with issue context', async () => {
      const { getPrompt } = await contextModule;
      const deps = createTestDeps({
        payload: {
          issue: {
            number: 42,
            title: 'Test Issue',
            body: 'Test description',
          },
        },
      });

      const result = await getPrompt(deps, 'Review this code for bugs');
      expect(result).toBeDefined();
      expect(result).toContain('Issue/PR #42: Test Issue');
      expect(result).toContain('Description:');
      expect(result).toContain('Test description');
      expect(result).toContain('Instruction:');
      expect(result).toContain('Review this code for bugs');
    });

    test('uses prompt input without issue context', async () => {
      const { getPrompt } = await contextModule;
      const deps = createTestDeps({ payload: {} });

      const result = await getPrompt(deps, 'Review this code for bugs');
      expect(result).toBe('Review this code for bugs');
    });

    test('returns undefined for empty prompt input', async () => {
      const { getPrompt } = await contextModule;
      const deps = createTestDeps();

      const result = await getPrompt(deps, '   ');
      expect(result).toBeUndefined();
    });

    test('does not strip trigger phrase from prompt input', async () => {
      const { getPrompt } = await contextModule;
      const deps = createTestDeps({ payload: {} });

      const result = await getPrompt(deps, '/pi This should not be stripped');
      expect(result).toContain('/pi This should not be stripped');
    });

    test('prefers prompt input over comment when both are available', async () => {
      const { getPrompt } = await contextModule;
      const deps = createTestDeps({
        payload: {
          comment: { id: 1, body: '/pi From comment' },
          issue: {
            number: 99,
            title: 'Priority Test',
          },
        },
      });

      const result = await getPrompt(deps, 'Review this code for bugs');
      expect(result).toContain('Instruction:');
      expect(result).toContain('Review this code for bugs');
      expect(result).not.toContain('From comment');
    });

    test('enriches prompt input with PR context', async () => {
      const { getPrompt } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request',
        payload: {
          pull_request: {
            number: 123,
            title: 'Fix bug',
            body: 'This PR fixes the bug',
          },
        },
      });

      const result = await getPrompt(deps, 'Review this code for bugs');
      expect(result).toContain('Issue/PR #123: Fix bug');
      expect(result).toContain('This PR fixes the bug');
      expect(result).toContain('Instruction:');
      expect(result).toContain('Review this code for bugs');
    });
  });
});

describe('isPR', () => {
  test('returns false for issue_comment event', async () => {
    const { isPR } = await contextModule;
    const deps = createTestDeps({ eventName: 'issue_comment', payload: {} });
    expect(isPR(deps)).toBe(false);
  });

  test('returns false for issues event', async () => {
    const { isPR } = await contextModule;
    const deps = createTestDeps({ eventName: 'issues', payload: {} });
    expect(isPR(deps)).toBe(false);
  });

  test('returns true for pull_request event', async () => {
    const { isPR } = await contextModule;
    const deps = createTestDeps({ eventName: 'pull_request', payload: {} });
    expect(isPR(deps)).toBe(true);
  });

  test('returns true when payload has pull_request', async () => {
    const { isPR } = await contextModule;
    const deps = createTestDeps({
      eventName: 'issue_comment',
      payload: { pull_request: { number: 123 } },
    });
    expect(isPR(deps)).toBe(true);
  });

  test('returns false for unknown event type', async () => {
    const { isPR } = await contextModule;
    const deps = createTestDeps({ eventName: 'push', payload: {} });
    expect(isPR(deps)).toBe(false);
  });

  test('returns true for pull_request_review event (has pull_request in payload)', async () => {
    const { isPR } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review',
      payload: { pull_request: { number: 10 } },
    });
    expect(isPR(deps)).toBe(true);
  });

  test('returns true for pull_request_review_comment event (has pull_request in payload)', async () => {
    const { isPR } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review_comment',
      payload: { pull_request: { number: 10 } },
    });
    expect(isPR(deps)).toBe(true);
  });
});

describe('getContextType', () => {
  test('returns issue for issue_comment event', async () => {
    const { getContextType } = await contextModule;
    const deps = createTestDeps({ eventName: 'issue_comment', payload: {} });
    expect(getContextType(deps)).toBe('issue');
  });

  test('returns issue for issues event', async () => {
    const { getContextType } = await contextModule;
    const deps = createTestDeps({ eventName: 'issues', payload: {} });
    expect(getContextType(deps)).toBe('issue');
  });

  test('returns pull_request for pull_request event', async () => {
    const { getContextType } = await contextModule;
    const deps = createTestDeps({ eventName: 'pull_request', payload: {} });
    expect(getContextType(deps)).toBe('pull_request');
  });

  test('returns pull_request when payload has pull_request', async () => {
    const { getContextType } = await contextModule;
    const deps = createTestDeps({
      eventName: 'issue_comment',
      payload: { pull_request: { number: 123 } },
    });
    expect(getContextType(deps)).toBe('pull_request');
  });

  test('returns undefined for unknown event type', async () => {
    const { getContextType } = await contextModule;
    const deps = createTestDeps({ eventName: 'push', payload: {} });
    expect(getContextType(deps)).toBeUndefined();
  });

  test('returns pull_request for pull_request_review event', async () => {
    const { getContextType } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review',
      payload: { pull_request: { number: 10 } },
    });
    expect(getContextType(deps)).toBe('pull_request');
  });

  test('returns pull_request for pull_request_review_comment event', async () => {
    const { getContextType } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review_comment',
      payload: { pull_request: { number: 10 } },
    });
    expect(getContextType(deps)).toBe('pull_request');
  });
});

describe('getIssueOrPullRequestContext', () => {
  test('returns undefined when no issue or pull_request in payload', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({ payload: { comment: { id: 1 } } });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toBeUndefined();
  });

  test('returns issue context for issue_comment event', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'issue_comment',
      payload: {
        comment: { id: 1 },
        issue: {
          number: 42,
          title: 'Bug report',
          body: 'Something is broken',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toEqual({
      number: 42,
      title: 'Bug report',
      body: 'Something is broken',
    });
  });

  test('returns issue context for issues event', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'issues',
      payload: {
        issue: {
          number: 123,
          title: 'Feature request',
          body: 'Please add a feature',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toEqual({
      number: 123,
      title: 'Feature request',
      body: 'Please add a feature',
    });
  });

  test('returns pull request context for pull_request event', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request',
      payload: {
        pull_request: {
          number: 456,
          title: 'Fix for bug',
          body: 'This PR fixes the issue',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toEqual({
      number: 456,
      title: 'Fix for bug',
      body: 'This PR fixes the issue',
    });
  });

  test('returns undefined when issue has no title', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'issue_comment',
      payload: {
        comment: { id: 1 },
        issue: {
          number: 789,
          body: 'No title',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toBeUndefined();
  });

  test('returns context when issue has title but no body', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'issue_comment',
      payload: {
        comment: { id: 1 },
        issue: {
          number: 999,
          title: 'Title only',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toEqual({
      number: 999,
      title: 'Title only',
    });
  });

  test('returns undefined for unknown event type', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'push',
      payload: {
        issue: {
          number: 111,
          title: 'Should not be returned',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toBeUndefined();
  });

  test('returns context when pull_request has title but no body', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request',
      payload: {
        pull_request: {
          number: 888,
          title: 'PR title only',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toEqual({
      number: 888,
      title: 'PR title only',
    });
  });

  test('returns undefined when pull_request has no title', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request',
      payload: {
        pull_request: {
          number: 888,
          body: 'No title on PR',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toBeUndefined();
  });

  test('returns PR context for pull_request_review event', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review',
      payload: {
        review: { id: 1, body: 'LGTM' },
        pull_request: {
          number: 50,
          title: 'Review PR',
          body: 'Please review',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toEqual({
      number: 50,
      title: 'Review PR',
      body: 'Please review',
    });
  });

  test('returns PR context for pull_request_review_comment event', async () => {
    const { getIssueOrPullRequestContext } = await contextModule;
    const deps = createTestDeps({
      eventName: 'pull_request_review_comment',
      payload: {
        comment: { id: 1, body: 'nit', pull_request_review_id: 99 },
        pull_request: {
          number: 60,
          title: 'Diff comment PR',
          body: 'Fix typo',
        },
      },
    });
    const result = getIssueOrPullRequestContext(deps);
    expect(result).toEqual({
      number: 60,
      title: 'Diff comment PR',
      body: 'Fix typo',
    });
  });
});

describe('getIssueOrPRThread', () => {
  test('is exported function', async () => {
    const { getIssueOrPRThread } = await githubModule;
    expect(typeof getIssueOrPRThread).toBe('function');
  });
});

describe('updatePullRequest', () => {
  test('is exported function', async () => {
    const { updatePullRequest } = await githubModule;
    expect(typeof updatePullRequest).toBe('function');
  });
});

describe('getStartTimeFromContext', () => {
  test('is exported function', async () => {
    const { getStartTimeFromContext } = await contextModule;
    expect(typeof getStartTimeFromContext).toBe('function');
  });

  describe('issue_comment events', () => {
    test('returns comment created_at timestamp for issue_comment events', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'issue_comment',
        payload: {
          comment: { id: 1, created_at: '2024-01-15T10:30:00Z' },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-01-15T10:30:00Z');
    });

    test('returns undefined when comment has no created_at', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'issue_comment',
        payload: {
          comment: { id: 1 },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });

    test('returns undefined when comment is missing', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'issue_comment',
        payload: {},
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });
  });

  describe('issues events', () => {
    test('returns issue updated_at timestamp for issues events', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'issues',
        payload: {
          issue: {
            number: 1,
            id: 1,
            created_at: '2024-01-10T08:00:00Z',
            updated_at: '2024-01-15T10:30:00Z',
          },
        } as any,
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-01-15T10:30:00Z');
    });

    test('returns undefined when issue has no updated_at', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'issues',
        payload: {
          issue: { number: 1, id: 1 },
        } as any,
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });

    test('returns undefined when issue is missing', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'issues',
        payload: {},
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });
  });

  describe('pull_request events', () => {
    test('returns PR updated_at timestamp for pull_request events', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request',
        payload: {
          pull_request: {
            id: 1,
            number: 123,
            created_at: '2024-01-10T08:00:00Z',
            updated_at: '2024-01-15T10:30:00Z',
          },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-01-15T10:30:00Z');
    });

    test('returns undefined when PR has no updated_at', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request',
        payload: {
          pull_request: { id: 1, number: 123 },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });

    test('returns undefined when pull_request is missing', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request',
        payload: {},
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });
  });

  describe('pull_request_review events', () => {
    test('returns review submitted_at timestamp for pull_request_review events', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request_review',
        payload: {
          review: { id: 1, submitted_at: '2024-06-01T12:00:00Z' },
          pull_request: { number: 10 },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-06-01T12:00:00Z');
    });

    test('returns undefined when review has no submitted_at', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request_review',
        payload: {
          review: { id: 1 },
          pull_request: { number: 10 },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });

    test('returns undefined when review is missing', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request_review',
        payload: {
          pull_request: { number: 10 },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });
  });

  describe('pull_request_review_comment events', () => {
    test('returns comment created_at timestamp for pull_request_review_comment events', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request_review_comment',
        payload: {
          comment: { id: 1, created_at: '2024-07-15T08:30:00Z', pull_request_review_id: 99 },
          pull_request: { number: 20 },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-07-15T08:30:00Z');
    });

    test('returns undefined when comment has no created_at', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request_review_comment',
        payload: {
          comment: { id: 1 },
          pull_request: { number: 20 },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });

    test('returns undefined when comment is missing', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'pull_request_review_comment',
        payload: {
          pull_request: { number: 20 },
        },
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });
  });

  describe('unknown event types', () => {
    test('returns undefined for unknown event type', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'push',
        payload: {},
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });

    test('returns undefined for workflow_run event', async () => {
      const { getStartTimeFromContext } = await contextModule;
      const deps = createTestDeps({
        eventName: 'workflow_run',
        payload: {},
      });

      const result = getStartTimeFromContext(deps);
      expect(result).toBeUndefined();
    });
  });
});

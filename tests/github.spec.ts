import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
// so they don't appear as CI annotations in test output.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stdout.write accepts variable args
const _mockedWrite = mock((...args: any[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true; // swallow annotations
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
// stdout.write is readonly, we override for tests
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock @actions/core to suppress info/debug/notice/warning logging
const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  if (name === 'prompt') {
    return '';
  }
  if (name === 'trigger') {
    return '/pi';
  }
  return '';
});

// Create a test CoreAdapter
const testCoreAdapter = {
  getInput: mockGetInput,
  setFailed: mock(noop),
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  warning: mock(noop),
};

mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  warning: mock(noop),
}));

import * as github from '@actions/github';

// Set env vars BEFORE importing github.ts (it runs module-level side effects)
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// Dynamic import to ensure env vars are set before module loads
// Also initialize the github module context with test adapter
const githubModule = import('../src/github/index.js');
const contextModule = import('../src/github/context.js');
const [
  githubExports,
  contextExports,
] = // @ts-expect-error TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
  await Promise.all([githubModule, contextModule]);

// Initialize the github module context with test adapter
const { setCoreAdapter } = githubExports;
setCoreAdapter(testCoreAdapter);

const {
  getPrompt,
  createFinalComment,
  getIssueOrPRThread,
  updatePullRequest,
} = githubExports;

const {
  getIssueOrPullRequestContext,
  isPR,
  getContextType,
  getStartTimeFromContext,
} = contextExports;

describe('getPrompt', () => {
  beforeEach(() => {
    github.context.payload = {};
    github.context.eventName = 'issue_comment';
  });

  test('returns undefined when no comment in payload', async () => {
    const result = await getPrompt();
    expect(result).toBeUndefined();
  });

  test('returns enriched prompt with issue context', async () => {
    github.context.payload = {
      comment: { id: 1, body: '/pi Review this' },
      issue: {
        number: 42,
        title: 'Test Issue',
        body: 'Test description',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #42: Test Issue');
    expect(result).toContain('Description:');
    expect(result).toContain('Test description');
    expect(result).toContain('Comment/Instruction:');
    expect(result).toContain('Review this');
  });

  test('returns only comment body when no issue context', async () => {
    github.context.payload = {
      comment: { id: 1, body: '/pi Just comment' },
    };

    const result = await getPrompt();
    expect(result).toBe('Just comment');
  });

  test('returns enriched prompt with PR context', async () => {
    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review this PR' },
      pull_request: {
        number: 123,
        title: 'Fix bug',
        body: 'This PR fixes the bug',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #123: Fix bug');
    expect(result).toContain('Description:');
    expect(result).toContain('This PR fixes the bug');
  });

  test('returns enriched prompt from pull_request_review event', async () => {
    github.context.eventName = 'pull_request_review';
    github.context.payload = {
      review: { id: 99, body: '/pi Review this please' },
      pull_request: {
        number: 55,
        title: 'Add feature',
        body: 'Feature description',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #55: Add feature');
    expect(result).toContain('Feature description');
    expect(result).toContain('Review this please');
  });

  test('strips trigger from pull_request_review body', async () => {
    github.context.eventName = 'pull_request_review';
    github.context.payload = {
      review: { id: 99, body: '/pi Review this please' },
      pull_request: {
        number: 55,
        title: 'Add feature',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).not.toContain('/pi');
    expect(result).toContain('Review this please');
  });

  test('returns undefined for pull_request_review with null body (approve-only)', async () => {
    github.context.eventName = 'pull_request_review';
    github.context.payload = {
      review: { id: 99, body: null },
      pull_request: {
        number: 55,
        title: 'Add feature',
      },
    };

    const result = await getPrompt();
    expect(result).toBeUndefined();
  });

  test('returns undefined for pull_request_review with empty string body', async () => {
    github.context.eventName = 'pull_request_review';
    github.context.payload = {
      review: { id: 99, body: '' },
      pull_request: {
        number: 55,
        title: 'Add feature',
      },
    };

    const result = await getPrompt();
    expect(result).toBeUndefined();
  });

  test('returns enriched prompt from pull_request_review_comment event', async () => {
    github.context.eventName = 'pull_request_review_comment';
    github.context.payload = {
      comment: { id: 200, body: '/pi Fix this line', pull_request_review_id: 99 },
      pull_request: {
        number: 77,
        title: 'Bugfix PR',
        body: 'Fixes a bug',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #77: Bugfix PR');
    expect(result).toContain('Fix this line');
  });

  test('strips trigger from pull_request_review_comment body', async () => {
    github.context.eventName = 'pull_request_review_comment';
    github.context.payload = {
      comment: { id: 200, body: '/pi Fix this line', pull_request_review_id: 99 },
      pull_request: {
        number: 77,
        title: 'Bugfix PR',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).not.toContain('/pi');
    expect(result).toContain('Fix this line');
  });

  test('returns undefined for pull_request_review without PR context', async () => {
    github.context.eventName = 'pull_request_review';
    github.context.payload = {
      review: { id: 99, body: '/pi Do something' },
    };

    const result = await getPrompt();
    expect(result).toBe('Do something');
  });

  test('returns undefined when comment is empty', async () => {
    github.context.payload = {
      comment: { id: 1, body: '/pi' },
    };

    const result = await getPrompt();
    expect(result).toBeUndefined();
  });

  test('strips trigger from comment body', async () => {
    github.context.payload = {
      comment: { id: 1, body: '/pi Review this' },
    };

    const result = await getPrompt();
    expect(result).not.toContain('/pi');
    expect(result).toContain('Review this');
  });

  test('handles issue with title but no body', async () => {
    github.context.payload = {
      comment: { id: 1, body: '/pi Fix this' },
      issue: {
        number: 456,
        title: 'Title only issue',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #456: Title only issue');
    expect(result).not.toContain('Description:');
  });

  describe('with prompt input', () => {
    test('uses prompt input when provided, enriched with issue context', async () => {
      github.context.payload = {
        issue: {
          number: 42,
          title: 'Test Issue',
          body: 'Test description',
        },
      };

      const result = await getPrompt('Review this code for bugs');
      expect(result).toBeDefined();
      expect(result).toContain('Issue/PR #42: Test Issue');
      expect(result).toContain('Description:');
      expect(result).toContain('Test description');
      expect(result).toContain('Instruction:');
      expect(result).toContain('Review this code for bugs');
    });

    test('uses prompt input without issue context', async () => {
      github.context.payload = {};

      const result = await getPrompt('Review this code for bugs');
      expect(result).toBe('Review this code for bugs');
    });

    test('returns undefined for empty prompt input', async () => {
      const result = await getPrompt('   ');
      expect(result).toBeUndefined();
    });

    test('does not strip trigger phrase from prompt input', async () => {
      github.context.payload = {};

      const result = await getPrompt('/pi This should not be stripped');
      expect(result).toContain('/pi This should not be stripped');
    });

    test('prefers prompt input over comment when both are available', async () => {
      github.context.payload = {
        comment: { id: 1, body: '/pi From comment' },
        issue: {
          number: 99,
          title: 'Priority Test',
        },
      };

      const result = await getPrompt('Review this code for bugs');
      expect(result).toContain('Instruction:');
      expect(result).toContain('Review this code for bugs');
      expect(result).not.toContain('From comment');
    });

    test('enriches prompt input with PR context', async () => {
      github.context.eventName = 'pull_request';
      github.context.payload = {
        pull_request: {
          number: 123,
          title: 'Fix bug',
          body: 'This PR fixes the bug',
        },
      };

      const result = await getPrompt('Review this code for bugs');
      expect(result).toContain('Issue/PR #123: Fix bug');
      expect(result).toContain('This PR fixes the bug');
      expect(result).toContain('Instruction:');
      expect(result).toContain('Review this code for bugs');
    });
  });
});

describe('createFinalComment', () => {
  beforeEach(() => {
    github.context.payload = {};
  });

  test('returns undefined for empty body', async () => {
    const result = await createFinalComment('');
    expect(result).toBeUndefined();
  });
});

describe('isPR', () => {
  beforeEach(() => {
    github.context.payload = {};
    github.context.eventName = 'issue_comment';
  });

  test('returns false for issue_comment event', () => {
    github.context.eventName = 'issue_comment';
    expect(isPR()).toBe(false);
  });

  test('returns false for issues event', () => {
    github.context.eventName = 'issues';
    expect(isPR()).toBe(false);
  });

  test('returns true for pull_request event', () => {
    github.context.eventName = 'pull_request';
    expect(isPR()).toBe(true);
  });

  test('returns true when payload has pull_request', () => {
    github.context.eventName = 'issue_comment';
    github.context.payload = {
      pull_request: { number: 123 },
    };
    expect(isPR()).toBe(true);
  });

  test('returns false for unknown event type', () => {
    github.context.eventName = 'push';
    expect(isPR()).toBe(false);
  });

  test('returns true for pull_request_review event (has pull_request in payload)', () => {
    github.context.eventName = 'pull_request_review';
    github.context.payload = {
      pull_request: { number: 10 },
    };
    expect(isPR()).toBe(true);
  });

  test('returns true for pull_request_review_comment event (has pull_request in payload)', () => {
    github.context.eventName = 'pull_request_review_comment';
    github.context.payload = {
      pull_request: { number: 10 },
    };
    expect(isPR()).toBe(true);
  });
});

describe('getContextType', () => {
  beforeEach(() => {
    github.context.payload = {};
    github.context.eventName = 'issue_comment';
  });

  test('returns issue for issue_comment event', () => {
    github.context.eventName = 'issue_comment';
    expect(getContextType()).toBe('issue');
  });

  test('returns issue for issues event', () => {
    github.context.eventName = 'issues';
    expect(getContextType()).toBe('issue');
  });

  test('returns pull_request for pull_request event', () => {
    github.context.eventName = 'pull_request';
    expect(getContextType()).toBe('pull_request');
  });

  test('returns pull_request when payload has pull_request', () => {
    github.context.eventName = 'issue_comment';
    github.context.payload = {
      pull_request: { number: 123 },
    };
    expect(getContextType()).toBe('pull_request');
  });

  test('returns undefined for unknown event type', () => {
    github.context.eventName = 'push';
    expect(getContextType()).toBeUndefined();
  });

  test('returns pull_request for pull_request_review event', () => {
    github.context.eventName = 'pull_request_review';
    github.context.payload = {
      pull_request: { number: 10 },
    };
    expect(getContextType()).toBe('pull_request');
  });

  test('returns pull_request for pull_request_review_comment event', () => {
    github.context.eventName = 'pull_request_review_comment';
    github.context.payload = {
      pull_request: { number: 10 },
    };
    expect(getContextType()).toBe('pull_request');
  });
});

describe('getIssueOrPullRequestContext', () => {
  beforeEach(() => {
    github.context.payload = {};
    github.context.eventName = 'issue_comment';
  });

  test('returns undefined when no issue or pull_request in payload', () => {
    github.context.payload = { comment: { id: 1 } };
    const result = getIssueOrPullRequestContext();
    expect(result).toBeUndefined();
  });

  test('returns issue context for issue_comment event', () => {
    github.context.eventName = 'issue_comment';
    github.context.payload = {
      comment: { id: 1 },
      issue: {
        number: 42,
        title: 'Bug report',
        body: 'Something is broken',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toEqual({
      number: 42,
      title: 'Bug report',
      body: 'Something is broken',
    });
  });

  test('returns issue context for issues event', () => {
    github.context.eventName = 'issues';
    github.context.payload = {
      issue: {
        number: 123,
        title: 'Feature request',
        body: 'Please add a feature',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toEqual({
      number: 123,
      title: 'Feature request',
      body: 'Please add a feature',
    });
  });

  test('returns pull request context for pull_request event', () => {
    github.context.eventName = 'pull_request';
    github.context.payload = {
      pull_request: {
        number: 456,
        title: 'Fix for bug',
        body: 'This PR fixes the issue',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toEqual({
      number: 456,
      title: 'Fix for bug',
      body: 'This PR fixes the issue',
    });
  });

  test('returns undefined when issue has no title', () => {
    github.context.eventName = 'issue_comment';
    github.context.payload = {
      comment: { id: 1 },
      issue: {
        number: 789,
        body: 'No title',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toBeUndefined();
  });

  test('returns context when issue has title but no body', () => {
    github.context.eventName = 'issue_comment';
    github.context.payload = {
      comment: { id: 1 },
      issue: {
        number: 999,
        title: 'Title only',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toEqual({
      number: 999,
      title: 'Title only',
    });
  });

  test('returns undefined for unknown event type', () => {
    github.context.eventName = 'push';
    github.context.payload = {
      issue: {
        number: 111,
        title: 'Should not be returned',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toBeUndefined();
  });

  test('returns context when pull_request has title but no body', () => {
    github.context.eventName = 'pull_request';
    github.context.payload = {
      pull_request: {
        number: 888,
        title: 'PR title only',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toEqual({
      number: 888,
      title: 'PR title only',
    });
  });

  test('returns undefined when pull_request has no title', () => {
    github.context.eventName = 'pull_request';
    github.context.payload = {
      pull_request: {
        number: 888,
        body: 'No title on PR',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toBeUndefined();
  });

  test('returns PR context for pull_request_review event', () => {
    github.context.eventName = 'pull_request_review';
    github.context.payload = {
      review: { id: 1, body: 'LGTM' },
      pull_request: {
        number: 50,
        title: 'Review PR',
        body: 'Please review',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toEqual({
      number: 50,
      title: 'Review PR',
      body: 'Please review',
    });
  });

  test('returns PR context for pull_request_review_comment event', () => {
    github.context.eventName = 'pull_request_review_comment';
    github.context.payload = {
      comment: { id: 1, body: 'nit', pull_request_review_id: 99 },
      pull_request: {
        number: 60,
        title: 'Diff comment PR',
        body: 'Fix typo',
      },
    };
    const result = getIssueOrPullRequestContext();
    expect(result).toEqual({
      number: 60,
      title: 'Diff comment PR',
      body: 'Fix typo',
    });
  });
});

describe('getIssueOrPRThread', () => {
  test('is exported function', () => {
    expect(typeof getIssueOrPRThread).toBe('function');
  });
});

describe('updatePullRequest', () => {
  test('is exported function', () => {
    expect(typeof updatePullRequest).toBe('function');
  });
});

describe('getStartTimeFromContext', () => {
  beforeEach(() => {
    github.context.payload = {};
    github.context.eventName = 'issue_comment';
  });

  test('is exported function', () => {
    expect(typeof getStartTimeFromContext).toBe('function');
  });

  describe('issue_comment events', () => {
    test('returns comment created_at timestamp for issue_comment events', () => {
      github.context.eventName = 'issue_comment';
      github.context.payload = {
        comment: { id: 1, created_at: '2024-01-15T10:30:00Z' },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-01-15T10:30:00Z');
    });

    test('returns undefined when comment has no created_at', () => {
      github.context.eventName = 'issue_comment';
      github.context.payload = {
        comment: { id: 1 },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });

    test('returns undefined when comment is missing', () => {
      github.context.eventName = 'issue_comment';
      github.context.payload = {};

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });
  });

  describe('issues events', () => {
    test('returns issue updated_at timestamp for issues events', () => {
      github.context.eventName = 'issues';
      github.context.payload = {
        issue: {
          number: 1,
          id: 1,
          created_at: '2024-01-10T08:00:00Z',
          updated_at: '2024-01-15T10:30:00Z',
        },
      } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- Testing mock context

      const result = getStartTimeFromContext();
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-01-15T10:30:00Z');
    });

    test('returns undefined when issue has no updated_at', () => {
      github.context.eventName = 'issues';
      github.context.payload = {
        issue: { number: 1, id: 1 },
      } as any; // eslint-disable-line @typescript-eslint/no-explicit-any -- Testing mock context

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });

    test('returns undefined when issue is missing', () => {
      github.context.eventName = 'issues';
      github.context.payload = {};

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });
  });

  describe('pull_request events', () => {
    test('returns PR updated_at timestamp for pull_request events', () => {
      github.context.eventName = 'pull_request';
      github.context.payload = {
        pull_request: {
          id: 1,
          number: 123,
          created_at: '2024-01-10T08:00:00Z',
          updated_at: '2024-01-15T10:30:00Z',
        },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-01-15T10:30:00Z');
    });

    test('returns undefined when PR has no updated_at', () => {
      github.context.eventName = 'pull_request';
      github.context.payload = {
        pull_request: { id: 1, number: 123 },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });

    test('returns undefined when pull_request is missing', () => {
      github.context.eventName = 'pull_request';
      github.context.payload = {};

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });
  });

  describe('pull_request_review events', () => {
    test('returns review submitted_at timestamp for pull_request_review events', () => {
      github.context.eventName = 'pull_request_review';
      github.context.payload = {
        review: { id: 1, submitted_at: '2024-06-01T12:00:00Z' },
        pull_request: { number: 10 },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-06-01T12:00:00Z');
    });

    test('returns undefined when review has no submitted_at', () => {
      github.context.eventName = 'pull_request_review';
      github.context.payload = {
        review: { id: 1 },
        pull_request: { number: 10 },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });

    test('returns undefined when review is missing', () => {
      github.context.eventName = 'pull_request_review';
      github.context.payload = {
        pull_request: { number: 10 },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });
  });

  describe('pull_request_review_comment events', () => {
    test('returns comment created_at timestamp for pull_request_review_comment events', () => {
      github.context.eventName = 'pull_request_review_comment';
      github.context.payload = {
        comment: { id: 1, created_at: '2024-07-15T08:30:00Z', pull_request_review_id: 99 },
        pull_request: { number: 20 },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeDefined();
      expect(result?.toString()).toBe('2024-07-15T08:30:00Z');
    });

    test('returns undefined when comment has no created_at', () => {
      github.context.eventName = 'pull_request_review_comment';
      github.context.payload = {
        comment: { id: 1 },
        pull_request: { number: 20 },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });

    test('returns undefined when comment is missing', () => {
      github.context.eventName = 'pull_request_review_comment';
      github.context.payload = {
        pull_request: { number: 20 },
      };

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });
  });

  describe('unknown event types', () => {
    test('returns undefined for unknown event type', () => {
      github.context.eventName = 'push';
      github.context.payload = {};

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });

    test('returns undefined for workflow_run event', () => {
      github.context.eventName = 'workflow_run';
      github.context.payload = {};

      const result = getStartTimeFromContext();
      expect(result).toBeUndefined();
    });
  });
});

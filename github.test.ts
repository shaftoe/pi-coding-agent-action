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
const githubModule = import('./github/index.js');
const contextModule = import('./github/context.js');
const [
  {
    getPrompt,
    createFinalComment,
    getIssueOrPRThread,
    updatePullRequest,
  },
  {
    getIssueOrPullRequestContext,
    isPR,
    getContextType,
  },
] = // @ts-expect-error TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
  await Promise.all([githubModule, contextModule]);

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

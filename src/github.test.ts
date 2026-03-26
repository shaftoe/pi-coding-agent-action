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
  // @ts-expect-error -- spread parameter type limitation
  return realStdoutWrite(...args);
});
// stdout.write is readonly, we override for tests
process.stdout.write = _mockedWrite as unknown;

// Mock @actions/core to suppress info/debug/notice/warning logging
const noop = (): void => {};
mock.module('@actions/core', () => ({
  getInput: mock(() => '/pi'),
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  warning: mock(noop),
}));

// Set env vars BEFORE importing github.ts (it runs module-level side effects)
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

const { getPrompt, createFinalComment, getIssueOrPullRequestContext } = await import('./github');
import * as github from '@actions/github';

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
      body: undefined,
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
      body: undefined,
    });
  });
});

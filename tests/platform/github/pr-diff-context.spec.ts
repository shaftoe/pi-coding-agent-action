import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
const realStdoutWrite = process.stdout.write.bind(process.stdout);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stdout.write accepts variable args
const _mockedWrite = mock((...args: any[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock getOctokit to return a mock octokit instance
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock needs flexible return types for different test scenarios
const mockPullsGet = mock((): Promise<any> => Promise.resolve({ data: '' }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock needs flexible return types for different test scenarios
const mockPullsListReviewComments = mock((): Promise<any> => Promise.resolve({ data: [] }));

// Mock @actions/core
const noop = (): void => {};
const mockGetInput = mock((_name: string): string => {
  const name = _name;
  if (name === 'github_token') {
    return 'fake-token';
  }
  if (name === 'prompt') {
    return '';
  }
  if (name === 'trigger') {
    return '/pi';
  }
  if (name === 'include_pr_diff') {
    return 'true';
  }
  if (name === 'max_diff_lines') {
    return '1000';
  }
  return '';
});

const testCoreAdapter = {
  getInput: mockGetInput,
  setFailed: mock(noop),
  setOutput: mock(noop),
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
  setOutput: mock(noop),
  warning: mock(noop),
}));

// Mock @actions/github BEFORE importing modules that depend on it
import * as github from '@actions/github';

mock.module('@actions/github', () => ({
  context: github.context,
  getOctokit: () => ({
    rest: {
      pulls: {
        get: mockPullsGet,
        listReviewComments: mockPullsListReviewComments,
      },
      issues: {
        get: mock(() => Promise.resolve({ data: {} })),
        listComments: mock(() => Promise.resolve({ data: [] })),
      },
      reactions: {
        createForIssueComment: mock(() => Promise.resolve({ data: { id: 1 } })),
        deleteForIssueComment: mock(() => Promise.resolve()),
        listForIssueComment: mock(() => Promise.resolve({ data: [] })),
      },
    },
  }),
}));

// Mock the octokit module to use our mock functions
mock.module('../../../src/platform/github/octokit.js', () => ({
  getOctokit: () => ({
    rest: {
      pulls: {
        get: mockPullsGet,
        listReviewComments: mockPullsListReviewComments,
      },
      issues: {
        get: mock(() => Promise.resolve({ data: {} })),
        listComments: mock(() => Promise.resolve({ data: [] })),
      },
    },
  }),
}));

// Set env vars BEFORE importing modules
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.INPUT_INCLUDE_PR_DIFF = 'true';
process.env.INPUT_MAX_DIFF_LINES = '1000';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-diff-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// Dynamic import to ensure env vars and mocks are set before module loads
const githubModule = import('../../../src/platform/github/index.js');

const githubExports = // @ts-expect-error TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
  await githubModule;

const { setCoreAdapter, getPrompt, fetchPRDiff, fetchPRReviewComments, formatReviewComments } =
  githubExports;

setCoreAdapter(testCoreAdapter);

// Helper to set up default mockGetInput behavior for PR diff tests
function defaultInputMock(name: string): string {
  if (name === 'github_token') {
    return 'fake-token';
  }
  if (name === 'prompt') {
    return '';
  }
  if (name === 'trigger') {
    return '/pi';
  }
  if (name === 'include_pr_diff') {
    return 'true';
  }
  if (name === 'max_diff_lines') {
    return '1000';
  }
  return '';
}

describe('formatReviewComments', () => {
  test('returns undefined for undefined input', () => {
    expect(formatReviewComments(undefined)).toBeUndefined();
  });

  test('returns undefined for empty array', () => {
    expect(formatReviewComments([])).toBeUndefined();
  });

  test('formats a single comment with path and line', () => {
    const comments = [{ path: 'src/auth.ts', line: 15, author: 'reviewer', body: 'Needs fix' }];
    const result = formatReviewComments(comments);
    expect(result).toContain('PR Review Comments (1):');
    expect(result).toContain('**src/auth.ts** L15 (@reviewer): Needs fix');
  });

  test('formats multiple comments', () => {
    const comments = [
      { path: 'src/a.ts', line: 10, author: 'alice', body: 'Fix A' },
      { path: 'src/b.ts', line: 20, author: 'bob', body: 'Fix B' },
    ];
    const result = formatReviewComments(comments);
    expect(result).toContain('PR Review Comments (2):');
    expect(result).toContain('**src/a.ts** L10 (@alice): Fix A');
    expect(result).toContain('**src/b.ts** L20 (@bob): Fix B');
  });

  test('handles comment with null path and line', () => {
    const comments = [{ path: null, line: null, author: 'reviewer', body: 'General comment' }];
    const result = formatReviewComments(comments);
    expect(result).toContain('(unknown location) (@reviewer): General comment');
  });

  test('handles comment with path but no line', () => {
    const comments = [{ path: 'src/file.ts', line: null, author: 'dev', body: 'Note' }];
    const result = formatReviewComments(comments);
    expect(result).toContain('**src/file.ts** (@dev): Note');
  });

  test('handles special characters in body', () => {
    const comments = [
      { path: 'src/a.ts', line: 1, author: 'dev', body: 'Use `code` and **bold** and <html>' },
    ];
    const result = formatReviewComments(comments);
    expect(result).toContain('Use `code` and **bold** and <html>');
  });
});

describe('fetchPRDiff', () => {
  beforeEach(() => {
    mockPullsGet.mockClear();
  });

  test('returns diff string on success', async () => {
    const diffText = 'diff --git a/file.ts b/file.ts\n+added line\n-removed line';
    mockPullsGet.mockResolvedValueOnce({ data: diffText });

    const result = await fetchPRDiff('owner', 'repo', 1);
    expect(result).toBe(diffText);
  });

  test('returns undefined for empty diff', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: '' });

    const result = await fetchPRDiff('owner', 'repo', 1);
    expect(result).toBeUndefined();
  });

  test('returns undefined on error', async () => {
    mockPullsGet.mockRejectedValueOnce(new Error('API error'));

    const result = await fetchPRDiff('owner', 'repo', 1);
    expect(result).toBeUndefined();
  });

  test('truncates diff when exceeding max lines', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const diffText = lines.join('\n');
    mockPullsGet.mockResolvedValueOnce({ data: diffText });

    const result = await fetchPRDiff('owner', 'repo', 1, 10);
    expect(result).toContain('line 10');
    expect(result).toContain('... (truncated at 10 lines)');
    expect(result).not.toContain('line 11');
  });

  test('does not truncate when within limit', async () => {
    const diffText = 'line 1\nline 2\nline 3';
    mockPullsGet.mockResolvedValueOnce({ data: diffText });

    const result = await fetchPRDiff('owner', 'repo', 1, 100);
    expect(result).toBe(diffText);
    expect(result).not.toContain('truncated');
  });

  test('uses default max lines when not specified', async () => {
    const diffText = 'single line';
    mockPullsGet.mockResolvedValueOnce({ data: diffText });

    const result = await fetchPRDiff('owner', 'repo', 1);
    expect(result).toBe('single line');
    expect(mockPullsGet).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        pull_number: 1,
        mediaType: { format: 'diff' },
      })
    );
  });
});

describe('fetchPRReviewComments', () => {
  beforeEach(() => {
    mockPullsListReviewComments.mockClear();
  });

  test('returns formatted comments on success', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: 'src/a.ts',
          line: 10,
          original_line: null,
          user: { login: 'alice' },
          body: 'Fix this',
        },
      ],
    });

    const result = await fetchPRReviewComments('owner', 'repo', 1);
    expect(result).toEqual([
      { path: 'src/a.ts', line: 10, author: 'alice', body: 'Fix this' },
    ]);
  });

  test('returns empty array when no comments', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    const result = await fetchPRReviewComments('owner', 'repo', 1);
    expect(result).toEqual([]);
  });

  test('returns undefined on error', async () => {
    mockPullsListReviewComments.mockRejectedValueOnce(new Error('API error'));

    const result = await fetchPRReviewComments('owner', 'repo', 1);
    expect(result).toBeUndefined();
  });

  test('handles null path and line gracefully', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: null,
          line: null,
          original_line: null,
          user: { login: 'bob' },
          body: 'General note',
        },
      ],
    });

    const result = await fetchPRReviewComments('owner', 'repo', 1);
    expect(result).toEqual([{ path: null, line: null, author: 'bob', body: 'General note' }]);
  });

  test('falls back to original_line when line is null', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: 'src/file.ts',
          line: null,
          original_line: 42,
          user: { login: 'dev' },
          body: 'Comment',
        },
      ],
    });

    const result = await fetchPRReviewComments('owner', 'repo', 1);
    expect(result).toEqual([{ path: 'src/file.ts', line: 42, author: 'dev', body: 'Comment' }]);
  });

  test('respects maxComments limit', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    await fetchPRReviewComments('owner', 'repo', 1, 25);
    expect(mockPullsListReviewComments).toHaveBeenCalledWith(
      expect.objectContaining({
        per_page: 25,
      })
    );
  });

  test('handles unknown author gracefully', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: 'file.ts',
          line: 1,
          original_line: null,
          user: null,
          body: 'Hmm',
        },
      ],
    });

    const result = await fetchPRReviewComments('owner', 'repo', 1);
    expect(result).toEqual([{ path: 'file.ts', line: 1, author: 'unknown', body: 'Hmm' }]);
  });

  test('formats multiple comments correctly', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: 'src/a.ts',
          line: 10,
          original_line: null,
          user: { login: 'alice' },
          body: 'First',
        },
        {
          path: 'src/b.ts',
          line: 20,
          original_line: null,
          user: { login: 'bob' },
          body: 'Second',
        },
      ],
    });

    const result = await fetchPRReviewComments('owner', 'repo', 1);
    expect(result).toHaveLength(2);
    expect(result?.[0]?.author).toBe('alice');
    expect(result?.[1]?.author).toBe('bob');
  });
});

describe('getPrompt (PR diff integration)', () => {
  beforeEach(() => {
    github.context.payload = {};
    github.context.eventName = 'issue_comment';
    github.context.repo.owner = 'test-owner';
    github.context.repo.repo = 'test-repo';
    mockPullsGet.mockClear();
    mockPullsListReviewComments.mockClear();
    mockGetInput.mockImplementation(defaultInputMock);
  });

  test('includes diff in prompt for PR context', async () => {
    const diffText = 'diff --git a/file.ts b/file.ts\n+added line';
    mockPullsGet.mockResolvedValueOnce({ data: diffText });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review the changes' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #42: Fix bug');
    expect(result).toContain('PR Diff:');
    expect(result).toContain('```diff');
    expect(result).toContain('added line');
    expect(result).toContain('Review the changes');
  });

  test('includes review comments in prompt', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'some diff' });
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: 'src/auth.ts',
          line: 15,
          original_line: null,
          user: { login: 'security-reviewer' },
          body: 'This needs input validation',
        },
      ],
    });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Fix issues' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    expect(result).toContain('PR Review Comments (1):');
    expect(result).toContain(
      '**src/auth.ts** L15 (@security-reviewer): This needs input validation'
    );
  });

  test('includes both diff and review comments', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'diff content here' });
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: 'src/a.ts',
          line: 5,
          original_line: null,
          user: { login: 'dev' },
          body: 'Comment A',
        },
        {
          path: 'src/b.ts',
          line: 10,
          original_line: null,
          user: { login: 'lead' },
          body: 'Comment B',
        },
      ],
    });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: { number: 99, title: 'Big PR', body: 'Many changes' },
    };

    const result = await getPrompt();
    expect(result).toContain('PR Diff:');
    expect(result).toContain('```diff');
    expect(result).toContain('diff content here');
    expect(result).toContain('PR Review Comments (2):');
    expect(result).toContain('Comment A');
    expect(result).toContain('Comment B');
    expect(result).toContain('Review');
  });

  test('skips diff when include_pr_diff is false', async () => {
    mockGetInput.mockImplementation((name: string): string => {
      if (name === 'include_pr_diff') {
        return 'false';
      }
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

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).not.toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
    expect(result).toContain('Review');
    // Verify no API calls were made
    expect(mockPullsGet).not.toHaveBeenCalled();
    expect(mockPullsListReviewComments).not.toHaveBeenCalled();
  });

  test('does not include diff for issue context', async () => {
    github.context.eventName = 'issue_comment';
    github.context.payload = {
      comment: { id: 1, body: '/pi Help me' },
      issue: { number: 42, title: 'Bug report', body: 'Something broke' },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).not.toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
    expect(result).toContain('Help me');
  });

  test('continues without diff when fetch fails', async () => {
    mockPullsGet.mockRejectedValueOnce(new Error('API down'));
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #42: Fix bug');
    expect(result).not.toContain('PR Diff:');
    expect(result).toContain('Review');
  });

  test('continues without review comments when fetch fails', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'some diff' });
    mockPullsListReviewComments.mockRejectedValueOnce(new Error('API down'));

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
    expect(result).toContain('Review');
  });

  test('uses max_diff_lines from config', async () => {
    mockGetInput.mockImplementation((name: string): string => {
      if (name === 'max_diff_lines') {
        return '50';
      }
      if (name === 'include_pr_diff') {
        return 'true';
      }
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

    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    mockPullsGet.mockResolvedValueOnce({ data: lines.join('\n') });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    expect(result).toContain('... (truncated at 50 lines)');
    expect(result).not.toContain('line 51');
  });

  test('works with prompt input for PR context', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'diff content' });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt('Review this code');
    expect(result).toContain('PR Diff:');
    expect(result).toContain('Instruction:');
    expect(result).toContain('Review this code');
  });

  test('skips diff when PR has no diff data', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: '' });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).not.toContain('PR Diff:');
    expect(result).toContain('Review');
  });

  test('skips review comments section when no comments exist', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'some diff' });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    expect(result).toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
  });

  test('uses default max_diff_lines when input is invalid', async () => {
    mockGetInput.mockImplementation((name: string): string => {
      if (name === 'max_diff_lines') {
        return 'not-a-number';
      }
      if (name === 'include_pr_diff') {
        return 'true';
      }
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

    const diffText = 'line 1\nline 2';
    mockPullsGet.mockResolvedValueOnce({ data: diffText });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    github.context.eventName = 'pull_request';
    github.context.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: { number: 42, title: 'Fix bug', body: 'Bug fix' },
    };

    const result = await getPrompt();
    // Should not truncate since default is 1000 and diff is only 2 lines
    expect(result).toContain('PR Diff:');
    expect(result).not.toContain('truncated');
  });
});

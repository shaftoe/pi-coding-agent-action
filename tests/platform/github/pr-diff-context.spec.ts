/**
 * Tests for PR diff and review comments inclusion in the prompt.
 *
 * Tests the fetchPRDiff, fetchPRReviewComments, and formatReviewComments
 * functions, and verifies that getPrompt correctly includes PR context
 * when triggered on a pull request.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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

const noop = (): void => {};

// Mock @actions/core
const mockGetInput = mock((name: string): string => {
  if (name === 'github_token') { return 'fake-token'; }
  if (name === 'prompt') { return ''; }
  if (name === 'trigger') { return '/pi'; }
  if (name === 'include_pr_diff') { return 'true'; }
  if (name === 'max_diff_lines') { return '1000'; }
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

// Mock @actions/github context
const mockContext: any = {
  repo: { owner: 'test-owner', repo: 'test-repo' },
  issue: { number: 123 },
  serverUrl: 'https://github.com',
  runId: 123456789,
  eventName: 'issue_comment',
  payload: {} as Record<string, unknown>,
};
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Mock the octokit module with controllable API responses
const mockPullsGet = mock(() =>
  Promise.resolve({ data: '' })
);
const mockPullsListReviewComments = mock(() =>
  Promise.resolve({ data: [] as any[] })
);
const mockOctokit = {
  rest: {
    pulls: {
      get: mockPullsGet,
      listReviewComments: mockPullsListReviewComments,
    },
  },
};
mock.module('../../../src/platform/github/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

// Set env vars BEFORE importing modules
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-pr-diff-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// Dynamic import to ensure mocks are set before module loads
const githubModule = import('../../../src/platform/github/index.js');
const contextModule = import('../../../src/platform/github/context.js');
const [
  githubExports,
  contextExports,
] = // @ts-expect-error TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
  await Promise.all([githubModule, contextModule]);

// Initialize the github module context with test adapter
const { setCoreAdapter } = githubExports;
setCoreAdapter(testCoreAdapter);

const { getPrompt } = githubExports;
const {
  fetchPRDiff,
  fetchPRReviewComments,
  formatReviewComments,
} = contextExports;

describe('formatReviewComments', () => {
  test('returns undefined for empty comments array', () => {
    expect(formatReviewComments([])).toBeUndefined();
  });

  test('formats a single comment with path, line, author, and body', () => {
    const result = formatReviewComments([
      {
        path: 'src/index.ts',
        line: 42,
        author: 'reviewer',
        body: 'This should be refactored',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(result).toBe('**src/index.ts** L42 (@reviewer): This should be refactored');
  });

  test('formats comment without line number', () => {
    const result = formatReviewComments([
      {
        path: 'README.md',
        author: 'bot',
        body: 'LGTM',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(result).toBe('**README.md** (@bot): LGTM');
  });

  test('formats multiple comments separated by newlines', () => {
    const result = formatReviewComments([
      {
        path: 'src/a.ts',
        line: 10,
        author: 'alice',
        body: 'Fix this',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        path: 'src/b.ts',
        line: 20,
        author: 'bob',
        body: 'Change that',
        createdAt: '2024-01-02T00:00:00Z',
      },
    ]);
    expect(result).toBe(
      '**src/a.ts** L10 (@alice): Fix this\n**src/b.ts** L20 (@bob): Change that'
    );
  });

  test('handles comment with special characters in body', () => {
    const result = formatReviewComments([
      {
        path: 'src/code.ts',
        line: 1,
        author: 'dev',
        body: 'Use `const` instead of `let`',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(result).toContain('Use `const` instead of `let`');
  });

  test('handles empty body', () => {
    const result = formatReviewComments([
      {
        path: 'src/file.ts',
        line: 5,
        author: 'dev',
        body: '',
        createdAt: '2024-01-01T00:00:00Z',
      },
    ]);
    expect(result).toBe('**src/file.ts** L5 (@dev): ');
  });
});

describe('fetchPRDiff', () => {
  beforeEach(() => {
    mockPullsGet.mockClear();
    mockContext.repo = { owner: 'test-owner', repo: 'test-repo' };
  });

  test('returns diff string from API response', async () => {
    const sampleDiff =
      'diff --git a/src/file.ts b/src/file.ts\n+new line\n-old line\n';
    mockPullsGet.mockResolvedValueOnce({ data: sampleDiff });

    const result = await fetchPRDiff(123);
    expect(result).toBe(sampleDiff);
    expect(mockPullsGet).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 123,
        mediaType: { format: 'diff' },
      })
    );
  });

  test('returns undefined when diff is empty', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: '' });

    const result = await fetchPRDiff(123);
    expect(result).toBeUndefined();
  });

  test('returns undefined when API call fails', async () => {
    mockPullsGet.mockRejectedValueOnce(new Error('API error'));

    const result = await fetchPRDiff(123);
    expect(result).toBeUndefined();
  });

  test('truncates diff when it exceeds maxLines', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const longDiff = lines.join('\n');
    mockPullsGet.mockResolvedValueOnce({ data: longDiff });

    const result = await fetchPRDiff(123, 10);
    expect(result).toBeDefined();
    if (result) {
      expect(result.split('\n').length).toBe(11); // 10 lines + truncation message
      expect(result).toContain('truncated');
      expect(result).toContain('10 more lines');
    }
  });

  test('does not truncate diff within limit', async () => {
    const shortDiff = 'line 1\nline 2\nline 3';
    mockPullsGet.mockResolvedValueOnce({ data: shortDiff });

    const result = await fetchPRDiff(123, 1000);
    expect(result).toBe(shortDiff);
    expect(result).not.toContain('truncated');
  });

  test('uses default maxLines when not specified', async () => {
    const diff = 'diff content';
    mockPullsGet.mockResolvedValueOnce({ data: diff });

    const result = await fetchPRDiff(456);
    expect(result).toBe(diff);
    expect(mockPullsGet).toHaveBeenCalledWith(
      expect.objectContaining({
        pull_number: 456,
      })
    );
  });
});

describe('fetchPRReviewComments', () => {
  beforeEach(() => {
    mockPullsListReviewComments.mockClear();
    mockContext.repo = { owner: 'test-owner', repo: 'test-repo' };
  });

  test('returns formatted review comments from API', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [{
        path: 'src/index.ts',
        line: 42,
        original_line: null,
        side: 'RIGHT',
        user: { login: 'reviewer' },
        body: 'Please fix this',
        created_at: '2024-01-01T00:00:00Z',
      }] as any,
    });

    const result = await fetchPRReviewComments(123);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: 'src/index.ts',
      line: 42,
      author: 'reviewer',
      body: 'Please fix this',
      createdAt: '2024-01-01T00:00:00Z',
      side: 'RIGHT',
    });
  });

  test('returns empty array when no comments', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    const result = await fetchPRReviewComments(123);
    expect(result).toEqual([]);
  });

  test('returns empty array when API call fails', async () => {
    mockPullsListReviewComments.mockRejectedValueOnce(new Error('API error'));

    const result = await fetchPRReviewComments(123);
    expect(result).toEqual([]);
  });

  test('handles comment with null line gracefully', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [{
        path: 'src/file.ts',
        line: null,
        original_line: null,
        side: null,
        user: { login: 'dev' },
        body: 'General comment',
        created_at: '2024-06-01T00:00:00Z',
      }] as any,
    });

    const result = await fetchPRReviewComments(123);
    expect(result).toHaveLength(1);
    expect(result[0]!.line).toBeUndefined();
    expect(result[0]!.side).toBeUndefined();
  });

  test('handles comment with null user gracefully', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [{
        path: 'src/file.ts',
        line: 5,
        original_line: null,
        side: 'RIGHT',
        user: null,
        body: 'Comment from deleted user',
        created_at: '2024-01-01T00:00:00Z',
      }] as any,
    });

    const result = await fetchPRReviewComments(123);
    expect(result[0]!.author).toBe('unknown');
  });

  test('respects maxComments limit via per_page parameter', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    await fetchPRReviewComments(123, 5);
    expect(mockPullsListReviewComments).toHaveBeenCalledWith(
      expect.objectContaining({
        per_page: 5,
      })
    );
  });

  test('handles multiple comments', async () => {
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: 'src/a.ts',
          line: 10,
          original_line: null,
          side: 'RIGHT',
          user: { login: 'alice' },
          body: 'Fix A',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          path: 'src/b.ts',
          line: 20,
          original_line: null,
          side: 'LEFT',
          user: { login: 'bob' },
          body: 'Fix B',
          created_at: '2024-01-02T00:00:00Z',
        },
      ] as any,
    });

    const result = await fetchPRReviewComments(123);
    expect(result).toHaveLength(2);
    expect(result[0]!.author).toBe('alice');
    expect(result[1]!.author).toBe('bob');
  });
});

describe('getPrompt with PR diff inclusion', () => {
  beforeEach(() => {
    mockPullsGet.mockClear();
    mockPullsListReviewComments.mockClear();
    mockGetInput.mockClear();

    // Default mock implementations
    mockGetInput.mockImplementation((name: string): string => {
      if (name === 'github_token') { return 'fake-token'; }
      if (name === 'prompt') { return ''; }
      if (name === 'trigger') { return '/pi'; }
      if (name === 'include_pr_diff') { return 'true'; }
      if (name === 'max_diff_lines') { return '1000'; }
      return '';
    });

    // Default diff and review comments
    mockPullsGet.mockResolvedValue({ data: 'diff --git a/file.ts b/file.ts\n+added line\n' });
    mockPullsListReviewComments.mockResolvedValue({ data: [] });

    mockContext.repo = { owner: 'test-owner', repo: 'test-repo' };
    mockContext.payload = {};
    mockContext.eventName = 'issue_comment';
  });

  test('includes PR diff in prompt for PR context', async () => {
    const sampleDiff = 'diff --git a/src/fix.ts b/src/fix.ts\n+fix line\n';
    mockPullsGet.mockResolvedValueOnce({ data: sampleDiff });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Review this PR' },
      pull_request: {
        number: 42,
        title: 'Fix bug',
        body: 'This PR fixes the bug',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #42: Fix bug');
    expect(result).toContain('PR Diff:');
    expect(result).toContain('```diff');
    expect(result).toContain(sampleDiff);
    expect(result).toContain('Comment/Instruction:');
    expect(result).toContain('Review this PR');
  });

  test('includes review comments in prompt when present', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'diff content' });
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [{
        path: 'src/feature.ts',
        line: 10,
        original_line: null,
        side: 'RIGHT',
        user: { login: 'reviewer' },
        body: 'This needs error handling',
        created_at: '2024-01-01T00:00:00Z',
      }] as any,
    });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Address the review comments' },
      pull_request: {
        number: 55,
        title: 'Feature PR',
        body: 'Adds new feature',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('PR Review Comments (1):');
    expect(result).toContain('**src/feature.ts**');
    expect(result).toContain('(@reviewer)');
    expect(result).toContain('This needs error handling');
  });

  test('includes both diff and review comments', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'diff --git a/a.ts b/a.ts\n+new\n' });
    mockPullsListReviewComments.mockResolvedValueOnce({
      data: [
        {
          path: 'a.ts',
          line: 1,
          original_line: null,
          side: 'RIGHT',
          user: { login: 'alice' },
          body: 'Comment A',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          path: 'b.ts',
          line: 2,
          original_line: null,
          side: 'RIGHT',
          user: { login: 'bob' },
          body: 'Comment B',
          created_at: '2024-01-02T00:00:00Z',
        },
      ] as any,
    });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Fix the issues' },
      pull_request: {
        number: 77,
        title: 'Big PR',
        body: 'Multiple changes',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('PR Diff:');
    expect(result).toContain('```diff');
    expect(result).toContain('PR Review Comments (2):');
    expect(result).toContain('(@alice)');
    expect(result).toContain('(@bob)');
  });

  test('does not include diff when include_pr_diff is false', async () => {
    mockGetInput.mockImplementation((name: string): string => {
      if (name === 'github_token') { return 'fake-token'; }
      if (name === 'prompt') { return ''; }
      if (name === 'trigger') { return '/pi'; }
      if (name === 'include_pr_diff') { return 'false'; }
      return '';
    });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Review this' },
      pull_request: {
        number: 42,
        title: 'Fix bug',
        body: 'Bug fix',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #42: Fix bug');
    expect(result).not.toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
  });

  test('does not include diff for issue context', async () => {
    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Fix this issue' },
      issue: {
        number: 100,
        title: 'Bug report',
        body: 'Something is broken',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #100: Bug report');
    expect(result).not.toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
  });

  test('works without diff when diff is empty', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: '' });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: {
        number: 30,
        title: 'Empty PR',
        body: 'No changes',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #30: Empty PR');
    expect(result).not.toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
  });

  test('handles diff fetch failure gracefully', async () => {
    mockPullsGet.mockRejectedValueOnce(new Error('Network error'));
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: {
        number: 40,
        title: 'PR with API error',
        body: 'Test',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #40: PR with API error');
    expect(result).toContain('Comment/Instruction:');
  });

  test('handles review comments fetch failure gracefully', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'some diff' });
    mockPullsListReviewComments.mockRejectedValueOnce(new Error('Network error'));

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: {
        number: 50,
        title: 'PR with comment error',
        body: 'Test',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
  });

  test('uses custom max_diff_lines input', async () => {
    mockGetInput.mockImplementation((name: string): string => {
      if (name === 'github_token') { return 'fake-token'; }
      if (name === 'prompt') { return ''; }
      if (name === 'trigger') { return '/pi'; }
      if (name === 'include_pr_diff') { return 'true'; }
      if (name === 'max_diff_lines') { return '50'; }
      return '';
    });

    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const longDiff = lines.join('\n');
    mockPullsGet.mockResolvedValueOnce({ data: longDiff });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: {
        number: 60,
        title: 'Big PR',
        body: 'Many changes',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('truncated');
    expect(result).toContain('50 more lines');
  });

  test('ignores invalid max_diff_lines and uses default', async () => {
    mockGetInput.mockImplementation((name: string): string => {
      if (name === 'github_token') { return 'fake-token'; }
      if (name === 'prompt') { return ''; }
      if (name === 'trigger') { return '/pi'; }
      if (name === 'include_pr_diff') { return 'true'; }
      if (name === 'max_diff_lines') { return 'not-a-number'; }
      return '';
    });

    const diff = 'short diff';
    mockPullsGet.mockResolvedValueOnce({ data: diff });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Review' },
      pull_request: {
        number: 70,
        title: 'PR',
        body: 'Test',
      },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).toContain('PR Diff:');
    expect(result).toContain('short diff');
  });

  test('works with prompt input on PR context', async () => {
    mockPullsGet.mockResolvedValueOnce({ data: 'diff content' });
    mockPullsListReviewComments.mockResolvedValueOnce({ data: [] });

    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      pull_request: {
        number: 80,
        title: 'Headless PR',
        body: 'No comment',
      },
    };

    const result = await getPrompt('Analyze the changes');
    expect(result).toBeDefined();
    expect(result).toContain('Issue/PR #80: Headless PR');
    expect(result).toContain('PR Diff:');
    expect(result).toContain('Instruction:');
    expect(result).toContain('Analyze the changes');
  });

  test('diff not included for plain comment without PR context', async () => {
    mockContext.eventName = 'issue_comment';
    mockContext.payload = {
      comment: { id: 1, body: '/pi Help me' },
    };

    const result = await getPrompt();
    expect(result).toBeDefined();
    expect(result).not.toContain('PR Diff:');
    expect(result).not.toContain('PR Review Comments');
  });
});

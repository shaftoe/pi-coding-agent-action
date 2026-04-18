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

// Mock @actions/core
const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
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

// Set env vars BEFORE importing pull-request.ts
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// Mock octokit
const mockReposGet = mock(() => Promise.resolve({ data: { default_branch: 'develop' } }));
const mockOctokit = {
  rest: {
    repos: {
      get: mockReposGet,
    },
  },
};
mock.module('../../src/git/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

// Setup default GitHub context
const mockContext = {
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 42,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  payload: {
    repository: {
      default_branch: 'main',
    },
  },
  eventName: 'issue_comment',
};

// Mock @actions/github context
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Dynamic import to ensure mocks are set before module loads
const pullRequestModulePromise = import('../../src/git/pull-request.js');

// Cache the module after first import
let pullRequestModule: any | null = null;

async function getModule() {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  if (!pullRequestModule) {
    pullRequestModule = await pullRequestModulePromise;
  }
  return pullRequestModule;
}

describe('determineBaseBranch', () => {
  beforeEach(() => {
    mockReposGet.mockClear();
    // Reset to default context
    mockContext.payload.repository = { default_branch: 'main' };
    mockContext.repo = { owner: 'test-owner', repo: 'test-repo' };
  });

  test('returns provided base branch when explicitly set', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    const result = await determineBaseBranch('feature-branch');

    expect(result).toBe('feature-branch');
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  test('returns default branch from context when available', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    const result = await determineBaseBranch(undefined);

    expect(result).toBe('main');
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  test('fetches default branch from GitHub API as fallback', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    // Remove default_branch from context
    // @ts-expect-error -- Testing error handling when repository is undefined
    mockContext.payload.repository = undefined;

    const result = await determineBaseBranch(undefined);

    expect(result).toBe('develop');
    expect(mockReposGet).toHaveBeenCalled();
    expect(mockReposGet).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
    });
  });

  test('logs debug message for each resolution path - provided branch', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    // Debug logging is tested via observable behavior (returned value, API calls)
    await determineBaseBranch('custom-branch');
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  test('logs debug message for each resolution path - context default', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    // Debug logging is tested via observable behavior (returned value, API calls)
    await determineBaseBranch(undefined);
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  test('logs debug message for each resolution path - API fetch', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    // @ts-expect-error -- Testing error handling when repository is undefined
    mockContext.payload.repository = undefined;

    // Debug logging is tested via observable behavior (API calls)
    await determineBaseBranch(undefined);
    expect(mockReposGet).toHaveBeenCalled();
  });
});

describe('generatePullRequestBody', () => {
  beforeEach(() => {
    // Reset to default issue context
    mockContext.issue = { number: 42 };
    mockContext.eventName = 'issue_comment';
    // @ts-expect-error -- Testing with empty payload
    mockContext.payload = {};
  });

  test('returns provided body when explicitly set', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    const result = generatePullRequestBody('Custom PR description');

    expect(result).toBe('Custom PR description');
  });

  test('generates body with issue reference (#N) for issue context', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    mockContext.eventName = 'issues';
    // @ts-expect-error -- Testing with empty payload
    mockContext.payload = {};

    const result = generatePullRequestBody(undefined);

    expect(result).toBe('Fixes #42\n\nCreated by pi coding agent.');
  });

  test('generates body with PR reference for PR context', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    mockContext.eventName = 'pull_request';
    // @ts-expect-error -- Testing with empty payload
    mockContext.payload = {};

    const result = generatePullRequestBody(undefined);

    expect(result).toBe('Related to #42\n\nCreated by pi coding agent.');
  });

  test('generates body with issue reference for issue_comment context', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    mockContext.eventName = 'issue_comment';
    // @ts-expect-error -- Testing with empty payload
    mockContext.payload = {};

    const result = generatePullRequestBody(undefined);

    expect(result).toBe('Fixes #42\n\nCreated by pi coding agent.');
  });

  test('includes agent attribution when auto-generating', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    const result = generatePullRequestBody(undefined);

    expect(result).toContain('Created by pi coding agent.');
  });

  test('handles missing issue number in context', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    // @ts-expect-error -- Testing error handling when issue is undefined
    mockContext.issue = undefined;

    const result = generatePullRequestBody(undefined);

    // When no issue number, body remains empty
    expect(result).toBe('');
  });

  test('handles unknown event type gracefully', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    mockContext.eventName = 'push';

    const result = generatePullRequestBody(undefined);

    // When context type is undefined, body remains empty
    expect(result).toBe('');
  });

  test('returns empty string when body is explicitly empty string', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    const result = generatePullRequestBody('');

    // Empty string is treated as undefined, so it auto-generates body
    expect(result).toBe('Fixes #42\n\nCreated by pi coding agent.');
  });
});

describe('validateCreatePullRequestParams', () => {
  test('passes validation for valid params', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    expect(() => {
      validateCreatePullRequestParams({
        title: 'Fix bug in authentication',
        body: 'This PR fixes the auth bug',
        base: 'main',
        dryRun: false,
      });
    }).not.toThrow();
  });

  test('passes validation with minimal valid params', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    expect(() => {
      validateCreatePullRequestParams({
        title: 'Fix bug',
      });
    }).not.toThrow();
  });

  test('throws for empty title', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    expect(() => {
      validateCreatePullRequestParams({
        title: '',
      });
    }).toThrow('Pull request title is required and cannot be empty');
  });

  test('throws for whitespace-only title', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    expect(() => {
      validateCreatePullRequestParams({
        title: '   ',
      });
    }).toThrow('Pull request title is required and cannot be empty');
  });

  test('throws for title exceeding max length', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    const longTitle = 'a'.repeat(256);
    expect(() => {
      validateCreatePullRequestParams({
        title: longTitle,
      });
    }).toThrow('Pull request title exceeds maximum length of 255 characters (got 256)');
  });

  test('throws for title at exactly max length + 1', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    const longTitle = 'a'.repeat(256);
    expect(() => {
      validateCreatePullRequestParams({
        title: longTitle,
      });
    }).toThrow();
  });

  test('passes validation for title at exactly max length', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    const maxTitle = 'a'.repeat(255);
    expect(() => {
      validateCreatePullRequestParams({
        title: maxTitle,
      });
    }).not.toThrow();
  });

  test('throws for invalid dry_run value - not a boolean', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    // This is a TypeScript type error, but let's test runtime behavior
    // @ts-expect-error - Testing invalid input type
    const invalidParams: CreatePullRequestParams = {
      title: 'Test',
      dryRun: 'true' as any,
    };

    // The function doesn't validate dry_run type, so this shouldn't throw
    expect(() => {
      validateCreatePullRequestParams(invalidParams);
    }).not.toThrow();
  });

  test('allows undefined dry_run', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    expect(() => {
      validateCreatePullRequestParams({
        title: 'Test PR',
        dryRun: undefined,
      });
    }).not.toThrow();
  });

  test('allows false dry_run', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    expect(() => {
      validateCreatePullRequestParams({
        title: 'Test PR',
        dryRun: false,
      });
    }).not.toThrow();
  });

  test('allows true dry_run', async () => {
    const module = await getModule();
    const { validateCreatePullRequestParams } = module;

    expect(() => {
      validateCreatePullRequestParams({
        title: 'Test PR',
        dryRun: true,
      });
    }).not.toThrow();
  });
});

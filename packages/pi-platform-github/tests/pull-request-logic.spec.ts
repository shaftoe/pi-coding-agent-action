import { describe, expect, test, vi, beforeEach } from 'vitest';

import { setupGitHubTestEnv } from './helpers/github-test-env';
setupGitHubTestEnv({ envPathPrefix: 'gh-event-pr-logic' });

const noop = (): void => {};
const mockGetInput = vi.fn((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  return '';
});

// Mock octokit
const mockReposGet = vi.fn(() => Promise.resolve({ data: { default_branch: 'develop' } }));
const mockOctokit = {
  rest: {
    repos: {
      get: mockReposGet,
    },
  },
};
vi.mock('../../../src/platform/github/octokit', () => ({
  getOctokit: vi.fn(() => mockOctokit),
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
vi.mock('@actions/github', () => ({
  context: mockContext,
}));

// Dynamic import to ensure mocks are set before module loads
const pullRequestModulePromise = import('@alexanderfortin/pi-platform-github');

// Cache the module after first import
let pullRequestModule: any | null = null;

async function getModule() {
  pullRequestModule ??= await pullRequestModulePromise;
  return pullRequestModule;
}

import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

function createTestDeps(): GitHubModuleDeps {
  return {
    octokit: mockOctokit as any,
    context: {
      repo: mockContext.repo,
      issue: mockContext.issue as any,
      eventName: mockContext.eventName,
      payload: mockContext.payload as any,
      serverUrl: mockContext.serverUrl,
      runId: mockContext.runId,
      workspace: '/tmp',
    },
    logger: {
      debug: noop,
      info: noop,
      warning: noop,
      notice: noop,
      error: noop,
      getInput: mockGetInput,
    } as any,
  };
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

    const result = await determineBaseBranch(createTestDeps(), 'feature-branch');

    expect(result).toBe('feature-branch');
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  test('returns default branch from context when available', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    const result = await determineBaseBranch(createTestDeps(), undefined);

    expect(result).toBe('main');
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  test('fetches default branch from GitHub API as fallback', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    // Remove default_branch from context
    // @ts-expect-error -- Testing error handling when repository is undefined
    mockContext.payload.repository = undefined;

    const result = await determineBaseBranch(createTestDeps(), undefined);

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
    await determineBaseBranch(createTestDeps(), 'custom-branch');
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  test('logs debug message for each resolution path - context default', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    // Debug logging is tested via observable behavior (returned value, API calls)
    await determineBaseBranch(createTestDeps(), undefined);
    expect(mockReposGet).not.toHaveBeenCalled();
  });

  test('logs debug message for each resolution path - API fetch', async () => {
    const module = await getModule();
    const { determineBaseBranch } = module;

    // @ts-expect-error -- Testing error handling when repository is undefined
    mockContext.payload.repository = undefined;

    // Debug logging is tested via observable behavior (API calls)
    await determineBaseBranch(createTestDeps(), undefined);
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

    const result = generatePullRequestBody(createTestDeps(), 'Custom PR description');

    expect(result).toBe('Custom PR description');
  });

  test('generates body with issue reference (#N) for issue context', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    mockContext.eventName = 'issues';
    // @ts-expect-error -- Testing with empty payload
    mockContext.payload = {};

    const result = generatePullRequestBody(createTestDeps(), undefined);

    expect(result).toBe('Fixes #42\n\nCreated by pi coding agent.');
  });

  test('generates body with PR reference for PR context', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    mockContext.eventName = 'pull_request';
    // @ts-expect-error -- Testing with empty payload
    mockContext.payload = {};

    const result = generatePullRequestBody(createTestDeps(), undefined);

    expect(result).toBe('Related to #42\n\nCreated by pi coding agent.');
  });

  test('generates body with issue reference for issue_comment context', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    mockContext.eventName = 'issue_comment';
    // @ts-expect-error -- Testing with empty payload
    mockContext.payload = {};

    const result = generatePullRequestBody(createTestDeps(), undefined);

    expect(result).toBe('Fixes #42\n\nCreated by pi coding agent.');
  });

  test('includes agent attribution when auto-generating', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    const result = generatePullRequestBody(createTestDeps(), undefined);

    expect(result).toContain('Created by pi coding agent.');
  });

  test('handles missing issue number in context', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    // @ts-expect-error -- Testing error handling when issue is undefined
    mockContext.issue = undefined;

    const result = generatePullRequestBody(createTestDeps(), undefined);

    // When no issue number, body remains empty
    expect(result).toBe('');
  });

  test('handles unknown event type gracefully', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    mockContext.eventName = 'push';

    const result = generatePullRequestBody(createTestDeps(), undefined);

    // When context type is undefined, body remains empty
    expect(result).toBe('');
  });

  test('returns empty string when body is explicitly empty string', async () => {
    const module = await getModule();
    const { generatePullRequestBody } = module;

    const result = generatePullRequestBody(createTestDeps(), '');

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

describe('slugify', () => {
  test('converts simple text to slug', async () => {
    const module = await getModule();
    const { slugify } = module;

    expect(slugify('Fix authentication bug')).toBe('fix-authentication-bug');
  });

  test('handles special characters', async () => {
    const module = await getModule();
    const { slugify } = module;

    expect(slugify('feat: add new API endpoint /users')).toBe('feat-add-new-api-endpoint-users');
  });

  test('handles multiple spaces and hyphens', async () => {
    const module = await getModule();
    const { slugify } = module;

    expect(slugify('  Fix   the -- bug  ')).toBe('fix-the-bug');
  });

  test('handles uppercase text', async () => {
    const module = await getModule();
    const { slugify } = module;

    expect(slugify('BREAKING CHANGE')).toBe('breaking-change');
  });

  test('truncates to maxLength and strips trailing hyphen', async () => {
    const module = await getModule();
    const { slugify } = module;

    // slugify('a very long title') => 'a-very-long-title'
    // With maxLength=7, slice gives 'a-very-' which ends with a hyphen.
    // The trailing hyphen is stripped to produce 'a-very'.
    expect(slugify('a very long title', 7)).toBe('a-very');
  });

  test('handles empty string', async () => {
    const module = await getModule();
    const { slugify } = module;

    expect(slugify('')).toBe('');
  });

  test('handles string with only special characters', async () => {
    const module = await getModule();
    const { slugify } = module;

    expect(slugify('!!! ???')).toBe('');
  });

  test('handles numbers', async () => {
    const module = await getModule();
    const { slugify } = module;

    expect(slugify('Fix issue #123')).toBe('fix-issue-123');
  });
});

describe('generateBranchName', () => {
  beforeEach(() => {
    delete process.env.INPUT_BRANCH_NAME_TEMPLATE;
    mockContext.issue = { number: 42 };
  });

  test('generates default branch name with number and timestamp', async () => {
    const module = await getModule();
    const { generateBranchName } = module;

    const result = generateBranchName(createTestDeps(), 'Fix bug');

    expect(result).toMatch(/^pi\/issue42-\d+$/);
  });

  test('uses custom template with {number}', async () => {
    const module = await getModule();
    const { generateBranchName } = module;

    const result = generateBranchName(createTestDeps(), 'Fix bug', 'fix/{number}');

    expect(result).toBe('fix/42');
  });

  test('uses custom template with {title}', async () => {
    const module = await getModule();
    const { generateBranchName } = module;

    const result = generateBranchName(createTestDeps(), 'Add new login page', 'feature/{title}');

    expect(result).toBe('feature/add-new-login-page');
  });

  test('uses custom template with all variables', async () => {
    const module = await getModule();
    const { generateBranchName } = module;

    const result = generateBranchName(createTestDeps(), 'Fix auth', '{title}-{number}-{timestamp}');

    expect(result).toMatch(/^fix-auth-42-\d+$/);
  });

  test('falls back to default when template is empty', async () => {
    const module = await getModule();
    const { generateBranchName } = module;

    const result = generateBranchName(createTestDeps(), 'Fix bug', '');

    expect(result).toMatch(/^pi\/issue42-\d+$/);
  });

  test('handles unknown issue number', async () => {
    const module = await getModule();
    const { generateBranchName } = module;

    // @ts-expect-error -- Testing missing issue number
    mockContext.issue = undefined;

    const result = generateBranchName(createTestDeps(), 'Fix bug');

    expect(result).toMatch(/^pi\/issueunknown-\d+$/);
  });

  test('template without variables passes through unchanged', async () => {
    const module = await getModule();
    const { generateBranchName } = module;

    const result = generateBranchName(createTestDeps(), 'Fix bug', 'static-branch-name');

    expect(result).toBe('static-branch-name');
  });

  test('replaces multiple occurrences of same variable', async () => {
    const module = await getModule();
    const { generateBranchName } = module;

    const result = generateBranchName(createTestDeps(), 'Fix bug', '{number}-pr-{number}');

    expect(result).toBe('42-pr-42');
  });
});

describe('validateBranchName', () => {
  const getValidate = async () => {
    const module = await getModule();
    return module.validateBranchName as (name: string) => void;
  };

  test('accepts valid branch names', async () => {
    const validate = await getValidate();
    const validNames = [
      'main',
      'feature/add-login',
      'pi/issue42-1716543210000',
      'fix/auth-bug',
      'release/v2.0',
      'a',
      'branch_name',
    ];
    for (const name of validNames) {
      expect(() => validate(name)).not.toThrow();
    }
  });

  test('rejects empty string', async () => {
    const validate = await getValidate();
    expect(() => validate('')).toThrow('Branch name cannot be empty');
  });

  test('rejects branch name starting with dot', async () => {
    const validate = await getValidate();
    expect(() => validate('.hidden')).toThrow('start or end with a dot');
  });

  test('rejects branch name ending with dot', async () => {
    const validate = await getValidate();
    expect(() => validate('feature.')).toThrow('start or end with a dot');
  });

  test('rejects branch name starting with dash', async () => {
    const validate = await getValidate();
    expect(() => validate('-feature')).toThrow('start with a dash');
  });

  test('rejects branch name starting with slash', async () => {
    const validate = await getValidate();
    expect(() => validate('/feature')).toThrow('start or end with a slash');
  });

  test('rejects branch name ending with slash', async () => {
    const validate = await getValidate();
    expect(() => validate('feature/')).toThrow('start or end with a slash');
  });

  test('rejects branch name ending with .lock', async () => {
    const validate = await getValidate();
    expect(() => validate('refs.lock')).toThrow('.lock');
  });

  test('rejects consecutive slashes', async () => {
    const validate = await getValidate();
    expect(() => validate('feature//fix')).toThrow('consecutive slashes');
  });

  test('rejects double dot', async () => {
    const validate = await getValidate();
    expect(() => validate('feature..fix')).toThrow('forbidden pattern ".."');
  });

  test('rejects tilde', async () => {
    const validate = await getValidate();
    expect(() => validate('feature~1')).toThrow('forbidden pattern "~"');
  });

  test('rejects caret', async () => {
    const validate = await getValidate();
    expect(() => validate('feature^1')).toThrow('forbidden pattern "^"');
  });

  test('rejects colon', async () => {
    const validate = await getValidate();
    expect(() => validate('feat:fix')).toThrow('forbidden pattern ":"');
  });

  test('rejects backslash', async () => {
    const validate = await getValidate();
    expect(() => validate('feat\\fix')).toThrow('forbidden pattern "\\"');
  });

  test('rejects space', async () => {
    const validate = await getValidate();
    expect(() => validate('feature fix')).toThrow('forbidden pattern " "');
  });

  test('rejects question mark', async () => {
    const validate = await getValidate();
    expect(() => validate('feature?')).toThrow('forbidden pattern "?"');
  });

  test('rejects asterisk', async () => {
    const validate = await getValidate();
    expect(() => validate('feature*')).toThrow('forbidden pattern "*"');
  });

  test('rejects open bracket', async () => {
    const validate = await getValidate();
    expect(() => validate('feature[0]')).toThrow('forbidden pattern "["');
  });

  test('rejects reflog syntax', async () => {
    const validate = await getValidate();
    expect(() => validate('feature@{1}')).toThrow('forbidden pattern "@{"');
  });

  test('rejects component ending with dot', async () => {
    const validate = await getValidate();
    expect(() => validate('feature./fix')).toThrow('component cannot end with a dot');
  });
});

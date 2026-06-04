import { describe, expect, test, mock, beforeEach } from 'bun:test';

import { setupGitHubTestEnv } from './helpers/github-test-env';
setupGitHubTestEnv({ envPathPrefix: 'gh-event-pr-logic' });

// Setup default GitHub context
const mockContext = {
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 123,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  payload: {},
  eventName: 'pull_request',
};

// Mock @actions/github context
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Dynamic import to ensure mocks are set before module loads
const pullRequestUpdateModulePromise = import('@alexanderfortin/pi-platform-github');

// Cache the module after first import
let pullRequestUpdateModule: any | null = null;

async function getModule() {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  if (!pullRequestUpdateModule) {
    pullRequestUpdateModule = await pullRequestUpdateModulePromise;
  }
  return pullRequestUpdateModule;
}

// Type for test use (extracted from the module)
interface _UpdatePullRequestParams {
  pull_number?: number;
  title?: string;
  body?: string;
  message?: string;
  dryRun?: boolean;
}

describe('validateUpdatePullRequestParams', () => {
  beforeEach(() => {
    // Reset to default context
    mockContext.issue = { number: 123 };
  });

  test('throws when all optional params are omitted (no context check in validator)', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({});
    }).toThrow('At least one update parameter');
  });

  test('passes validation with title provided', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        title: 'Updated PR title',
      });
    }).not.toThrow();
  });

  test('passes validation with body provided', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        body: 'Updated PR description',
      });
    }).not.toThrow();
  });

  test('passes validation with message provided', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        message: 'Update PR with new changes',
      });
    }).not.toThrow();
  });

  test('passes validation with both title and body', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        title: 'Updated title',
        body: 'Updated body',
      });
    }).not.toThrow();
  });

  test('passes validation with all content params provided', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        pull_number: 456,
        title: 'Updated title',
        body: 'Updated body',
        message: 'Commit message',
      });
    }).not.toThrow();
  });

  test('passes validation with pull_number provided but no content', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        pull_number: 456,
      });
    }).not.toThrow();
  });

  test('passes validation for title at exactly max length', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    const maxTitle = 'a'.repeat(255);
    expect(() => {
      validateUpdatePullRequestParams({
        title: maxTitle,
      });
    }).not.toThrow();
  });

  test('throws for title exceeding max length', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    const longTitle = 'a'.repeat(256);
    expect(() => {
      validateUpdatePullRequestParams({
        title: longTitle,
      });
    }).toThrow('Pull request title exceeds maximum length of 255 characters (got 256)');
  });

  test('throws when no params provided and no context PR number', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    // @ts-expect-error -- Testing error handling when issue is undefined
    mockContext.issue = undefined;

    expect(() => {
      validateUpdatePullRequestParams({});
    }).toThrow(
      'At least one update parameter (title, body, message, or pull_number) must be provided'
    );
  });

  test('throws when all content params are undefined and no context PR number', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    // @ts-expect-error -- Testing error handling when issue is undefined
    mockContext.issue = undefined;

    expect(() => {
      validateUpdatePullRequestParams({
        title: undefined,
        body: undefined,
        message: undefined,
        pull_number: undefined,
      });
    }).toThrow(
      'At least one update parameter (title, body, message, or pull_number) must be provided'
    );
  });

  test('allows undefined dry_run', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        title: 'Test',
        dryRun: undefined,
      });
    }).not.toThrow();
  });

  test('allows false dry_run', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        title: 'Test',
        dryRun: false,
      });
    }).not.toThrow();
  });

  test('allows true dry_run', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        title: 'Test',
        dryRun: true,
      });
    }).not.toThrow();
  });

  test('does not validate dry_run type - runtime check only', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    // The function doesn't validate dry_run type, so this shouldn't throw
    const invalidParams: _UpdatePullRequestParams = {
      title: 'Test',
      dryRun: 'true' as any,
    };

    expect(() => {
      validateUpdatePullRequestParams(invalidParams);
    }).not.toThrow();
  });

  test('passes validation with only pull_number provided (no content)', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    // @ts-expect-error -- Testing with undefined issue to test pull_number param
    mockContext.issue = undefined;

    expect(() => {
      validateUpdatePullRequestParams({
        pull_number: 999,
      });
    }).not.toThrow();
  });

  test('passes validation with message and title (typical usage)', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        message: 'Fix bug in authentication',
        title: 'Fix auth bug',
      });
    }).not.toThrow();
  });

  test('passes validation with message only', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    expect(() => {
      validateUpdatePullRequestParams({
        message: 'Update README with new instructions',
      });
    }).not.toThrow();
  });

  test('passes validation with empty string title (handled by GitHub)', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    // Empty title passes validation (GitHub API will handle it)
    expect(() => {
      validateUpdatePullRequestParams({
        title: '',
      });
    }).not.toThrow();
  });

  test('passes validation with empty string body (handled by GitHub)', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    // Empty body passes validation (GitHub API will handle it)
    expect(() => {
      validateUpdatePullRequestParams({
        body: '',
      });
    }).not.toThrow();
  });

  test('passes validation with empty string message (handled by code)', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    // Empty message is handled by generating a commit message
    expect(() => {
      validateUpdatePullRequestParams({
        message: '',
      });
    }).not.toThrow();
  });

  test('throws for title at exactly max length + 1', async () => {
    const module = await getModule();
    const { validateUpdatePullRequestParams } = module;

    const longTitle = 'a'.repeat(256);
    expect(() => {
      validateUpdatePullRequestParams({
        title: longTitle,
      });
    }).toThrow();
  });
});

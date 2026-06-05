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

describe('buildSuccessReport', () => {
  const baseInput = {
    pullNumber: 42,
    prUrl: 'https://github.com/test-owner/test-repo/pull/42',
    headBranch: 'feat',
    baseBranch: 'main',
    commitSha: undefined as string | undefined,
    titleUpdated: undefined as boolean | undefined,
    bodyUpdated: undefined as boolean | undefined,
  };

  function textOf(result: { content: { type: string; text: string }[] }) {
    return result.content[0]!.text;
  }

  test('always includes header with PR number and URL; dryRun=false', async () => {
    const module = await getModule();
    const { buildSuccessReport } = module;

    const out = buildSuccessReport(baseInput);
    expect(textOf(out)).toBe(
      'Pull request #42 updated: https://github.com/test-owner/test-repo/pull/42'
    );
    expect(out.details).toEqual({
      pullRequestNumber: 42,
      pullRequestUrl: baseInput.prUrl,
      headBranch: 'feat',
      baseBranch: 'main',
      dryRun: false,
    });
  });

  test('includes New commit line + details.commitSha when commitSha is set', async () => {
    const module = await getModule();
    const { buildSuccessReport } = module;

    const out = buildSuccessReport({ ...baseInput, commitSha: 'abc123' });
    expect(textOf(out)).toContain('- New commit: abc123');
    expect(out.details.commitSha).toBe('abc123');
  });

  test('omits commit line when commitSha is undefined', async () => {
    const module = await getModule();
    const { buildSuccessReport } = module;

    const out = buildSuccessReport(baseInput);
    expect(textOf(out)).not.toContain('New commit');
    expect(out.details.commitSha).toBeUndefined();
  });

  test('includes Title updated line + details.titleUpdated when true', async () => {
    const module = await getModule();
    const { buildSuccessReport } = module;

    const out = buildSuccessReport({ ...baseInput, titleUpdated: true });
    expect(textOf(out)).toContain('- Title updated');
    expect(out.details.titleUpdated).toBe(true);
  });

  test('omits Title line when titleUpdated is undefined', async () => {
    const module = await getModule();
    const { buildSuccessReport } = module;

    const out = buildSuccessReport(baseInput);
    expect(textOf(out)).not.toContain('Title');
    expect(out.details.titleUpdated).toBeUndefined();
  });

  test('includes Description updated line + details.bodyUpdated when true', async () => {
    const module = await getModule();
    const { buildSuccessReport } = module;

    const out = buildSuccessReport({ ...baseInput, bodyUpdated: true });
    expect(textOf(out)).toContain('- Description updated');
    expect(out.details.bodyUpdated).toBe(true);
  });

  test('omits Description line when bodyUpdated is undefined', async () => {
    const module = await getModule();
    const { buildSuccessReport } = module;

    const out = buildSuccessReport(baseInput);
    expect(textOf(out)).not.toContain('Description');
    expect(out.details.bodyUpdated).toBeUndefined();
  });

  test('all-three-set produces ordered lines and full details payload', async () => {
    const module = await getModule();
    const { buildSuccessReport } = module;

    const out = buildSuccessReport({
      ...baseInput,
      commitSha: 'deadbeef',
      titleUpdated: true,
      bodyUpdated: true,
    });
    const lines = textOf(out).split('\n');
    expect(lines).toEqual([
      'Pull request #42 updated: https://github.com/test-owner/test-repo/pull/42',
      '- New commit: deadbeef',
      '- Title updated',
      '- Description updated',
    ]);
    expect(out.details).toEqual({
      pullRequestNumber: 42,
      pullRequestUrl: baseInput.prUrl,
      headBranch: 'feat',
      baseBranch: 'main',
      dryRun: false,
      commitSha: 'deadbeef',
      titleUpdated: true,
      bodyUpdated: true,
    });
  });
});

describe('generateCommitMessage', () => {
  test('returns explicit message as-is when truthy', async () => {
    const module = await getModule();
    const { generateCommitMessage } = module;

    expect(generateCommitMessage('Custom msg', [], [], 42)).toBe('Custom msg');
  });

  test('treats empty string as no message (generates default)', async () => {
    const module = await getModule();
    const { generateCommitMessage } = module;

    expect(generateCommitMessage('', [{ path: 'a.ts' }], [], 7)).toBe(
      'Update PR #7: 1 modified/new file(s)'
    );
  });

  test('treats undefined as no message (generates default)', async () => {
    const module = await getModule();
    const { generateCommitMessage } = module;

    expect(generateCommitMessage(undefined, [{ path: 'a.ts' }], [], 7)).toBe(
      'Update PR #7: 1 modified/new file(s)'
    );
  });

  test('only-changed case: includes only modified/new count', async () => {
    const module = await getModule();
    const { generateCommitMessage } = module;

    const out = generateCommitMessage(undefined, [{ path: 'a' }, { path: 'b' }], [], 99);
    expect(out).toBe('Update PR #99: 2 modified/new file(s)');
    expect(out).not.toContain('deleted');
  });

  test('only-deleted case: includes only deleted count', async () => {
    const module = await getModule();
    const { generateCommitMessage } = module;

    const out = generateCommitMessage(undefined, [], ['x.ts', 'y.ts'], 99);
    expect(out).toBe('Update PR #99: 2 deleted file(s)');
    expect(out).not.toContain('modified/new');
  });

  test('both-changed-and-deleted case: joins with comma', async () => {
    const module = await getModule();
    const { generateCommitMessage } = module;

    expect(
      generateCommitMessage(undefined, [{ path: 'a' }, { path: 'b' }, { path: 'c' }], ['old'], 5)
    ).toBe('Update PR #5: 3 modified/new file(s), 1 deleted file(s)');
  });

  test('both-empty case: produces trailing colon (preserves prior behavior)', async () => {
    const module = await getModule();
    const { generateCommitMessage } = module;

    // Caller is expected to only invoke this when at least one list is non-empty,
    // but we preserve the legacy output shape rather than throwing.
    expect(generateCommitMessage(undefined, [], [], 1)).toBe('Update PR #1: ');
  });
});

describe('buildDryRunReport', () => {
  const baseInput = {
    pullNumber: 42,
    headBranch: 'feat',
    baseBranch: 'main',
    prUrl: 'https://github.com/test-owner/test-repo/pull/42',
    changedFiles: [] as { path: string }[],
    deletedFiles: [] as string[],
  };

  function textOf(result: { content: { type: string; text: string }[] }) {
    return result.content[0]!.text;
  }

  test('always includes header and branch info', async () => {
    const module = await getModule();
    const { buildDryRunReport } = module;

    const out = buildDryRunReport(baseInput);
    expect(textOf(out)).toContain('[DRY RUN] Would update pull request #42:');
    expect(textOf(out)).toContain('- Head branch: feat');
    expect(textOf(out)).toContain('- Base branch: main');
    expect(out.details.dryRun).toBe(true);
    expect(out.details.pullRequestNumber).toBe(42);
    expect(out.details.pullRequestUrl).toBe(baseInput.prUrl);
    expect(out.details.headBranch).toBe('feat');
    expect(out.details.baseBranch).toBe('main');
  });

  test('reports no code changes when both lists are empty', async () => {
    const module = await getModule();
    const { buildDryRunReport } = module;

    const out = buildDryRunReport(baseInput);
    expect(textOf(out)).toContain('- No code changes detected');
    expect(textOf(out)).not.toContain('- Code changes:');
  });

  test('includes only modified count when changedFiles > 0', async () => {
    const module = await getModule();
    const { buildDryRunReport } = module;

    const out = buildDryRunReport({
      ...baseInput,
      changedFiles: [{ path: 'a.ts' }, { path: 'b.ts' }],
    });
    expect(textOf(out)).toContain('- Code changes:');
    expect(textOf(out)).toContain('  - 2 modified/new file(s)');
    expect(textOf(out)).not.toContain('deleted file(s)');
  });

  test('includes only deleted count when deletedFiles > 0', async () => {
    const module = await getModule();
    const { buildDryRunReport } = module;

    const out = buildDryRunReport({
      ...baseInput,
      deletedFiles: ['old.ts'],
    });
    expect(textOf(out)).toContain('- Code changes:');
    expect(textOf(out)).toContain('  - 1 deleted file(s)');
    expect(textOf(out)).not.toContain('modified/new file(s)');
  });

  test('includes both counts when both lists non-empty', async () => {
    const module = await getModule();
    const { buildDryRunReport } = module;

    const out = buildDryRunReport({
      ...baseInput,
      changedFiles: [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }],
      deletedFiles: ['old.ts', 'older.ts'],
    });
    expect(textOf(out)).toContain('  - 3 modified/new file(s)');
    expect(textOf(out)).toContain('  - 2 deleted file(s)');
  });

  test('omits title line when title is undefined', async () => {
    const module = await getModule();
    const { buildDryRunReport } = module;

    const out = buildDryRunReport({ ...baseInput, body: 'B' });
    expect(textOf(out)).not.toContain('- Title:');
    expect(textOf(out)).toContain('- Body: B');
  });

  test('omits body line when body is undefined', async () => {
    const module = await getModule();
    const { buildDryRunReport } = module;

    const out = buildDryRunReport({ ...baseInput, title: 'T' });
    expect(textOf(out)).toContain('- Title: T');
    expect(textOf(out)).not.toContain('- Body:');
  });

  test('includes both title and body when both provided', async () => {
    const module = await getModule();
    const { buildDryRunReport } = module;

    const out = buildDryRunReport({ ...baseInput, title: 'T', body: 'B' });
    expect(textOf(out)).toContain('- Title: T');
    expect(textOf(out)).toContain('- Body: B');
  });
});

describe('fetchPullRequestData', () => {
  function createDeps(octokitGet: ReturnType<typeof mock>) {
    return {
      context: mockContext,
      octokit: { rest: { pulls: { get: octokitGet } } },
      logger: {
        debug: mock(() => {}),
        info: mock(() => {}),
        warning: mock(() => {}),
        notice: mock(() => {}),
        error: mock(() => {}),
      },
    } as any;
  }

  test('returns branch info and URL on a 200 response', async () => {
    const module = await getModule();
    const { fetchPullRequestData } = module;

    const get = mock(() =>
      Promise.resolve({
        status: 200,
        data: {
          number: 42,
          head: { ref: 'feat', sha: 'abc' },
          base: { ref: 'main' },
          html_url: 'https://github.com/test-owner/test-repo/pull/42',
        },
      })
    );

    const info = await fetchPullRequestData(createDeps(get), 42);
    expect(info).toEqual({
      headBranch: 'feat',
      baseBranch: 'main',
      headSha: 'abc',
      prUrl: 'https://github.com/test-owner/test-repo/pull/42',
    });
    expect(get).toHaveBeenCalledWith({
      owner: 'test-owner',
      repo: 'test-repo',
      pull_number: 42,
    });
  });

  test('throws when status is not 200', async () => {
    const module = await getModule();
    const { fetchPullRequestData } = module;

    const get = mock(() => Promise.resolve({ status: 404, data: null }));
    await expect(fetchPullRequestData(createDeps(get), 99)).rejects.toThrow(
      /Could not fetch pull request #99/
    );
  });

  test('throws when data is null despite 200', async () => {
    const module = await getModule();
    const { fetchPullRequestData } = module;

    const get = mock(() => Promise.resolve({ status: 200, data: null }));
    await expect(fetchPullRequestData(createDeps(get), 7)).rejects.toThrow(
      /Could not fetch pull request #7/
    );
  });

  test('propagates underlying octokit errors', async () => {
    const module = await getModule();
    const { fetchPullRequestData } = module;

    const get = mock(() => Promise.reject(new Error('network down')));
    await expect(fetchPullRequestData(createDeps(get), 1)).rejects.toThrow('network down');
  });
});

describe('resolvePullRequestNumber', () => {
  beforeEach(() => {
    mockContext.issue = { number: 123 };
  });

  test('returns explicit pull_number when provided', async () => {
    const module = await getModule();
    const { resolvePullRequestNumber } = module;

    const deps = { context: mockContext } as any;
    expect(resolvePullRequestNumber(deps, 789)).toBe(789);
  });

  test('falls back to context.issue.number when pull_number is undefined', async () => {
    const module = await getModule();
    const { resolvePullRequestNumber } = module;

    const deps = { context: mockContext } as any;
    expect(resolvePullRequestNumber(deps, undefined)).toBe(123);
  });

  test('throws when neither pull_number nor context.issue.number is available', async () => {
    const module = await getModule();
    const { resolvePullRequestNumber } = module;

    // @ts-expect-error -- Testing error handling when issue is undefined
    mockContext.issue = undefined;
    const deps = { context: mockContext } as any;

    expect(() => resolvePullRequestNumber(deps, undefined)).toThrow(
      'Pull request number not provided and not available in context'
    );
  });

  test('explicit pull_number wins over context.issue.number', async () => {
    const module = await getModule();
    const { resolvePullRequestNumber } = module;

    const deps = { context: mockContext } as any;
    mockContext.issue = { number: 999 };
    expect(resolvePullRequestNumber(deps, 1)).toBe(1);
  });
});

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

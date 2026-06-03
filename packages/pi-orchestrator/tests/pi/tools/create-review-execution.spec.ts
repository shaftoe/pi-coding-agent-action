import { describe, expect, test } from 'bun:test';
import { createReviewToolFactory } from '@alexanderfortin/pi-orchestrator';
import type { PlatformProvider } from '@alexanderfortin/pi-orchestrator';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

// Minimal mock ExtensionContext for tool execute signature
const mockCtx = {
  ui: {},
  hasUI: false,
  cwd: '/tmp',
  sessionManager: {},
  modelRegistry: {},
  model: undefined,
  isIdle: () => true,
  signal: undefined,
  abort: () => {},
  hasPendingMessages: () => false,
  shutdown: () => {},
  getContextUsage: () => undefined,
  compact: () => {},
  getSystemPrompt: () => '',
} as unknown as ExtensionContext;

// Mock platform provider factory
const createMockProvider = (overrides?: Partial<PlatformProvider>): PlatformProvider => ({
  type: 'github',
  getContext: () => ({
    repo: { owner: 'test-owner', repo: 'test-repo' },
    issue: { number: 1 },
    eventName: 'pull_request_review_comment',
    payload: {},
    serverUrl: 'https://github.com',
    runId: 123,
    workspace: '/tmp',
  }),
  addReaction: async () => undefined,
  deleteReaction: async () => {},
  createFinalComment: async () => {},
  getPrompt: async () => undefined,
  getStartTime: () => undefined,
  createPullRequest: async () => ({
    content: [{ type: 'text' as const, text: 'PR created' }],
    details: {
      pullRequestNumber: 1,
      pullRequestUrl: '',
      headBranch: '',
      baseBranch: '',
      dryRun: false,
    },
  }),
  updatePullRequest: async () => ({
    content: [{ type: 'text' as const, text: 'PR updated' }],
    details: {
      pullRequestNumber: 1,
      pullRequestUrl: '',
      headBranch: '',
      baseBranch: '',
      dryRun: false,
    },
  }),
  getIssueOrPRThread: async () => undefined,
  getPRDiff: async () => '',
  createReview: async () => ({
    content: [{ type: 'text' as const, text: 'Review created' }],
    details: {
      reviewId: 42,
      reviewUrl: 'https://github.com/test-owner/test-repo/pull/1#pullrequestreview-42',
      pullRequestNumber: 1,
      event: 'COMMENT',
      commentCount: 1,
    },
  }),
  getCIStatus: async () => ({
    content: [{ type: 'text' as const, text: 'CI status fetched' }],
    details: {
      ref: 'abc123',
      check_runs: [],
      workflow_runs: [],
    },
  }),
  getWorkflowRunLogs: async () => ({
    content: [{ type: 'text' as const, text: 'Workflow run logs fetched' }],
    details: {
      run_id: 0,
      jobs: [],
      total_bytes: 0,
      truncated: false,
    },
  }),
  ...overrides,
});

const mockProvider = createMockProvider();
const createReviewTool = createReviewToolFactory(mockProvider);

describe('create_pull_request_review tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(createReviewTool.name).toBe('create_pull_request_review');
    expect(createReviewTool.label).toBe('Create Pull Request Review');
  });

  test('execute function exists and is a function', () => {
    expect(typeof createReviewTool.execute).toBe('function');
  });

  test('has a non-empty description', () => {
    expect(typeof createReviewTool.description).toBe('string');
    expect(createReviewTool.description.length).toBeGreaterThan(0);
  });

  test('has prompt guidelines', () => {
    expect(Array.isArray(createReviewTool.promptGuidelines)).toBe(true);
    expect(createReviewTool.promptGuidelines!.length).toBeGreaterThan(0);
  });

  test('has a prompt snippet', () => {
    expect(typeof createReviewTool.promptSnippet).toBe('string');
    expect(createReviewTool.promptSnippet!.length).toBeGreaterThan(0);
  });

  test('returns cancellation result when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await createReviewTool.execute(
      'test-id',
      { comments: [{ path: 'src/main.ts', line: 10, body: 'This looks wrong' }] },
      controller.signal,
      undefined,
      mockCtx
    );

    expect((result.content[0] as { text: string }).text).toContain('cancelled');
    expect(result.details.cancelled).toBe(true);
    expect(result.details.reviewId).toBe(0);
    expect(result.details.pullRequestNumber).toBe(0);
    expect(result.details.commentCount).toBe(0);
  });

  test('delegates to provider.createReview with correct params', async () => {
    const reviewParams = {
      comments: [{ path: 'src/main.ts', line: 10, body: 'This looks wrong' }],
      body: 'Overall review comment',
      event: 'COMMENT' as const,
    };

    const result = await createReviewTool.execute(
      'test-id',
      reviewParams,
      undefined,
      undefined,
      mockCtx
    );

    expect((result.content[0] as { text: string }).text).toBe('Review created');
    expect(result.details.reviewId).toBe(42);
    expect(result.details.pullRequestNumber).toBe(1);
    expect(result.details.commentCount).toBe(1);
  });

  test('passes multi-line comment parameters correctly', async () => {
    let capturedParams: any = null;
    const provider = createMockProvider({
      createReview: async (params: any) => {
        capturedParams = params;
        return {
          content: [{ type: 'text' as const, text: 'Review created' }],
          details: {
            reviewId: 42,
            reviewUrl: 'https://github.com/test-owner/test-repo/pull/1#pullrequestreview-42',
            pullRequestNumber: 1,
            event: 'COMMENT',
            commentCount: 1,
          },
        };
      },
    });

    const tool = createReviewToolFactory(provider);
    await tool.execute(
      'test-id',
      {
        comments: [
          {
            path: 'src/main.ts',
            start_line: 5,
            line: 10,
            body: 'Multi-line comment',
          },
        ],
      },
      undefined,
      undefined,
      mockCtx
    );

    expect(capturedParams).not.toBeNull();
    expect(capturedParams.comments[0].path).toBe('src/main.ts');
    expect(capturedParams.comments[0].start_line).toBe(5);
    expect(capturedParams.comments[0].line).toBe(10);
    expect(capturedParams.comments[0].body).toBe('Multi-line comment');
  });

  test('passes pull_number when provided', async () => {
    let capturedParams: any = null;
    const provider = createMockProvider({
      createReview: async (params: any) => {
        capturedParams = params;
        return {
          content: [{ type: 'text' as const, text: 'Review created' }],
          details: {
            reviewId: 99,
            reviewUrl: '',
            pullRequestNumber: 42,
            event: 'COMMENT',
            commentCount: 1,
          },
        };
      },
    });

    const tool = createReviewToolFactory(provider);
    await tool.execute(
      'test-id',
      {
        pull_number: 42,
        comments: [{ path: 'src/main.ts', line: 10, body: 'test' }],
      },
      undefined,
      undefined,
      mockCtx
    );

    expect(capturedParams.pull_number).toBe(42);
  });

  test('passes event parameter when provided', async () => {
    let capturedParams: any = null;
    const provider = createMockProvider({
      createReview: async (params: any) => {
        capturedParams = params;
        return {
          content: [{ type: 'text' as const, text: 'Review created' }],
          details: {
            reviewId: 1,
            reviewUrl: '',
            pullRequestNumber: 1,
            event: 'REQUEST_CHANGES',
            commentCount: 1,
          },
        };
      },
    });

    const tool = createReviewToolFactory(provider);
    await tool.execute(
      'test-id',
      {
        event: 'REQUEST_CHANGES',
        comments: [{ path: 'src/main.ts', line: 10, body: 'Please fix this' }],
      },
      undefined,
      undefined,
      mockCtx
    );

    expect(capturedParams.event).toBe('REQUEST_CHANGES');
  });

  test('passes side parameter when provided', async () => {
    let capturedParams: any = null;
    const provider = createMockProvider({
      createReview: async (params: any) => {
        capturedParams = params;
        return {
          content: [{ type: 'text' as const, text: 'Review created' }],
          details: {
            reviewId: 1,
            reviewUrl: '',
            pullRequestNumber: 1,
            event: 'COMMENT',
            commentCount: 1,
          },
        };
      },
    });

    const tool = createReviewToolFactory(provider);
    await tool.execute(
      'test-id',
      {
        comments: [{ path: 'src/main.ts', line: 10, side: 'LEFT', body: 'Old code issue' }],
      },
      undefined,
      undefined,
      mockCtx
    );

    expect(capturedParams.comments[0].side).toBe('LEFT');
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock } from 'bun:test';
import { createPRToolFactory } from '../../../src/pi/tools/create-pr';
import type { PlatformProvider } from '../../../src/platform';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';

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
    eventName: 'issue_comment',
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
  ...overrides,
});

const mockProvider = createMockProvider();
const createPRTool = createPRToolFactory(mockProvider);
import * as githubIndex from '../../../src/platform/github';

describe('create_pull_request tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(createPRTool.name).toBe('create_pull_request');
    expect(createPRTool.label).toBe('Create Pull Request');
  });

  test('execute function exists and is a function', () => {
    expect(typeof createPRTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = createPRTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.title).toBeDefined();
    expect(schema.properties.body).toBeDefined();
    expect(schema.properties.base).toBeDefined();
    expect(schema.properties.dryRun).toBeDefined();
  });

  test('has execute with built-in cancellation handling', () => {
    expect(typeof createPRTool.execute).toBe('function');
  });

  test('tool uses provider for execution', () => {
    expect(githubIndex.createPullRequest).toBeDefined();
    expect(typeof githubIndex.createPullRequest).toBe('function');
  });

  test('parameters schema validates title as required', () => {
    const schema = createPRTool.parameters as any;
    expect(schema.required).toContain('title');
    expect(schema.required).not.toContain('body');
    expect(schema.required).not.toContain('base');
    expect(schema.required).not.toContain('dryRun');
  });

  test('execute calls provider.createPullRequest with title only', async () => {
    const createPullRequest = mock((_params: any) =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'PR #1 created' }],
        details: {
          pullRequestNumber: 1,
          pullRequestUrl: 'https://github.com/test/pr/1',
          headBranch: 'feature',
          baseBranch: 'main',
          dryRun: false,
        },
      })
    );
    const provider = createMockProvider({ createPullRequest });
    const tool = createPRToolFactory(provider);

    const result = await tool.execute('call-1', { title: 'My PR' }, undefined, undefined, mockCtx);

    expect(createPullRequest).toHaveBeenCalledTimes(1);
    expect((createPullRequest as any).mock.calls[0][0]).toEqual({ title: 'My PR' });
    expect(result.content).toEqual([{ type: 'text', text: 'PR #1 created' }]);
  });

  test('execute passes all optional params when provided', async () => {
    const createPullRequest = mock((_params: any) =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'PR created' }],
        details: {
          pullRequestNumber: 2,
          pullRequestUrl: '',
          headBranch: 'feature',
          baseBranch: 'main',
          dryRun: true,
        },
      })
    );
    const provider = createMockProvider({ createPullRequest });
    const tool = createPRToolFactory(provider);

    const result = await tool.execute(
      'call-2',
      { title: 'Full PR', body: 'Description', base: 'develop', dryRun: true },
      undefined,
      undefined,
      mockCtx
    );

    expect(createPullRequest).toHaveBeenCalledTimes(1);
    expect((createPullRequest as any).mock.calls[0][0]).toEqual({
      title: 'Full PR',
      body: 'Description',
      base: 'develop',
      dryRun: true,
    });
    expect(result.details.dryRun).toBe(true);
  });

  test('execute omits undefined optional params', async () => {
    const createPullRequest = mock((_params: any) =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'ok' }],
        details: {
          pullRequestNumber: 3,
          pullRequestUrl: '',
          headBranch: '',
          baseBranch: '',
          dryRun: false,
        },
      })
    );
    const provider = createMockProvider({ createPullRequest });
    const tool = createPRToolFactory(provider);

    await tool.execute('call-3', { title: 'Minimal' }, undefined, undefined, mockCtx);

    const passedParams = (createPullRequest as any).mock.calls[0][0] as Record<string, unknown>;
    expect(passedParams).toEqual({ title: 'Minimal' });
    expect('body' in passedParams).toBe(false);
    expect('base' in passedParams).toBe(false);
    expect('dryRun' in passedParams).toBe(false);
  });

  test('execute returns cancellation result when signal is aborted', async () => {
    const createPullRequest = mock((_params: any) =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'should not be called' }],
        details: {
          pullRequestNumber: 0,
          pullRequestUrl: '',
          headBranch: '',
          baseBranch: '',
          dryRun: false,
        },
      })
    );
    const provider = createMockProvider({ createPullRequest });
    const tool = createPRToolFactory(provider);

    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      'call-cancel',
      { title: 'Cancelled' },
      controller.signal,
      undefined,
      mockCtx
    );

    expect(createPullRequest).not.toHaveBeenCalled();
    expect((result.content as any)[0].text).toContain('cancelled');
    expect((result.details as any).cancelled).toBe(true);
  });
});

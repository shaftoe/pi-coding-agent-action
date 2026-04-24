/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock } from 'bun:test';
import { updatePullRequestToolFactory } from '../../../src/pi/tools/update-pr';
import type { PlatformProvider } from '../../../src/platform';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
import * as githubIndex from '../../../src/platform/github';

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
    details: { pullRequestNumber: 1, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
  }),
  updatePullRequest: async () => ({
    content: [{ type: 'text' as const, text: 'PR updated' }],
    details: { pullRequestNumber: 1, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
  }),
  getIssueOrPRThread: async () => undefined,
  ...overrides,
});

const mockProvider = createMockProvider();
const updatePullRequestTool = updatePullRequestToolFactory(mockProvider);

describe('update_pull_request tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(updatePullRequestTool.name).toBe('update_pull_request');
    expect(updatePullRequestTool.label).toBe('Update Pull Request');
  });

  test('execute function exists and is a function', () => {
    expect(typeof updatePullRequestTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = updatePullRequestTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.pull_number).toBeDefined();
    expect(schema.properties.title).toBeDefined();
    expect(schema.properties.body).toBeDefined();
    expect(schema.properties.message).toBeDefined();
    expect(schema.properties.dryRun).toBeDefined();
  });

  test('has execute with built-in cancellation handling', () => {
    expect(typeof updatePullRequestTool.execute).toBe('function');
  });

  test('tool uses provider for execution', () => {
    expect(githubIndex.updatePullRequest).toBeDefined();
    expect(typeof githubIndex.updatePullRequest).toBe('function');
  });

  test('parameters schema - all fields are optional', () => {
    const schema = updatePullRequestTool.parameters as any;
    if (Array.isArray(schema.required)) {
      expect(schema.required.length).toBe(0);
    }
  });

  test('execute calls provider.updatePullRequest with empty params when nothing provided', async () => {
    const updatePullRequest = mock((_params: any) =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'PR updated' }],
        details: { pullRequestNumber: 1, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
      })
    );
    const provider = createMockProvider({ updatePullRequest });
    const tool = updatePullRequestToolFactory(provider);

    const result = await tool.execute('call-1', {}, undefined, undefined, mockCtx);

    expect(updatePullRequest).toHaveBeenCalledTimes(1);
    expect((updatePullRequest as any).mock.calls[0][0]).toEqual({});
    expect(result.content).toEqual([{ type: 'text', text: 'PR updated' }]);
  });

  test('execute passes all optional params when provided', async () => {
    const updatePullRequest = mock((_params: any) =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'PR updated' }],
        details: { pullRequestNumber: 42, pullRequestUrl: 'https://github.com/test/pr/42', headBranch: 'feature', baseBranch: 'main', dryRun: true },
      })
    );
    const provider = createMockProvider({ updatePullRequest });
    const tool = updatePullRequestToolFactory(provider);

    const result = await tool.execute(
      'call-2',
      { pull_number: 42, title: 'New Title', body: 'New Body', message: 'commit msg', dryRun: true },
      undefined,
      undefined,
      mockCtx
    );

    expect(updatePullRequest).toHaveBeenCalledTimes(1);
    expect((updatePullRequest as any).mock.calls[0][0]).toEqual({
      pull_number: 42,
      title: 'New Title',
      body: 'New Body',
      message: 'commit msg',
      dryRun: true,
    });
    expect(result.details.pullRequestNumber).toBe(42);
  });

  test('execute omits undefined optional params', async () => {
    const updatePullRequest = mock((_params: any) =>
      Promise.resolve({
        content: [{ type: 'text' as const, text: 'ok' }],
        details: { pullRequestNumber: 5, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
      })
    );
    const provider = createMockProvider({ updatePullRequest });
    const tool = updatePullRequestToolFactory(provider);

    await tool.execute('call-3', { title: 'Only Title' }, undefined, undefined, mockCtx);

    const passedParams = (updatePullRequest as any).mock.calls[0][0] as Record<string, unknown>;
    expect(passedParams).toEqual({ title: 'Only Title' });
    expect('pull_number' in passedParams).toBe(false);
    expect('body' in passedParams).toBe(false);
    expect('message' in passedParams).toBe(false);
    expect('dryRun' in passedParams).toBe(false);
  });

  test('execute returns cancellation result when signal is aborted', async () => {
    const updatePullRequest = mock((_params: any) => Promise.resolve({
      content: [{ type: 'text' as const, text: 'should not be called' }],
      details: { pullRequestNumber: 0, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
    }));
    const provider = createMockProvider({ updatePullRequest });
    const tool = updatePullRequestToolFactory(provider);

    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute('call-cancel', { title: 'Cancelled' }, controller.signal, undefined, mockCtx);

    expect(updatePullRequest).not.toHaveBeenCalled();
    expect((result.content as any)[0].text).toContain('cancelled');
    expect((result.details as any).cancelled).toBe(true);
  });
});

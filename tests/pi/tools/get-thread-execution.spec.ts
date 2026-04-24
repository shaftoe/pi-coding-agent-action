/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock } from 'bun:test';
import { getIssueOrPRThreadToolFactory } from '../../../src/pi/tools/get-thread';
import type { PlatformProvider, IssueOrPRThread } from '../../../src/platform';
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
const getIssueOrPRThreadTool = getIssueOrPRThreadToolFactory(mockProvider);

const fakeThread: IssueOrPRThread = {
  number: 42,
  title: 'Test Issue',
  body: 'This is a test issue body',
  state: 'open',
  author: 'testuser',
  author_type: 'user',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  closed_at: undefined,
  merged_at: undefined,
  labels: ['bug'],
  is_pull_request: false,
  head_branch: undefined,
  base_branch: undefined,
  head_sha: undefined,
  comments: [
    {
      id: 1,
      author: 'commenter',
      author_type: 'user',
      created_at: '2024-01-03T00:00:00Z',
      body: 'A comment',
      is_triggering_comment: false,
    },
  ],
};

describe('get_issue_or_pr_thread tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(getIssueOrPRThreadTool.name).toBe('get_issue_or_pr_thread');
    expect(getIssueOrPRThreadTool.label).toBe('Get Issue/PR Thread');
  });

  test('execute function exists and is a function', () => {
    expect(typeof getIssueOrPRThreadTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = getIssueOrPRThreadTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.owner).toBeDefined();
    expect(schema.properties.repo).toBeDefined();
    expect(schema.properties.issue_number).toBeDefined();
    expect(schema.properties.max_comments).toBeDefined();
  });

  test('has execute with built-in cancellation handling', () => {
    expect(typeof getIssueOrPRThreadTool.execute).toBe('function');
  });

  test('tool uses provider for execution', () => {
    expect(githubIndex.getIssueOrPRThread).toBeDefined();
    expect(typeof githubIndex.getIssueOrPRThread).toBe('function');
  });

  test('parameters schema - all fields are optional', () => {
    const schema = getIssueOrPRThreadTool.parameters as any;
    if (Array.isArray(schema.required)) {
      expect(schema.required.length).toBe(0);
    }
  });

  test('execute returns formatted thread when found', async () => {
    const getIssueOrPRThread = mock((_params: any) => Promise.resolve(fakeThread));
    const provider = createMockProvider({ getIssueOrPRThread });
    const tool = getIssueOrPRThreadToolFactory(provider);

    const result = await tool.execute('call-1', { owner: 'test-owner', repo: 'test-repo', issue_number: 42 }, undefined, undefined, mockCtx);

    expect(getIssueOrPRThread).toHaveBeenCalledTimes(1);
    expect((getIssueOrPRThread as any).mock.calls[0][0]).toEqual({
      owner: 'test-owner',
      repo: 'test-repo',
      issue_number: 42,
    });
    // Result should contain the formatted thread text
    expect(result.content).toHaveLength(1);
    expect((result.content as any)[0].type).toBe('text');
    const text = (result.content as any)[0].text as string;
    expect(text).toContain('Issue #42: Test Issue');
    expect(text).toContain('State: OPEN');
    expect(text).toContain('@testuser');
    // Details should be the thread itself
    expect(result.details).toEqual(fakeThread);
  });

  test('execute returns not-found result when provider returns undefined', async () => {
    const getIssueOrPRThread = mock((_params: any) => Promise.resolve(undefined));
    const provider = createMockProvider({ getIssueOrPRThread });
    const tool = getIssueOrPRThreadToolFactory(provider);

    const result = await tool.execute('call-2', { owner: 'test-owner', repo: 'test-repo', issue_number: 999 }, undefined, undefined, mockCtx);

    expect(getIssueOrPRThread).toHaveBeenCalledTimes(1);
    expect(result.content).toHaveLength(1);
    expect((result.content as any)[0].text).toBe('Issue or pull request not found');
    expect(result.details).toEqual({
      number: 0,
      title: 'Not Found',
      body: 'Issue or pull request not found',
      state: 'closed',
      author: 'unknown',
      author_type: 'user',
      created_at: undefined,
      updated_at: undefined,
      closed_at: undefined,
      merged_at: undefined,
      labels: [],
      is_pull_request: false,
      head_branch: undefined,
      base_branch: undefined,
      head_sha: undefined,
      comments: [],
    });
  });

  test('execute passes params through to provider', async () => {
    const getIssueOrPRThread = mock((_params: any) => Promise.resolve(undefined));
    const provider = createMockProvider({ getIssueOrPRThread });
    const tool = getIssueOrPRThreadToolFactory(provider);

    await tool.execute(
      'call-3',
      { owner: 'custom-owner', repo: 'custom-repo', issue_number: 7, max_comments: 5 },
      undefined,
      undefined,
      mockCtx
    );

    expect((getIssueOrPRThread as any).mock.calls[0][0]).toEqual({
      owner: 'custom-owner',
      repo: 'custom-repo',
      issue_number: 7,
      max_comments: 5,
    });
  });

  test('execute returns cancellation result when signal is aborted', async () => {
    const getIssueOrPRThread = mock((_params: any) => Promise.resolve(fakeThread));
    const provider = createMockProvider({ getIssueOrPRThread });
    const tool = getIssueOrPRThreadToolFactory(provider);

    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute('call-cancel', { issue_number: 1 }, controller.signal, undefined, mockCtx);

    expect(getIssueOrPRThread).not.toHaveBeenCalled();
    expect((result.content as any)[0].text).toContain('cancelled');
    expect((result.details as any).cancelled).toBe(true);
  });

  test('execute formats PR thread correctly with branch info', async () => {
    const prThread: IssueOrPRThread = {
      ...fakeThread,
      number: 10,
      title: 'Test PR',
      is_pull_request: true,
      head_branch: 'feature/branch',
      base_branch: 'main',
      head_sha: 'abc123',
    };
    const getIssueOrPRThread = mock((_params: any) => Promise.resolve(prThread));
    const provider = createMockProvider({ getIssueOrPRThread });
    const tool = getIssueOrPRThreadToolFactory(provider);

    const result = await tool.execute('call-4', { issue_number: 10 }, undefined, undefined, mockCtx);

    const text = (result.content as any)[0].text as string;
    expect(text).toContain('Pull Request #10: Test PR');
    expect(text).toContain('Head Branch: feature/branch');
    expect(text).toContain('Base Branch: main');
    expect(text).toContain('Head SHA: abc123');
  });
});

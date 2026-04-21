import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
// so they don't appear as CI annotations in test output.
const realStdoutWrite = process.stdout.write.bind(process.stdout);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stdout.write accepts variable args
const _mockedWrite = mock((...args: any[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true; // swallow annotations
  }
  // @ts-expect-error -- spread parameter type limitation
  return realStdoutWrite(...args);
});
// stdout.write is readonly, we override for tests
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Set env vars BEFORE importing tools (which transitively imports github.ts,
// which runs module-level code calling getOctokit at load time).
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

// We still mock @actions/core to suppress log output in tests
const noop = (): void => {};
mock.module('@actions/core', () => ({
  getInput: mock(() => '/pi'),
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  warning: mock(noop),
}));

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { PlatformProvider } from '../../src/platform';

// Dynamic import to ensure env vars and mocks are set before module loads
const toolsModule = import('../../src/pi/tools/index.js');
const { createToolsFactory } =
  // @ts-expect-error TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
  await toolsModule;

// Minimal type for tool in tests - we only test specific properties
interface TestTool {
  name: string;
  description: string;
  label: string;
  promptGuidelines: string[];
  promptSnippet: string;
  parameters: {
    properties: Record<string, { type: string }>;
    required?: string[];
  };
  execute: (
    _toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: unknown
  ) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
}

// Mock platform provider for tools
const mockProvider: PlatformProvider = {
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
};

function captureRegisteredTools() {
  const tools: unknown[] = [];
  const api = {
    registerTool: mock((tool: unknown) => {
      tools.push(tool);
    }),
  } as unknown as ExtensionAPI;

  const extFactory = createToolsFactory(mockProvider);
  extFactory(api);
  return tools as TestTool[];
}

function getToolByName(tools: TestTool[], name: string): TestTool | undefined {
  return tools.find(t => t.name === name);
}

describe('extFactory', () => {
  let tools: TestTool[];
  let createPRTool: TestTool;
  let updatePRTool: TestTool;
  let getIssuePRThreadTool: TestTool;

  beforeEach(() => {
    tools = captureRegisteredTools();
    createPRTool = getToolByName(tools, 'create_pull_request')!;
    updatePRTool = getToolByName(tools, 'update_pull_request')!;
    getIssuePRThreadTool = getToolByName(tools, 'get_issue_or_pr_thread')!;
  });

  test('registers three tools', () => {
    expect(tools.length).toBe(3);
  });

  test('registers a tool named create_pull_request', () => {
    expect(createPRTool).toBeDefined();
    expect(createPRTool.name).toBe('create_pull_request');
  });

  test('registers a tool named get_issue_or_pr_thread', () => {
    expect(getIssuePRThreadTool).toBeDefined();
    expect(getIssuePRThreadTool.name).toBe('get_issue_or_pr_thread');
  });

  test('registers a tool named update_pull_request', () => {
    expect(updatePRTool).toBeDefined();
    expect(updatePRTool.name).toBe('update_pull_request');
  });

  test('create_pull_request has a non-empty description', () => {
    expect(typeof createPRTool.description).toBe('string');
    expect(createPRTool.description.length).toBeGreaterThan(0);
  });

  test('get_issue_or_pr_thread has a non-empty description', () => {
    expect(typeof getIssuePRThreadTool.description).toBe('string');
    expect(getIssuePRThreadTool.description.length).toBeGreaterThan(0);
  });

  test('create_pull_request has a label', () => {
    expect(createPRTool.label).toBe('Create Pull Request');
  });

  test('get_issue_or_pr_thread has a label', () => {
    expect(getIssuePRThreadTool.label).toBe('Get Issue/PR Thread');
  });

  test('update_pull_request has a label', () => {
    expect(updatePRTool.label).toBe('Update Pull Request');
  });

  test('create_pull_request has prompt guidelines', () => {
    expect(Array.isArray(createPRTool.promptGuidelines)).toBe(true);
    expect(createPRTool.promptGuidelines.length).toBeGreaterThan(0);
  });

  test('get_issue_or_pr_thread has prompt guidelines', () => {
    expect(Array.isArray(getIssuePRThreadTool.promptGuidelines)).toBe(true);
    expect(getIssuePRThreadTool.promptGuidelines.length).toBeGreaterThan(0);
  });

  test('update_pull_request has prompt guidelines', () => {
    expect(Array.isArray(updatePRTool.promptGuidelines)).toBe(true);
    expect(updatePRTool.promptGuidelines.length).toBeGreaterThan(0);
  });

  test('create_pull_request has a prompt snippet', () => {
    expect(typeof createPRTool.promptSnippet).toBe('string');
    expect(createPRTool.promptSnippet.length).toBeGreaterThan(0);
  });

  test('get_issue_or_pr_thread has a prompt snippet', () => {
    expect(typeof getIssuePRThreadTool.promptSnippet).toBe('string');
    expect(getIssuePRThreadTool.promptSnippet.length).toBeGreaterThan(0);
  });

  test('update_pull_request has a prompt snippet', () => {
    expect(typeof updatePRTool.promptSnippet).toBe('string');
    expect(updatePRTool.promptSnippet.length).toBeGreaterThan(0);
  });

  test('update_pull_request has a non-empty description', () => {
    expect(typeof updatePRTool.description).toBe('string');
    expect(updatePRTool.description.length).toBeGreaterThan(0);
  });

  test('create_pull_request parameters require title as string', () => {
    const params = createPRTool.parameters;
    expect(params.properties.title).toBeDefined();
    expect(params.properties.title?.type).toBe('string');
  });

  test('create_pull_request parameters body is optional', () => {
    const params = createPRTool.parameters;
    expect(params.properties.body).toBeDefined();
    expect(params.required).not.toContain('body');
  });

  test('create_pull_request parameters base is optional', () => {
    const params = createPRTool.parameters;
    expect(params.properties.base).toBeDefined();
    expect(params.required).not.toContain('base');
  });

  test('create_pull_request parameters dryRun is optional', () => {
    const params = createPRTool.parameters;
    expect(params.properties.dryRun).toBeDefined();
    expect(params.required).not.toContain('dryRun');
  });

  test('create_pull_request title is required', () => {
    const params = createPRTool.parameters;
    expect(params.required).toContain('title');
  });

  test('update_pull_request parameters pull_number is optional', () => {
    const params = updatePRTool.parameters;
    expect(params.properties.pull_number).toBeDefined();
    // When all fields are optional, required may be undefined
    if (Array.isArray(params.required)) {
      expect(params.required).not.toInclude('pull_number');
    }
  });

  test('update_pull_request parameters title is optional', () => {
    const params = updatePRTool.parameters;
    expect(params.properties.title).toBeDefined();
    // When all fields are optional, required may be undefined
    if (Array.isArray(params.required)) {
      expect(params.required).not.toInclude('title');
    }
  });

  test('update_pull_request parameters body is optional', () => {
    const params = updatePRTool.parameters;
    expect(params.properties.body).toBeDefined();
    // When all fields are optional, required may be undefined
    if (Array.isArray(params.required)) {
      expect(params.required).not.toInclude('body');
    }
  });

  test('update_pull_request parameters dryRun is optional', () => {
    const params = updatePRTool.parameters;
    expect(params.properties.dryRun).toBeDefined();
    // When all fields are optional, required may be undefined
    if (Array.isArray(params.required)) {
      expect(params.required).not.toInclude('dryRun');
    }
  });

  test('get_issue_or_pr_thread parameters owner is optional', () => {
    const params = getIssuePRThreadTool.parameters;
    expect(params.properties.owner).toBeDefined();
    // When all fields are optional, required may be undefined
    if (Array.isArray(params.required)) {
      expect(params.required).not.toInclude('owner');
    }
  });

  test('get_issue_or_pr_thread parameters repo is optional', () => {
    const params = getIssuePRThreadTool.parameters;
    expect(params.properties.repo).toBeDefined();
    // When all fields are optional, required may be undefined
    if (Array.isArray(params.required)) {
      expect(params.required).not.toInclude('repo');
    }
  });

  test('get_issue_or_pr_thread parameters issue_number is optional', () => {
    const params = getIssuePRThreadTool.parameters;
    expect(params.properties.issue_number).toBeDefined();
    // When all fields are optional, required may be undefined
    if (Array.isArray(params.required)) {
      expect(params.required).not.toInclude('issue_number');
    }
  });

  test('get_issue_or_pr_thread parameters max_comments is optional', () => {
    const params = getIssuePRThreadTool.parameters;
    expect(params.properties.max_comments).toBeDefined();
    // When all fields are optional, required may be undefined
    if (Array.isArray(params.required)) {
      expect(params.required).not.toInclude('max_comments');
    }
  });

  describe('create_pull_request execute', () => {
    test('returns cancellation message when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await createPRTool.execute(
        'id',
        { title: 'Nope' },
        controller.signal,
        undefined,
        undefined as unknown as Parameters<typeof createPRTool.execute>[4]
      );

      expect(result.content[0]?.text).toContain('cancelled');
      expect(result.details.cancelled).toBe(true);
      expect(result.details.pullRequestNumber).toBe(0);
      expect(result.details.pullRequestUrl).toBe('');
    });
  });

  describe('get_issue_or_pr_thread execute', () => {
    test('returns cancellation message when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await getIssuePRThreadTool.execute(
        'id',
        {},
        controller.signal,
        undefined,
        undefined as unknown as Parameters<typeof getIssuePRThreadTool.execute>[4]
      );

      expect(result.content[0]?.text).toContain('cancelled');
      expect(result.details.cancelled).toBe(true);
      expect(result.details.number).toBe(0);
    });
  });

  describe('update_pull_request execute', () => {
    test('returns cancellation message when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await updatePRTool.execute(
        'id',
        {},
        controller.signal,
        undefined,
        undefined as unknown as Parameters<typeof updatePRTool.execute>[4]
      );

      expect(result.content[0]?.text).toContain('cancelled');
      expect(result.details.cancelled).toBe(true);
      expect(result.details.pullRequestNumber).toBe(0);
      expect(result.details.pullRequestUrl).toBe('');
    });
  });
});

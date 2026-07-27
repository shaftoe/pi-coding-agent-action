import { describe, expect, test, vi, beforeEach } from 'vitest';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
// so they don't appear as CI annotations in test output.
const realStdoutWrite = process.stdout.write.bind(process.stdout);

const _mockedWrite = vi.fn((...args: any[]) => {
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
import { installGithubEnv } from '../helpers/github-env';
installGithubEnv();

// Mock @actions/core via shared helper
import { coreMock, registerCoreMock } from '../helpers/core-mock';
registerCoreMock();
coreMock.getInput.mockImplementation(() => '/pi ');

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createMockProvider } from '../helpers/tool-mocks';

// Dynamic import to ensure env vars and mocks are set before module loads
const toolsModule = import('@alexanderfortin/pi-orchestrator');
const { createToolsFactory } = await toolsModule;

// Minimal type for tool in tests - we only test specific properties
interface TestTool {
  name: string;
  description: string;
  label: string;
  promptGuidelines: string[];
  promptSnippet: string;
  parameters: {
    properties: Record<string, { type?: string; anyOf?: { type?: string }[] }>;
    required?: string[];
    additionalProperties?: boolean;
  };
  constrainedSampling?: { type: string; strict: string };
  execute: (
    _toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    _onUpdate: unknown,
    _ctx: unknown
  ) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
}

// Mock platform provider for tools
const mockProvider = createMockProvider();

function captureRegisteredTools() {
  const tools: unknown[] = [];
  const api = {
    registerTool: vi.fn((tool: unknown) => {
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

/**
 * Assert a tool field is required-but-nullable — the strict-compatible form
 * for what used to be an optional property. Strict JSON-schema sampling
 * (OpenAI/Anthropic) forbids optionals, so absent values are modelled as a
 * required union with null (`anyOf: [<type>, { type: 'null' }]`).
 */
function expectRequiredNullable(tool: TestTool, field: string): void {
  const prop = tool.parameters.properties[field];
  expect(prop).toBeDefined();
  expect(tool.parameters.required).toContain(field);
  expect(prop?.anyOf?.some(member => member.type === 'null')).toBe(true);
}

/**
 * Assert a tool's schema is strict-compatible and opts into strict sampling:
 * `additionalProperties: false`, every property listed in `required`, and the
 * `constrainedSampling` config set to `prefer`.
 */
function expectStrictTool(tool: TestTool): void {
  expect(tool.parameters.additionalProperties).toBe(false);
  const keys = Object.keys(tool.parameters.properties);
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) {
    expect(tool.parameters.required).toContain(key);
  }
  expect(tool.constrainedSampling).toEqual({ type: 'json_schema', strict: 'prefer' });
}

describe('extFactory', () => {
  let tools: TestTool[];
  let createPRTool: TestTool;
  let updatePRTool: TestTool;
  let getIssuePRThreadTool: TestTool;
  let getPRDiffTool: TestTool;
  let createReviewTool: TestTool;
  let getCIStatusTool: TestTool;
  let getWorkflowRunLogsTool: TestTool;

  beforeEach(() => {
    tools = captureRegisteredTools();
    createPRTool = getToolByName(tools, 'create_pull_request')!;
    updatePRTool = getToolByName(tools, 'update_pull_request')!;
    getIssuePRThreadTool = getToolByName(tools, 'get_issue_or_pr_thread')!;
    getPRDiffTool = getToolByName(tools, 'get_pr_diff')!;
    createReviewTool = getToolByName(tools, 'create_pull_request_review')!;
    getCIStatusTool = getToolByName(tools, 'get_ci_status')!;
    getWorkflowRunLogsTool = getToolByName(tools, 'get_workflow_run_logs')!;
  });

  test('registers seven tools', () => {
    expect(tools.length).toBe(7);
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

  test('create_pull_request parameters body is required-but-nullable', () => {
    expectRequiredNullable(createPRTool, 'body');
  });

  test('create_pull_request parameters base is required-but-nullable', () => {
    expectRequiredNullable(createPRTool, 'base');
  });

  test('create_pull_request parameters dryRun is required-but-nullable', () => {
    expectRequiredNullable(createPRTool, 'dryRun');
  });

  test('create_pull_request schema is strict-compatible (additionalProperties:false, strict sampling)', () => {
    expectStrictTool(createPRTool);
  });

  test('create_pull_request title is required', () => {
    const params = createPRTool.parameters;
    expect(params.required).toContain('title');
  });

  test('update_pull_request parameters pull_number is required-but-nullable', () => {
    expectRequiredNullable(updatePRTool, 'pull_number');
  });

  test('update_pull_request parameters title is required-but-nullable', () => {
    expectRequiredNullable(updatePRTool, 'title');
  });

  test('update_pull_request parameters body is required-but-nullable', () => {
    expectRequiredNullable(updatePRTool, 'body');
  });

  test('update_pull_request parameters dryRun is required-but-nullable', () => {
    expectRequiredNullable(updatePRTool, 'dryRun');
  });

  test('update_pull_request schema is strict-compatible (additionalProperties:false, strict sampling)', () => {
    expectStrictTool(updatePRTool);
  });

  test('get_issue_or_pr_thread parameters owner is required-but-nullable', () => {
    expectRequiredNullable(getIssuePRThreadTool, 'owner');
  });

  test('get_issue_or_pr_thread parameters repo is required-but-nullable', () => {
    expectRequiredNullable(getIssuePRThreadTool, 'repo');
  });

  test('get_issue_or_pr_thread parameters issue_number is required-but-nullable', () => {
    expectRequiredNullable(getIssuePRThreadTool, 'issue_number');
  });

  test('get_issue_or_pr_thread parameters max_comments is required-but-nullable', () => {
    expectRequiredNullable(getIssuePRThreadTool, 'max_comments');
  });

  test('get_issue_or_pr_thread schema is strict-compatible (additionalProperties:false, strict sampling)', () => {
    expectStrictTool(getIssuePRThreadTool);
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

  describe('get_pr_diff', () => {
    test('registers a tool named get_pr_diff', () => {
      expect(getPRDiffTool).toBeDefined();
      expect(getPRDiffTool.name).toBe('get_pr_diff');
    });

    test('has a label', () => {
      expect(getPRDiffTool.label).toBe('Get PR Diff');
    });

    test('has a non-empty description', () => {
      expect(typeof getPRDiffTool.description).toBe('string');
      expect(getPRDiffTool.description.length).toBeGreaterThan(0);
    });

    test('has prompt guidelines', () => {
      expect(Array.isArray(getPRDiffTool.promptGuidelines)).toBe(true);
      expect(getPRDiffTool.promptGuidelines.length).toBeGreaterThan(0);
    });

    test('has a prompt snippet', () => {
      expect(typeof getPRDiffTool.promptSnippet).toBe('string');
      expect(getPRDiffTool.promptSnippet.length).toBeGreaterThan(0);
    });

    test('parameters - all fields are present and the schema is strict-compatible', () => {
      const params = getPRDiffTool.parameters;
      expect(params.properties.owner).toBeDefined();
      expect(params.properties.repo).toBeDefined();
      expect(params.properties.pull_number).toBeDefined();
      expect(params.properties.max_lines).toBeDefined();
      expect(params.properties.ignore_files).toBeDefined();
      // All fields are required-but-nullable under strict sampling.
      expectStrictTool(getPRDiffTool);
    });

    test('returns cancellation message when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await getPRDiffTool.execute(
        'id',
        {},
        controller.signal,
        undefined,
        undefined as unknown as Parameters<typeof getPRDiffTool.execute>[4]
      );

      expect(result.content[0]?.text).toContain('cancelled');
      expect(result.details.cancelled).toBe(true);
      expect(result.details.pull_number).toBe(0);
    });
  });

  describe('create_pull_request_review', () => {
    test('registers a tool named create_pull_request_review', () => {
      expect(createReviewTool).toBeDefined();
      expect(createReviewTool.name).toBe('create_pull_request_review');
    });

    test('has a label', () => {
      expect(createReviewTool.label).toBe('Create Pull Request Review');
    });

    test('has a non-empty description', () => {
      expect(typeof createReviewTool.description).toBe('string');
      expect(createReviewTool.description.length).toBeGreaterThan(0);
    });

    test('has prompt guidelines', () => {
      expect(Array.isArray(createReviewTool.promptGuidelines)).toBe(true);
      expect(createReviewTool.promptGuidelines.length).toBeGreaterThan(0);
    });

    test('has a prompt snippet', () => {
      expect(typeof createReviewTool.promptSnippet).toBe('string');
      expect(createReviewTool.promptSnippet.length).toBeGreaterThan(0);
    });

    test('parameters - comments is required', () => {
      const params = createReviewTool.parameters;
      expect(params.properties.comments).toBeDefined();
      expect(params.required).toContain('comments');
    });

    test('parameters - pull_number is required-but-nullable', () => {
      expectRequiredNullable(createReviewTool, 'pull_number');
    });

    test('parameters - body is required-but-nullable', () => {
      expectRequiredNullable(createReviewTool, 'body');
    });

    test('parameters - event is required-but-nullable', () => {
      expectRequiredNullable(createReviewTool, 'event');
    });

    test('schema is strict-compatible (additionalProperties:false, strict sampling, nullable comment fields)', () => {
      expectStrictTool(createReviewTool);
      // Nested review-comment schema is strict-compatible too: side / start_line /
      // start_side are nullable, and additionalProperties is false.
      const commentSchema = (
        createReviewTool.parameters.properties.comments as unknown as {
          items?: { additionalProperties?: boolean; required?: string[] };
        }
      ).items;
      expect(commentSchema?.additionalProperties).toBe(false);
      expect(commentSchema?.required).toEqual(
        expect.arrayContaining(['path', 'line', 'side', 'start_line', 'start_side', 'body'])
      );
    });

    test('returns cancellation message when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await createReviewTool.execute(
        'id',
        { comments: [{ path: 'test.ts', line: 1, body: 'test' }] },
        controller.signal,
        undefined,
        undefined as unknown as Parameters<typeof createReviewTool.execute>[4]
      );

      expect(result.content[0]?.text).toContain('cancelled');
      expect(result.details.cancelled).toBe(true);
      expect(result.details.reviewId).toBe(0);
    });
  });

  describe('get_ci_status', () => {
    test('registers a tool named get_ci_status', () => {
      expect(getCIStatusTool).toBeDefined();
      expect(getCIStatusTool.name).toBe('get_ci_status');
    });

    test('has a label', () => {
      expect(getCIStatusTool.label).toBe('Get CI Status');
    });

    test('has a non-empty description', () => {
      expect(typeof getCIStatusTool.description).toBe('string');
      expect(getCIStatusTool.description.length).toBeGreaterThan(0);
    });

    test('has prompt guidelines', () => {
      expect(Array.isArray(getCIStatusTool.promptGuidelines)).toBe(true);
      expect(getCIStatusTool.promptGuidelines.length).toBeGreaterThan(0);
    });

    test('has a prompt snippet', () => {
      expect(typeof getCIStatusTool.promptSnippet).toBe('string');
      expect(getCIStatusTool.promptSnippet.length).toBeGreaterThan(0);
    });

    test('parameters - all fields are present and the schema is strict-compatible', () => {
      const params = getCIStatusTool.parameters;
      expect(params.properties.owner).toBeDefined();
      expect(params.properties.repo).toBeDefined();
      expect(params.properties.pull_number).toBeDefined();
      expect(params.properties.ref).toBeDefined();
      expect(params.properties.status).toBeDefined();
      expect(params.properties.conclusion).toBeDefined();
      expectStrictTool(getCIStatusTool);
    });

    test('returns cancellation message when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await getCIStatusTool.execute(
        'id',
        {},
        controller.signal,
        undefined,
        undefined as unknown as Parameters<typeof getCIStatusTool.execute>[4]
      );

      expect(result.content[0]?.text).toContain('cancelled');
      expect(result.details.cancelled).toBe(true);
      expect(result.details.ref).toBe('');
    });
  });

  describe('get_workflow_run_logs', () => {
    test('registers a tool named get_workflow_run_logs', () => {
      expect(getWorkflowRunLogsTool).toBeDefined();
      expect(getWorkflowRunLogsTool.name).toBe('get_workflow_run_logs');
    });

    test('has a label', () => {
      expect(getWorkflowRunLogsTool.label).toBe('Get Workflow Run Logs');
    });

    test('has a non-empty description', () => {
      expect(typeof getWorkflowRunLogsTool.description).toBe('string');
      expect(getWorkflowRunLogsTool.description.length).toBeGreaterThan(0);
    });

    test('has prompt guidelines', () => {
      expect(Array.isArray(getWorkflowRunLogsTool.promptGuidelines)).toBe(true);
      expect(getWorkflowRunLogsTool.promptGuidelines.length).toBeGreaterThan(0);
    });

    test('has a prompt snippet', () => {
      expect(typeof getWorkflowRunLogsTool.promptSnippet).toBe('string');
      expect(getWorkflowRunLogsTool.promptSnippet.length).toBeGreaterThan(0);
    });

    test('parameters - run_id is required', () => {
      const params = getWorkflowRunLogsTool.parameters;
      expect(params.properties.run_id).toBeDefined();
      expect(params.required).toContain('run_id');
    });

    test('parameters - owner, repo, max_bytes are required-but-nullable', () => {
      expectRequiredNullable(getWorkflowRunLogsTool, 'owner');
      expectRequiredNullable(getWorkflowRunLogsTool, 'repo');
      expectRequiredNullable(getWorkflowRunLogsTool, 'max_bytes');
    });

    test('schema is strict-compatible (additionalProperties:false, strict sampling)', () => {
      expectStrictTool(getWorkflowRunLogsTool);
    });

    test('returns cancellation message when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await getWorkflowRunLogsTool.execute(
        'id',
        { run_id: 123 },
        controller.signal,
        undefined,
        undefined as unknown as Parameters<typeof getWorkflowRunLogsTool.execute>[4]
      );

      expect(result.content[0]?.text).toContain('cancelled');
      expect(result.details.cancelled).toBe(true);
      expect(result.details.run_id).toBe(0);
    });
  });
});

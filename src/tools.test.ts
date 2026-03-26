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
process.stdout.write = _mockedWrite as unknown;

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

const { extFactory } = await import('./tools');
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

// Minimal type for tool in tests - we only test specific properties
interface TestTool {
  name: string;
  description: string;
  label: string;
  promptGuidelines: string[];
  promptSnippet: string;
  parameters: {
    properties: {
      title: { type: string };
      body?: { type: string };
      base?: { type: string };
      dryRun?: { type: string };
    };
    required: string[];
  };
  execute: (
    id: string,
    params: { title: string; body?: string; base?: string; dryRun?: boolean },
    signal: AbortSignal,
    context: unknown,
    sendResponse: (chunk: string) => void
  ) => Promise<{ content: { text: string }[] }>;
}

function captureRegisteredTool() {
  let registered: unknown;
  const api = {
    registerTool: mock((tool: unknown) => {
      registered = tool;
    }),
  } as unknown as ExtensionAPI;

  extFactory(api);
  return registered as TestTool;
}

describe('extFactory', () => {
  let tool: TestTool;

  beforeEach(() => {
    tool = captureRegisteredTool();
  });

  test('registers a tool named create_pull_request', () => {
    expect(tool.name).toBe('create_pull_request');
  });

  test('has a non-empty description', () => {
    expect(typeof tool.description).toBe('string');
    expect(tool.description.length).toBeGreaterThan(0);
  });

  test('has a label', () => {
    expect(tool.label).toBe('Create Pull Request');
  });

  test('has prompt guidelines', () => {
    expect(Array.isArray(tool.promptGuidelines)).toBe(true);
    expect(tool.promptGuidelines.length).toBeGreaterThan(0);
  });

  test('has a prompt snippet', () => {
    expect(typeof tool.promptSnippet).toBe('string');
    expect(tool.promptSnippet.length).toBeGreaterThan(0);
  });

  test('parameters require title as string', () => {
    const params = tool.parameters;
    expect(params.properties.title).toBeDefined();
    expect(params.properties.title.type).toBe('string');
  });

  test('parameters body is optional', () => {
    const params = tool.parameters;
    expect(params.properties.body).toBeDefined();
    expect(params.required).not.toContain('body');
  });

  test('parameters base is optional', () => {
    const params = tool.parameters;
    expect(params.properties.base).toBeDefined();
    expect(params.required).not.toContain('base');
  });

  test('parameters dryRun is optional', () => {
    const params = tool.parameters;
    expect(params.properties.dryRun).toBeDefined();
    expect(params.required).not.toContain('dryRun');
  });

  test('title is required', () => {
    const params = tool.parameters;
    expect(params.required).toContain('title');
  });

  describe('execute', () => {
    test('returns cancellation message when signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute('id', { title: 'Nope' }, controller.signal, null, null);

      expect(result.content[0].text).toContain('cancelled');
    });
  });
});

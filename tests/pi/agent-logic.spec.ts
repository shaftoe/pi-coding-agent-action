/**
 * Tests for Agent class.
 *
 * Tests the Pi agent wrapper including session stats handling.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock } from 'bun:test';

// Mock @actions/core to provide required inputs before importing Agent
const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  if (name === 'trigger') {
    return '/pi';
  }
  if (name === 'max_comments') {
    return '100';
  }
  return '';
});

mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  setOutput: mock(noop),
  warning: mock(noop),
}));

// Set env vars before importing any modules that use them
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.INPUT_MAX_COMMENTS = '100';

// Dynamic import to ensure mocks are set up before module loads
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
const { Agent } = await import('../../src/pi/agent.js');

// Create a mock CoreAdapter for tests
const mockCoreAdapter = {
  getInput: mockGetInput,
  notice: mock(noop),
  debug: mock(noop),
  info: mock(noop),
  setFailed: mock(noop),
  setOutput: mock(noop),
  warning: mock(noop),
};

// Create a mock PlatformProvider for tests
const mockPlatformProvider: any = {
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
  createPullRequest: async () => ({ content: [], details: {} }),
  updatePullRequest: async () => ({ content: [], details: {} }),
  getIssueOrPRThread: async () => undefined,
};

/**
 * Create a standard agent instance for testing (calls real ready()).
 */
function createRealAgent(): InstanceType<typeof Agent> {
  return new Agent(mockCoreAdapter as any, mockPlatformProvider, {
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    token: 'test-token',
    thinkingLevel: 'off',
    promptInput: '',
  });
}

describe('Agent', () => {
  describe('constructor', () => {
    test('throws error for non-existent model', () => {
      // Use a provider/model combo that won't exist in the registry
      expect(() => {
        const _agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
          model: 'model-name',
          provider: 'fake-provider',
          token: 'test-token',
          thinkingLevel: 'off',
          promptInput: '',
        });
      }).toThrow('Model not found');
    });

    test('stores token in auth storage when provided', () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'sk-12345',
        thinkingLevel: 'off',
        promptInput: '',
      });
      // Agent is created without error
      expect(agent).toBeDefined();
    });

    test('does not set auth storage when token is empty', () => {
      const mockDebug: string[] = [];
      const debugLogger = (msg: string): void => {
        mockDebug.push(msg);
      };
      const adapter = { ...mockCoreAdapter, debug: mock(debugLogger) };

      new Agent(adapter as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: '',
        thinkingLevel: 'off',
        promptInput: '',
      });

      // Should not log auth debug message
      expect(mockDebug).not.toContain('[auth] Setting api_key token');
    });

    test('stores model, provider, and thinking level', () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'test-token',
        thinkingLevel: 'medium',
        promptInput: '',
      });
      // Agent is created without error
      expect(agent).toBeDefined();
      // Can't directly verify internal properties, but creation succeeds
    });
  });

  describe('ready', () => {
    test('initializes session and returns self', async () => {
      const agent = createRealAgent();
      const result = await agent.ready();
      expect(result).toBe(agent);
    });

    test('subscribes to message_update events', async () => {
      const agent = createRealAgent();

      // The real session subscribe will be called during ready()
      await agent.ready();
      // Can't directly verify subscribe was called, but ready() succeeds
      expect(agent).toBeDefined();
    });
  });

  describe('run', () => {
    test('throws error for empty text', async () => {
      const agent = createRealAgent();
      await agent.ready();

      expect(agent.run('')).rejects.toThrow('no text, skipping prompt');
    });

    test('throws error for undefined text', async () => {
      const agent = createRealAgent();
      await agent.ready();

      await expect(agent.run(undefined as unknown as string)).rejects.toThrow(
        'no text, skipping prompt'
      );
    });

    test('returns PromptResult with sessionStats', async () => {
      const agent = createRealAgent();
      await agent.ready();

      // Mock the session to return known stats
      const mockStats = {
        getSessionStats: () => ({
          tokens: { input: 100, output: 50, total: 150 },
          cost: 0.00123,
        }),
        prompt: async () => {},
        subscribe: () => {},
      };
      agent['session'] = mockStats as any;

      const result = await agent.run('Hello');
      expect(result).toEqual({
        result: '',
        sessionStats: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          cost: 0.00123,
          version: expect.any(String),
        },
      });
    });

    test('returns PromptResult with undefined sessionStats when SDK throws', async () => {
      const agent = createRealAgent();
      await agent.ready();

      // Mock the session to throw an error on getSessionStats
      const mockSession = {
        getSessionStats: () => {
          throw new Error('SDK internal error');
        },
        prompt: async () => {},
        subscribe: () => {},
      };
      agent['session'] = mockSession as any;

      const result = await agent.run('Hello');
      expect(result).toEqual({
        result: '',
        sessionStats: undefined,
      });
    });

    test('returns PromptResult with zero tokens and cost', async () => {
      const agent = createRealAgent();
      await agent.ready();

      // Mock the session to return zero values
      const mockStats = {
        getSessionStats: () => ({
          tokens: { input: 0, output: 0, total: 0 },
          cost: 0,
        }),
        prompt: async () => {},
        subscribe: () => {},
      };
      agent['session'] = mockStats as any;

      const result = await agent.run('Hello');
      expect(result).toEqual({
        result: '',
        sessionStats: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
          version: expect.any(String),
        },
      });
    });

    test('returns PromptResult with large token counts', async () => {
      const agent = createRealAgent();
      await agent.ready();

      // Mock the session to return large values
      const mockStats = {
        getSessionStats: () => ({
          tokens: { input: 100000, output: 50000, total: 150000 },
          cost: 1.2345,
        }),
        prompt: async () => {},
        subscribe: () => {},
      };
      agent['session'] = mockStats as any;

      const result = await agent.run('Hello');
      expect(result).toEqual({
        result: '',
        sessionStats: {
          inputTokens: 100000,
          outputTokens: 50000,
          totalTokens: 150000,
          cost: 1.2345,
          version: expect.any(String),
        },
      });
    });
  });

  describe('loadedTools validation', () => {
    test('throws error when loadedTools contains unknown tool names', async () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'test-token',
        thinkingLevel: 'off',
        promptInput: '',
        loadedTools: ['definitely_not_a_real_tool_xyz'],
      });

      await expect(agent.ready()).rejects.toThrow(
        /loaded_tools: unknown tool name\(s\): definitely_not_a_real_tool_xyz/
      );
    });

    test('error message lists available tools for discoverability', async () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'test-token',
        thinkingLevel: 'off',
        promptInput: '',
        loadedTools: ['bogus_tool'],
      });

      await expect(agent.ready()).rejects.toThrow(/Available tools:/);
    });

    test('succeeds when loadedTools has valid tool names', async () => {
      const infoMessages: string[] = [];
      const testCore = {
        ...mockCoreAdapter,
        info: mock((msg: string) => {
          infoMessages.push(msg);
        }),
      };

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'test-token',
        thinkingLevel: 'off',
        promptInput: '',
        // 'read' is a built-in Pi SDK tool that is always available
        loadedTools: ['read'],
      });

      // Should not throw — 'read' is a valid Pi SDK tool
      const result = await agent.ready();
      expect(result).toBe(agent);

      // No error should be logged (only kept/removed info if applicable)
      const errorLog = infoMessages.find(m => m.includes('❌'));
      expect(errorLog).toBeUndefined();
    });

    test('succeeds without validation when loadedTools is undefined', async () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'test-token',
        thinkingLevel: 'off',
        promptInput: '',
        // loadedTools is intentionally omitted
      });

      const result = await agent.ready();
      expect(result).toBe(agent);
    });
  });

  describe('exportSessionHtml', () => {
    test('delegates to session.exportToHtml', async () => {
      const agent = createRealAgent();
      await agent.ready();

      const mockExportToHtml = mock(async (outputPath: string) => outputPath);
      agent['session'] = {
        ...agent['session'],
        exportToHtml: mockExportToHtml,
      } as any;

      const result = await agent.exportSessionHtml('/tmp/test-session.html');
      expect(result).toBe('/tmp/test-session.html');
      expect(mockExportToHtml).toHaveBeenCalledWith('/tmp/test-session.html');
    });
  });

  describe('exportSessionJsonl', () => {
    test('delegates to session.exportToJsonl', async () => {
      const agent = createRealAgent();
      await agent.ready();

      const mockExportToJsonl = mock((outputPath: string) => outputPath);
      agent['session'] = {
        ...agent['session'],
        exportToJsonl: mockExportToJsonl,
      } as any;

      const result = await agent.exportSessionJsonl('/tmp/test-session.jsonl');
      expect(result).toBe('/tmp/test-session.jsonl');
      expect(mockExportToJsonl).toHaveBeenCalledWith('/tmp/test-session.jsonl');
    });
  });

  describe('autoCompaction', () => {
    test('enables auto-compaction on session when config.autoCompaction is true', async () => {
      const infoMessages: string[] = [];
      const testCore = {
        ...mockCoreAdapter,
        info: mock((msg: string) => {
          infoMessages.push(msg);
        }),
      };

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'test-token',
        thinkingLevel: 'off',
        promptInput: '',
        autoCompaction: true,
      });

      await agent.ready();

      expect(infoMessages).toContain('[auto-compaction] enabled');
    });

    test('does not enable auto-compaction when config.autoCompaction is false', async () => {
      const infoMessages: string[] = [];
      const testCore = {
        ...mockCoreAdapter,
        info: mock((msg: string) => {
          infoMessages.push(msg);
        }),
      };

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'test-token',
        thinkingLevel: 'off',
        promptInput: '',
        autoCompaction: false,
      });

      await agent.ready();

      expect(infoMessages).not.toContain('[auto-compaction] enabled');
    });

    test('does not enable auto-compaction when config.autoCompaction is undefined', async () => {
      const infoMessages: string[] = [];
      const testCore = {
        ...mockCoreAdapter,
        info: mock((msg: string) => {
          infoMessages.push(msg);
        }),
      };

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: 'test-token',
        thinkingLevel: 'off',
        promptInput: '',
        // autoCompaction omitted
      });

      await agent.ready();

      expect(infoMessages).not.toContain('[auto-compaction] enabled');
    });
  });
});

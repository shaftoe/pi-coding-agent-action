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

describe('Agent', () => {
  describe('constructor', () => {
    test('throws error for non-existent model', () => {
      // Use a provider/model combo that won't exist in the registry
      expect(() => {
        const _agent = new Agent(
          'model-name',
          'fake-provider',
          'test-token',
          'off',
          mockCoreAdapter as any,
          mockPlatformProvider
        );
      }).toThrow('Model not found');
    });

    test('stores token in auth storage when provided', () => {
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'sk-12345',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
      // Agent is created without error
      expect(agent).toBeDefined();
    });

    test('does not set auth storage when token is empty', () => {
      const mockDebug: string[] = [];
      const debugLogger = (msg: string): void => {
        mockDebug.push(msg);
      };
      const adapter = { ...mockCoreAdapter, debug: mock(debugLogger) };

      new Agent('claude-sonnet-4-5', 'anthropic', '', 'off', adapter as any, mockPlatformProvider);

      // Should not log auth debug message
      expect(mockDebug).not.toContain('[auth] Setting api_key token');
    });

    test('stores model, provider, and thinking level', () => {
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'medium',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
      // Agent is created without error
      expect(agent).toBeDefined();
      // Can't directly verify internal properties, but creation succeeds
    });
  });

  describe('ready', () => {
    test('initializes session and returns self', async () => {
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
      const result = await agent.ready();
      expect(result).toBe(agent);
    });

    test('subscribes to message_update events', async () => {
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );

      // The real session subscribe will be called during ready()
      await agent.ready();
      // Can't directly verify subscribe was called, but ready() succeeds
      expect(agent).toBeDefined();
    });
  });

  describe('run', () => {
    test('throws error for empty text', async () => {
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
      await agent.ready();

      expect(agent.run('')).rejects.toThrow('no text, skipping prompt');
    });

    test('throws error for undefined text', async () => {
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
      await agent.ready();

      await expect(agent.run(undefined as unknown as string)).rejects.toThrow(
        'no text, skipping prompt'
      );
    });

    test('returns PromptResult with sessionStats', async () => {
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
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
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
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
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
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
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
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

  describe('exportSessionHtml', () => {
    test('delegates to session.exportToHtml', async () => {
      const agent = new Agent(
        'claude-sonnet-4-5',
        'anthropic',
        'test-token',
        'off',
        mockCoreAdapter as any,
        mockPlatformProvider
      );
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
});

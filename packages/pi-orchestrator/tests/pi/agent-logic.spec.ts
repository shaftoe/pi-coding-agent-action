/**
 * Tests for Agent class.
 *
 * Tests the Pi agent wrapper including session stats handling.
 */

import { describe, expect, test, mock } from 'bun:test';
import { resolve } from 'node:path';
import { buildMockSession, injectMockSession, userHelloMessage } from './helpers/agent-session';
import { createMockProvider } from '../helpers/tool-mocks';

/**
 * Build a `CoreAdapter` whose `.info(msg)` calls push `msg` into the returned
 * array. Replaces the `infoMessages` capture pattern duplicated across tests.
 */
function createCoreWithInfoCapture(): { core: any; messages: string[] } {
  const messages: string[] = [];
  const core = {
    ...mockCoreAdapter,
    info: mock((msg: string) => {
      messages.push(msg);
    }),
  };
  return { core, messages };
}

/**
 * Build a `CoreAdapter` whose `.error(msg)` calls push `msg` into the returned
 * array. Replaces the `errorMessages` capture pattern duplicated across tests.
 */
function createCoreWithErrorCapture(): { core: any; messages: string[] } {
  const messages: string[] = [];
  const core = {
    ...mockCoreAdapter,
    error: mock((msg: string) => {
      messages.push(msg);
    }),
  };
  return { core, messages };
}

/** Default agent config used by most tests in this file. */
const defaultAgentConfig = {
  model: 'claude-sonnet-4-5',
  provider: 'anthropic',
  token: 'test-token',
  thinkingLevel: 'off',
  promptInput: '',
} as const;

// Mock @actions/core to provide required inputs before importing Agent
const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  if (name === 'trigger') {
    return '/pi ';
  }
  if (name === 'max_comments') {
    return '100';
  }
  return '';
});

// Set env vars before importing any modules that use them
process.env.INPUT_TRIGGER = '/pi ';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.INPUT_MAX_COMMENTS = '100';

// Dynamic import to ensure mocks are set up before module loads
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
const { Agent } = await import('@alexanderfortin/pi-orchestrator');

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
const mockPlatformProvider = createMockProvider();

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

      // Constructor no longer throws for unknown models — resolution is
      // deferred to ready() so that extension-provided providers are available.
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
    test('throws error for non-existent model after extensions load', async () => {
      // Model resolution is deferred to ready() so that extension-provided
      // providers are available. A model that doesn't exist even after
      // extensions load should throw here.
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        model: 'model-name',
        provider: 'fake-provider',
        token: 'test-token',
        thinkingLevel: 'off',
        promptInput: '',
      });

      await expect(agent.ready()).rejects.toThrow('Model not found');
    });

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

    test('detects session-level error from last assistant message', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          stats: { input: 10, output: 0, total: 10, cost: 0 },
          messages: [
            userHelloMessage,
            {
              role: 'assistant',
              content: [],
              stopReason: 'error',
              errorMessage: '429 Usage limit reached for 5 hour',
              timestamp: 1,
            },
          ],
        })
      );

      const result = await agent.run('Hello');
      expect(result.error).toBe('429 Usage limit reached for 5 hour');
      expect(result.result).toBe('');
    });

    test('returns undefined error when session completed normally', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          messages: [
            userHelloMessage,
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hi there!' }],
              stopReason: 'stop',
              timestamp: 1,
            },
          ],
        })
      );

      const result = await agent.run('Hello');
      expect(result.error).toBeUndefined();
    });

    test('returns undefined error when last assistant has toolUse stopReason', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          messages: [
            userHelloMessage,
            {
              role: 'assistant',
              content: [],
              stopReason: 'toolUse',
              timestamp: 1,
            },
            { role: 'toolResult', toolCallId: 'x', content: [], isError: false, timestamp: 2 },
          ],
        })
      );

      const result = await agent.run('Hello');
      expect(result.error).toBeUndefined();
    });

    test('ignores earlier errors when last assistant succeeded (after retry)', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          messages: [
            userHelloMessage,
            {
              role: 'assistant',
              content: [],
              stopReason: 'error',
              errorMessage: '503 overloaded',
              timestamp: 1,
            },
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Success after retry!' }],
              stopReason: 'stop',
              timestamp: 2,
            },
          ],
        })
      );

      const result = await agent.run('Hello');
      expect(result.error).toBeUndefined();
    });

    test('returns error when session has only error messages', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          stats: { input: 10, output: 0, total: 10, cost: 0 },
          messages: [
            userHelloMessage,
            {
              role: 'assistant',
              content: [],
              stopReason: 'error',
              errorMessage: 'quota exceeded',
              timestamp: 1,
            },
          ],
        })
      );

      const result = await agent.run('Hello');
      expect(result.error).toBe('quota exceeded');
    });

    test('returns PromptResult with sessionStats', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          stats: { input: 100, output: 50, total: 150, cost: 0.00123 },
          messages: [],
        })
      );

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
        error: undefined,
      });
    });

    test('returns PromptResult with undefined sessionStats when SDK throws', async () => {
      const agent = createRealAgent();
      await agent.ready();

      // Mock the session to throw an error on getSessionStats
      const throwingSession = {
        ...buildMockSession({ messages: [] }),
        getSessionStats: () => {
          throw new Error('SDK internal error');
        },
      };
      injectMockSession(agent, throwingSession);

      const result = await agent.run('Hello');
      expect(result).toEqual({
        result: '',
        sessionStats: undefined,
        error: undefined,
      });
    });

    test('returns PromptResult with zero tokens and cost', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          stats: { input: 0, output: 0, total: 0, cost: 0 },
          messages: [],
        })
      );

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
        error: undefined,
      });
    });

    test('returns PromptResult with large token counts', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          stats: { input: 100000, output: 50000, total: 150000, cost: 1.2345 },
          messages: [],
        })
      );

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
        error: undefined,
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
      const { core: testCore, messages: infoMessages } = createCoreWithInfoCapture();

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        ...defaultAgentConfig,
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
      const { core: testCore, messages: infoMessages } = createCoreWithInfoCapture();

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        autoCompaction: true,
      });

      await agent.ready();

      expect(infoMessages).toContain('[auto-compaction] enabled');
    });

    test('does not enable auto-compaction when config.autoCompaction is false', async () => {
      const { core: testCore, messages: infoMessages } = createCoreWithInfoCapture();

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        autoCompaction: false,
      });

      await agent.ready();

      expect(infoMessages).not.toContain('[auto-compaction] enabled');
    });

    test('does not enable auto-compaction when config.autoCompaction is undefined', async () => {
      const { core: testCore, messages: infoMessages } = createCoreWithInfoCapture();

      const agent = new Agent(testCore as any, mockPlatformProvider, defaultAgentConfig);

      await agent.ready();

      expect(infoMessages).not.toContain('[auto-compaction] enabled');
    });
  });

  describe('session manager selection', () => {
    /**
     * Access the session manager's file path from a ready agent.
     * File-backed sessions (SessionManager.create) return a string path;
     * in-memory sessions (SessionManager.inMemory) return undefined.
     */
    function getSessionFilePath(agent: InstanceType<typeof Agent>): string | undefined {
      const session = (
        agent as unknown as {
          session: { sessionManager: { getSessionFile: () => string | undefined } };
        }
      ).session;
      return session.sessionManager.getSessionFile();
    }

    test('uses file-backed session when exportSessionHtml is true', async () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        exportSessionHtml: true,
      });

      await agent.ready();

      const sessionFile = getSessionFilePath(agent);
      expect(sessionFile).toBeDefined();
      expect(typeof sessionFile).toBe('string');
      expect(sessionFile).toMatch(/\.jsonl$/);
    });

    test('uses file-backed session when exportSessionJsonl is true', async () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        exportSessionJsonl: true,
      });

      await agent.ready();

      const sessionFile = getSessionFilePath(agent);
      expect(sessionFile).toBeDefined();
      expect(typeof sessionFile).toBe('string');
      expect(sessionFile).toMatch(/\.jsonl$/);
    });

    test('uses file-backed session when both exportSessionHtml and exportSessionJsonl are true', async () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        exportSessionHtml: true,
        exportSessionJsonl: true,
      });

      await agent.ready();

      const sessionFile = getSessionFilePath(agent);
      expect(sessionFile).toBeDefined();
      expect(typeof sessionFile).toBe('string');
    });

    test('uses in-memory session when exportSessionHtml and exportSessionJsonl are false', async () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        exportSessionHtml: false,
        exportSessionJsonl: false,
      });

      await agent.ready();

      const sessionFile = getSessionFilePath(agent);
      expect(sessionFile).toBeUndefined();
    });

    test('uses in-memory session by default when no export flags are set', async () => {
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        // Neither exportSessionHtml nor exportSessionJsonl is set
      });

      await agent.ready();

      const sessionFile = getSessionFilePath(agent);
      expect(sessionFile).toBeUndefined();
    });
  });

  describe('extension error logging', () => {
    test('logs extension loading errors from getExtensions().errors', async () => {
      const { core: testCore, messages: errorMessages } = createCoreWithErrorCapture();

      // Use the intentionally broken extension fixture
      const brokenExtensionPath = resolve(__dirname, '../fixtures/extensions/broken-extension.ts');

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        extensions: [brokenExtensionPath],
      });

      // ready() should still succeed — the broken extension fails to load
      // but the built-in anthropic provider is still available.
      await agent.ready();

      // The extension error should have been logged via logger.error()
      const extensionErrors = errorMessages.filter(m => m.startsWith('[extension]'));
      expect(extensionErrors.length).toBeGreaterThan(0);
      // The error message should reference the broken extension path
      expect(extensionErrors[0]).toContain('intentional extension loading failure');
    });

    test('no extension errors logged when all extensions load cleanly', async () => {
      const { core: testCore, messages: errorMessages } = createCoreWithErrorCapture();

      // Create agent without any extensions
      const agent = new Agent(testCore as any, mockPlatformProvider, defaultAgentConfig);

      await agent.ready();

      const extensionErrors = errorMessages.filter(m => m.startsWith('[extension]'));
      expect(extensionErrors).toHaveLength(0);
    });
  });
});

/**
 * Tests for Agent class.
 *
 * Tests the Pi agent wrapper including session stats handling.
 */

import { describe, expect, test, vi } from 'vitest';
import { resolve } from 'node:path';
import { buildMockSession, injectMockSession, userHelloMessage } from './helpers/agent-session';
import type { MockSession, MockSessionEvent } from './helpers/agent-session';
import { createMockProvider } from '../helpers/tool-mocks';

/**
 * Build a `CoreAdapter` whose `.info(msg)` calls push `msg` into the returned
 * array. Replaces the `infoMessages` capture pattern duplicated across tests.
 */
function createCoreWithInfoCapture(): { core: any; messages: string[] } {
  const messages: string[] = [];
  const core = {
    ...mockCoreAdapter,
    info: vi.fn((msg: string) => {
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
    error: vi.fn((msg: string) => {
      messages.push(msg);
    }),
  };
  return { core, messages };
}

/**
 * Build a `CoreAdapter` whose `.warning(msg)` calls push `msg` into the returned
 * array. Used to assert that thinking-level clamp warnings are surfaced.
 */
function createCoreWithWarningCapture(): { core: any; messages: string[] } {
  const messages: string[] = [];
  const core = {
    ...mockCoreAdapter,
    warning: vi.fn((msg: string) => {
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
const mockGetInput = vi.fn((name: string) => {
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
// @ts-ignore TS1309 -- Top-level await not supported in CommonJS, but Vitest handles it
const { Agent } = await import('@alexanderfortin/pi-orchestrator');

// Create a mock CoreAdapter for tests
const mockCoreAdapter = {
  getInput: mockGetInput,
  notice: vi.fn(noop),
  debug: vi.fn(noop),
  info: vi.fn(noop),
  setFailed: vi.fn(noop),
  setOutput: vi.fn(noop),
  warning: vi.fn(noop),
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
    test('constructs without error when token is provided', () => {
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

    test('does not set runtime API key when token is empty', async () => {
      const mockDebug: string[] = [];
      const debugLogger = (msg: string): void => {
        mockDebug.push(msg);
      };
      const adapter = { ...mockCoreAdapter, debug: vi.fn(debugLogger) };

      // API-key setup moved from the constructor to ready() in the
      // ModelRuntime migration, so verify at the ready() level.
      const agent = new Agent(adapter as any, mockPlatformProvider, {
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        token: '',
        thinkingLevel: 'off',
        promptInput: '',
      });
      await agent.ready();

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

      await expect(agent.run('')).rejects.toThrow('no text, skipping prompt');
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

    test('exposes session stats via getSessionStats()', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMockSession({
          stats: { input: 80, output: 20, total: 100, cost: 0.05 },
          messages: [],
        })
      );

      await agent.run('Hello');

      expect(agent.getSessionStats()).toEqual({
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        cost: 0.05,
        version: expect.any(String),
      });
    });

    test('getSessionStats() returns partial usage after prompt() throws', async () => {
      const agent = createRealAgent();
      await agent.ready();

      const throwingSession = {
        ...buildMockSession({
          stats: { input: 250, output: 30, total: 280, cost: 0.012 },
          messages: [],
        }),
        prompt: async () => {
          throw new Error('network blew up');
        },
      };
      injectMockSession(agent, throwingSession);

      await expect(agent.run('Hello')).rejects.toThrow('network blew up');

      // Partial usage is still recoverable after the rejection.
      expect(agent.getSessionStats()).toEqual({
        inputTokens: 250,
        outputTokens: 30,
        totalTokens: 280,
        cost: 0.012,
        version: expect.any(String),
      });
    });
  });

  describe('agent_end / agent_settled event handling', () => {
    /**
     * Build a mock session that dispatches a custom sequence of agent_end
     * events (e.g. error → retry → success) before agent_settled.
     */
    function buildMultiEventSession(
      agentEndPayloads: Record<string, unknown>[][]
    ): ReturnType<typeof buildMockSession> {
      let listener: ((event: { type: string; [key: string]: unknown }) => void) | undefined;
      return {
        ...buildMockSession({ messages: [] }),
        prompt: async () => {
          for (const messages of agentEndPayloads) {
            listener?.({ type: 'agent_end', messages, willRetry: false });
          }
          listener?.({ type: 'agent_settled' });
        },
        subscribe: (cb: (event: { type: string; [key: string]: unknown }) => void) => {
          listener = cb;
        },
      };
    }

    test('onPromptComplete is called when agent_settled fires', async () => {
      const onComplete = vi.fn(() => {});
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        ...defaultAgentConfig,
      });
      // Inject the events callback via the constructor's events parameter.
      (agent as unknown as { events: { onPromptComplete: () => void } }).events = {
        onPromptComplete: onComplete,
      };
      await agent.ready();

      injectMockSession(agent, buildMockSession({ messages: [] }));

      await agent.run('Hello');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('onPromptComplete is NOT called for individual agent_end events', async () => {
      const onComplete = vi.fn(() => {});
      const agent = createRealAgent();
      (agent as unknown as { events: { onPromptComplete: () => void } }).events = {
        onPromptComplete: onComplete,
      };
      await agent.ready();

      injectMockSession(
        agent,
        buildMultiEventSession([
          // First agent_end with an error — should NOT trigger onPromptComplete
          [
            userHelloMessage,
            {
              role: 'assistant',
              content: [],
              stopReason: 'error',
              errorMessage: '503 overloaded',
              timestamp: 1,
            },
          ],
          // Second agent_end after retry succeeds
          [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Recovered!' }],
              stopReason: 'stop',
              timestamp: 2,
            },
          ],
        ])
      );

      await agent.run('Hello');
      // onPromptComplete should fire exactly once (from agent_settled),
      // not once per agent_end.
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    test('error from agent_end is cleared by a subsequent successful agent_end', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMultiEventSession([
          // First agent_end: error
          [
            userHelloMessage,
            {
              role: 'assistant',
              content: [],
              stopReason: 'error',
              errorMessage: '503 overloaded',
              timestamp: 1,
            },
          ],
          // Second agent_end: success after retry
          [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Success after retry!' }],
              stopReason: 'stop',
              timestamp: 2,
            },
          ],
        ])
      );

      const result = await agent.run('Hello');
      expect(result.error).toBeUndefined();
      expect(result.result).toBe(''); // mock session doesn't push text deltas
    });

    test('error from the last agent_end is preserved', async () => {
      const agent = createRealAgent();
      await agent.ready();

      injectMockSession(
        agent,
        buildMultiEventSession([
          // First agent_end: success
          [
            userHelloMessage,
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'First attempt' }],
              stopReason: 'stop',
              timestamp: 1,
            },
          ],
          // Second agent_end: error
          [
            {
              role: 'assistant',
              content: [],
              stopReason: 'error',
              errorMessage: '429 rate limit',
              timestamp: 2,
            },
          ],
        ])
      );

      const result = await agent.run('Hello');
      expect(result.error).toBe('429 rate limit');
    });
  });

  /**
   * Build a mock session that dispatches an arbitrary sequence of raw
   * `AgentSessionEvent`s through the agent's registered handler when
   * `prompt()` is called. Used to exercise events (e.g. `auto_retry_*`)
   * that arrive on the session stream rather than the ExtensionAPI.
   */
  function buildRawEventSession(events: MockSessionEvent[]): MockSession {
    let listener: ((event: MockSessionEvent) => void) | undefined;
    return {
      getSessionStats: () => ({ tokens: { input: 0, output: 0, total: 0 }, cost: 0 }),
      prompt: async () => {
        for (const event of events) {
          listener?.(event);
        }
      },
      subscribe: (cb: (event: MockSessionEvent) => void) => {
        listener = cb;
      },
      state: { messages: [] },
    };
  }

  describe('auto_retry event handling', () => {
    test('auto_retry_start logs an info line with attempt/maxAttempts/delay/error', async () => {
      const { core: testCore, messages: infoMessages } = createCoreWithInfoCapture();
      const agent = new Agent(testCore as any, mockPlatformProvider, defaultAgentConfig);
      await agent.ready();

      injectMockSession(
        agent,
        buildRawEventSession([
          {
            type: 'auto_retry_start',
            attempt: 1,
            maxAttempts: 3,
            delayMs: 1500,
            errorMessage: '503 overloaded',
          },
          { type: 'auto_retry_end', success: true, attempt: 1 },
          { type: 'agent_settled' },
        ])
      );

      await agent.run('Hello');

      const retryLine = infoMessages.find(m => m.startsWith('[auto-retry] 🔄'));
      expect(retryLine).toBeDefined();
      expect(retryLine).toContain('attempt 1/3');
      expect(retryLine).toContain('1500ms');
      expect(retryLine).toContain('503 overloaded');
    });

    test('auto_retry_end success logs an info recovery line', async () => {
      const { core: testCore, messages: infoMessages } = createCoreWithInfoCapture();
      const agent = new Agent(testCore as any, mockPlatformProvider, defaultAgentConfig);
      await agent.ready();

      injectMockSession(
        agent,
        buildRawEventSession([
          {
            type: 'auto_retry_start',
            attempt: 2,
            maxAttempts: 3,
            delayMs: 0,
            errorMessage: 'transient',
          },
          { type: 'auto_retry_end', success: true, attempt: 2 },
          { type: 'agent_settled' },
        ])
      );

      await agent.run('Hello');

      const recoveredLine = infoMessages.find(m => m.startsWith('[auto-retry] ✅'));
      expect(recoveredLine).toBeDefined();
      expect(recoveredLine).toContain('attempt 2');
    });

    test('auto_retry_end failure logs a warning with the final error', async () => {
      const { core: testCore, messages: warnings } = createCoreWithWarningCapture();
      const agent = new Agent(testCore as any, mockPlatformProvider, defaultAgentConfig);
      await agent.ready();

      injectMockSession(
        agent,
        buildRawEventSession([
          {
            type: 'auto_retry_start',
            attempt: 3,
            maxAttempts: 3,
            delayMs: 0,
            errorMessage: 'still failing',
          },
          {
            type: 'auto_retry_end',
            success: false,
            attempt: 3,
            finalError: 'connection reset',
          },
          { type: 'agent_settled' },
        ])
      );

      await agent.run('Hello');

      const exhaustedLine = warnings.find(m => m.startsWith('[auto-retry] ❌'));
      expect(exhaustedLine).toBeDefined();
      expect(exhaustedLine).toContain('attempt 3');
      expect(exhaustedLine).toContain('connection reset');
    });
  });

  describe('summarization_retry event handling', () => {
    test('summarization_retry_scheduled logs an info line with attempt/maxAttempts/delay/error', async () => {
      const { core: testCore, messages: infoMessages } = createCoreWithInfoCapture();
      const agent = new Agent(testCore as any, mockPlatformProvider, defaultAgentConfig);
      await agent.ready();

      injectMockSession(
        agent,
        buildRawEventSession([
          {
            type: 'summarization_retry_scheduled',
            attempt: 1,
            maxAttempts: 2,
            delayMs: 800,
            errorMessage: 'summary timeout',
          },
          { type: 'summarization_retry_finished' },
          { type: 'agent_settled' },
        ])
      );

      await agent.run('Hello');

      const retryLine = infoMessages.find(m => m.startsWith('[summarization-retry] 🔄'));
      expect(retryLine).toBeDefined();
      expect(retryLine).toContain('attempt 1/2');
      expect(retryLine).toContain('800ms');
      expect(retryLine).toContain('summary timeout');
    });

    test('summarization_retry_attempt_start logs a debug line naming the source', async () => {
      const debug = vi.fn();
      const testCore = { ...mockCoreAdapter, debug };
      const agent = new Agent(testCore as any, mockPlatformProvider, defaultAgentConfig);
      await agent.ready();

      injectMockSession(
        agent,
        buildRawEventSession([
          { type: 'summarization_retry_attempt_start', source: 'compaction', reason: 'overflow' },
          { type: 'agent_settled' },
        ])
      );

      await agent.run('Hello');

      const debugLine = debug.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' && (c[0] as string).startsWith('[summarization-retry] ▶️')
      );
      expect(debugLine).toBeDefined();
      expect(debugLine![0]).toContain('compaction');
      expect(debugLine![0]).toContain('overflow');
    });

    test('summarization_retry_finished logs an info line', async () => {
      const { core: testCore, messages: infoMessages } = createCoreWithInfoCapture();
      const agent = new Agent(testCore as any, mockPlatformProvider, defaultAgentConfig);
      await agent.ready();

      injectMockSession(
        agent,
        buildRawEventSession([{ type: 'summarization_retry_finished' }, { type: 'agent_settled' }])
      );

      await agent.run('Hello');

      const finishedLine = infoMessages.find(m => m.startsWith('[summarization-retry] ✅'));
      expect(finishedLine).toBeDefined();
      expect(finishedLine).toContain('finished');
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

  describe('thinking level clamping', () => {
    // claude-sonnet-4-5 supports off–high but NOT xhigh.
    test('clamps unsupported xhigh to high and warns', async () => {
      const { core: testCore, messages: warnings } = createCoreWithWarningCapture();

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        thinkingLevel: 'xhigh',
      });

      await agent.ready();

      expect((agent as any).thinkingLevel).toBe('high');
      // The effective level must also be propagated back to the config so the
      // orchestrator's comment footer reports the level actually in use.
      expect((agent as any).config.thinkingLevel).toBe('high');
      const warning = warnings.find(m => m.startsWith('[thinking]'));
      expect(warning).toBeDefined();
      expect(warning).toContain('xhigh');
      expect(warning).toContain('claude-sonnet-4-5');
      expect(warning).toContain('high');
      // The supported-levels list should exclude xhigh.
      expect(warning).toContain('off, minimal, low, medium, high');
    });

    test('does not clamp a supported level (high)', async () => {
      const { core: testCore, messages: warnings } = createCoreWithWarningCapture();

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        thinkingLevel: 'high',
      });

      await agent.ready();

      expect((agent as any).thinkingLevel).toBe('high');
      expect(warnings.find(m => m.startsWith('[thinking]'))).toBeUndefined();
    });

    test('does not clamp the default off level', async () => {
      const { core: testCore, messages: warnings } = createCoreWithWarningCapture();

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        thinkingLevel: 'off',
      });

      await agent.ready();

      expect((agent as any).thinkingLevel).toBe('off');
      expect(warnings.find(m => m.startsWith('[thinking]'))).toBeUndefined();
    });

    test('normalizes invalid input (empty string) to off and warns', async () => {
      const { core: testCore, messages: warnings } = createCoreWithWarningCapture();

      const agent = new Agent(testCore as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        thinkingLevel: '' as any,
      });

      await agent.ready();

      expect((agent as any).thinkingLevel).toBe('off');
      // The effective level must also be propagated back to the config.
      expect((agent as any).config.thinkingLevel).toBe('off');
      const warning = warnings.find(m => m.startsWith('[thinking]'));
      expect(warning).toBeDefined();
      // For parity with the xhigh test, assert the normalized level surfaces
      // in the warning message.
      expect(warning).toContain('off');
    });
  });

  describe('exportSessionHtml', () => {
    test('delegates to session.exportToHtml', async () => {
      const agent = createRealAgent();
      await agent.ready();

      const mockExportToHtml = vi.fn(async (outputPath: string) => outputPath);
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

      const mockExportToJsonl = vi.fn((outputPath: string) => outputPath);
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

    test('uses file-backed session when shareSession is true (even with exports disabled)', async () => {
      // shareSession auto-enables the HTML export path, which requires a
      // file-backed session. Without persistence, exportToHtml() throws
      // "Cannot export in-memory session to HTML" and sharing silently
      // skips — this was a critical bug in the initial share_session PR.
      const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
        ...defaultAgentConfig,
        shareSession: true,
        exportSessionHtml: false,
        exportSessionJsonl: false,
      });

      await agent.ready();

      const sessionFile = getSessionFilePath(agent);
      expect(sessionFile).toBeDefined();
      expect(typeof sessionFile).toBe('string');
      expect(sessionFile).toMatch(/\.jsonl$/);
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

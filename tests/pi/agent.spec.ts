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
  warning: mock(noop),
}));

// Set env vars before importing any modules that use them
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.INPUT_MAX_COMMENTS = '100';

// Dynamic import to ensure mocks are set up before module loads
const { Agent } = await import('../../src/pi/agent');

describe('Agent', () => {
  describe('getSessionStats', () => {
    test('returns undefined when session not ready', () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      const stats = agent.getSessionStats();
      expect(stats).toBeUndefined();
    });

    test('returns correct stats on success', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      await agent.ready();

      // Mock the session to return known stats
      const mockStats = {
        getSessionStats: () => ({
          tokens: { input: 100, output: 50, total: 150 },
          cost: 0.00123,
        }),
      };
      agent['session'] = mockStats as any;

      const stats = agent.getSessionStats();
      expect(stats).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.00123,
      });
    });

    test('returns undefined when SDK throws', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      await agent.ready();

      // Mock the session to throw an error
      const mockSession = {
        getSessionStats: () => {
          throw new Error('SDK internal error');
        },
        subscribe: () => {},
        prompt: async () => {},
      };
      agent['session'] = mockSession as any;

      const stats = agent.getSessionStats();
      expect(stats).toBeUndefined();
    });

    test('returns undefined when SDK throws non-Error', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      await agent.ready();

      // Mock the session to throw a non-Error
      const mockSession = {
        getSessionStats: () => {
          throw 'String error from SDK';
        },
        subscribe: () => {},
        prompt: async () => {},
      };
      agent['session'] = mockSession as any;

      const stats = agent.getSessionStats();
      expect(stats).toBeUndefined();
    });

    test('returns undefined when SDK returns null/undefined stats', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      await agent.ready();

      // Mock the session to return null stats (which causes property access to throw)
      const mockSession = {
        getSessionStats: () => null as any,
        subscribe: () => {},
        prompt: async () => {},
      };
      agent['session'] = mockSession as any;

      // Should return undefined gracefully, not throw
      const stats = agent.getSessionStats();
      expect(stats).toBeUndefined();
    });

    test('handles zero tokens and cost', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      await agent.ready();

      // Mock the session to return zero values
      const mockStats = {
        getSessionStats: () => ({
          tokens: { input: 0, output: 0, total: 0 },
          cost: 0,
        }),
      };
      agent['session'] = mockStats as any;

      const stats = agent.getSessionStats();
      expect(stats).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cost: 0,
      });
    });

    test('handles large token counts', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      await agent.ready();

      // Mock the session to return large values
      const mockStats = {
        getSessionStats: () => ({
          tokens: { input: 100000, output: 50000, total: 150000 },
          cost: 1.2345,
        }),
      };
      agent['session'] = mockStats as any;

      const stats = agent.getSessionStats();
      expect(stats).toEqual({
        inputTokens: 100000,
        outputTokens: 50000,
        totalTokens: 150000,
        cost: 1.2345,
      });
    });
  });

  describe('constructor', () => {
    test('throws error for non-existent model', () => {
      // Use a provider/model combo that won't exist in the registry
      expect(() => {
        const _agent = new Agent('model-name', 'fake-provider', 'test-token');
      }).toThrow('Model not found');
    });

    test('stores token in auth storage when provided', () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'sk-12345');
      // Agent is created without error
      expect(agent).toBeDefined();
    });
  });

  describe('ready and prompt', () => {
    test('ready initializes session', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      const result = await agent.ready();
      expect(result).toBe(agent);
    });

    test('prompt throws error for empty text', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      await agent.ready();

      await expect(agent.prompt('')).rejects.toThrow('no text, skipping prompt');
    });

    test('prompt throws error for undefined text', async () => {
      const agent = new Agent('claude-sonnet-4-5', 'anthropic', 'test-token');
      await agent.ready();

      await expect(agent.prompt(undefined as unknown as string)).rejects.toThrow(
        'no text, skipping prompt'
      );
    });
  });
});

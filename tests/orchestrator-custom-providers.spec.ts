/**
 * Tests for custom provider registration via `custom_providers` action input.
 *
 * Verifies parsing, validation, and pass-through of the `custom_providers`
 * JSON input through the orchestrator → PiAgent pipeline.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare global {
  var __VERSION__: string;
}
globalThis.__VERSION__ = 'test-version';

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { Temporal } from '@js-temporal/polyfill';
import { ActionOrchestrator } from '../src/orchestrator';
import type { CoreAdapter, GitAdapter, PiAgent } from '../src/types';
import type { PlatformProvider } from '../src/platform';

/**
 * Default inputs shared across tests.
 */
function defaultInputs(overrides?: Record<string, string>): Record<string, string> {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    token: 'test-token',
    thinking_level: '',
    prompt: '',
    custom_providers: '',
    ...overrides,
  };
}

/**
 * Helper to create a minimal working orchestrator environment.
 */
function createTestEnvironment() {
  const getInputMock = mock((name: string) => {
    return defaultInputs()[name] ?? '';
  });

  const mockCore: CoreAdapter = {
    getInput: getInputMock,
    setFailed: mock(),
    setOutput: mock(),
    notice: mock(),
    info: mock(),
    debug: mock(),
    warning: mock(),
  } as any;

  const mockPiAgent: PiAgent = {
    run: mock(async () => ({
      result: 'OK',
      sessionStats: undefined,
    })) as any,
    exportSessionHtml: mock(async (p: string) => p) as any,
  };

  const mockPiFactory = mock(() => mockPiAgent);

  const mockGit: GitAdapter = {
    addReaction: mock(async () => undefined) as any,
    deleteReaction: mock(async () => {}) as any,
    createFinalComment: mock(async () => {}) as any,
    getPrompt: mock(async () => 'test prompt') as any,
    getStartTime: mock(() => Temporal.Now.instant()) as any,
  };

  const mockProvider: PlatformProvider = {
    type: 'github',
    getContext: mock(() => ({
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 1 },
      eventName: 'issue_comment',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 123,
      workspace: '/tmp',
    })),
    addReaction: mock(async () => undefined),
    deleteReaction: mock(async () => {}),
    createFinalComment: mock(async () => {}),
    getPrompt: mock(async () => 'test prompt'),
    getStartTime: mock(() => undefined),
    createPullRequest: mock(async () => ({
      content: [{ type: 'text', text: 'PR created' }],
      details: { pullRequestNumber: 1, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
    })),
    updatePullRequest: mock(async () => ({
      content: [{ type: 'text', text: 'PR updated' }],
      details: { pullRequestNumber: 1, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
    })),
    getIssueOrPRThread: mock(async () => undefined),
  } as any;

  return { mockCore, mockGit, mockPiFactory, mockPiAgent, mockProvider, getInputMock };
}

/**
 * Helper: set up getInput to return specific custom_providers JSON and default
 * values for everything else.
 */
function withCustomProviders(env: ReturnType<typeof createTestEnvironment>, json: string) {
  env.getInputMock.mockImplementation((name: string) => {
    if (name === 'custom_providers') {
      return json;
    }
    return defaultInputs()[name] ?? '';
  });
}

describe('ActionOrchestrator — custom_providers', () => {
  let env: ReturnType<typeof createTestEnvironment>;

  beforeEach(() => {
    env = createTestEnvironment();
  });

  describe('input parsing', () => {
    test('calls getInput for custom_providers', async () => {
      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();
      expect(env.mockCore.getInput).toHaveBeenCalledWith('custom_providers');
    });

    test('omits customProviders when input is empty', async () => {
      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          customProviders: expect.any(Array),
        }),
        env.mockCore, env.mockProvider
      );
    });

    test('parses a single-provider JSON array', async () => {
      const customProviders = JSON.stringify([{
        name: 'my-llm',
        baseUrl: 'https://api.example.com/v1',
        models: [{
          id: 'my-model-v1',
          name: 'My Model V1',
          reasoning: false,
          input: ['text'],
          cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
        }],
      }]);
      withCustomProviders(env, customProviders);

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          customProviders: [
            {
              name: 'my-llm',
              baseUrl: 'https://api.example.com/v1',
              models: [{
                id: 'my-model-v1',
                name: 'My Model V1',
                reasoning: false,
                input: ['text'],
                cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 4096,
              }],
            },
          ],
        }),
        env.mockCore, env.mockProvider
      );
    });

    test('parses a multi-provider JSON array', async () => {
      const customProviders = JSON.stringify([
        { name: 'provider-a', baseUrl: 'https://a.example.com/v1' },
        { name: 'provider-b', baseUrl: 'https://b.example.com/v1', headers: { 'X-Custom': 'value' } },
      ]);
      withCustomProviders(env, customProviders);

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          customProviders: [
            { name: 'provider-a', baseUrl: 'https://a.example.com/v1' },
            { name: 'provider-b', baseUrl: 'https://b.example.com/v1', headers: { 'X-Custom': 'value' } },
          ],
        }),
        env.mockCore, env.mockProvider
      );
    });

    test('supports provider with custom apiKey', async () => {
      const customProviders = JSON.stringify([{
        name: 'my-llm',
        apiKey: 'provider-specific-key',
        baseUrl: 'https://api.example.com/v1',
      }]);
      withCustomProviders(env, customProviders);

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          customProviders: [{
            name: 'my-llm',
            apiKey: 'provider-specific-key',
            baseUrl: 'https://api.example.com/v1',
          }],
        }),
        env.mockCore, env.mockProvider
      );
    });

    test('supports provider with only a name (no baseUrl, no models)', async () => {
      const customProviders = JSON.stringify([{ name: 'empty-provider' }]);
      withCustomProviders(env, customProviders);

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          customProviders: [{ name: 'empty-provider' }],
        }),
        env.mockCore, env.mockProvider
      );
    });

    test('handles whitespace-only input as empty', async () => {
      withCustomProviders(env, '   ');

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          customProviders: expect.any(Array),
        }),
        env.mockCore, env.mockProvider
      );
    });

    test('handles undefined getInput response as empty', async () => {
      env.getInputMock.mockImplementation((name: string) => {
        if (name === 'custom_providers') {
          return undefined as any;
        }
        return defaultInputs()[name] ?? '';
      });

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          customProviders: expect.any(Array),
        }),
        env.mockCore, env.mockProvider
      );
    });
  });

  describe('validation errors', () => {
    test('throws descriptive error for invalid JSON', async () => {
      withCustomProviders(env, '{ not valid json');

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );

      await expect(orchestrator.execute()).rejects.toThrow(
        'Invalid `custom_providers` input: not valid JSON'
      );
    });

    test('throws descriptive error when input is not an array', async () => {
      withCustomProviders(env, JSON.stringify({ name: 'oops' }));

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );

      await expect(orchestrator.execute()).rejects.toThrow(
        'Invalid `custom_providers` input: expected a JSON array'
      );
    });

    test('throws error when entry is not an object', async () => {
      withCustomProviders(env, JSON.stringify(['not-an-object']));

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );

      await expect(orchestrator.execute()).rejects.toThrow(
        /Invalid `custom_providers` entry at index 0/
      );
    });

    test('throws error when entry is missing name field', async () => {
      withCustomProviders(env, JSON.stringify([{ baseUrl: 'https://example.com' }]));

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );

      await expect(orchestrator.execute()).rejects.toThrow(
        /missing or invalid `name` field/
      );
    });

    test('throws error when entry name is not a string', async () => {
      withCustomProviders(env, JSON.stringify([{ name: 123 }]));

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );

      await expect(orchestrator.execute()).rejects.toThrow(
        /missing or invalid `name` field/
      );
    });

    test('reports correct index for second entry missing name', async () => {
      withCustomProviders(env, JSON.stringify([
        { name: 'valid-provider' },
        { baseUrl: 'no-name' },
      ]));

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );

      await expect(orchestrator.execute()).rejects.toThrow('at index 1');
    });

    test('validation error triggers setFailed and error comment', async () => {
      withCustomProviders(env, '{ bad');

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );

      await expect(orchestrator.execute()).rejects.toThrow();
      expect(env.mockCore.setFailed).toHaveBeenCalled();
      expect(env.mockGit.createFinalComment).toHaveBeenCalledWith(
        expect.stringContaining('custom_providers'),
        expect.any(Object)
      );
    });
  });

  describe('coexistence with other config options', () => {
    test('customProviders and baseUrl can be used together', async () => {
      const customProviders = JSON.stringify([{
        name: 'my-llm',
        baseUrl: 'https://custom.example.com/v1',
      }]);

      env.getInputMock.mockImplementation((name: string) => {
        return defaultInputs({
          base_url: 'https://proxy.example.com/v1',
          custom_providers: customProviders,
        })[name] ?? '';
      });

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://proxy.example.com/v1',
          customProviders: [{
            name: 'my-llm',
            baseUrl: 'https://custom.example.com/v1',
          }],
        }),
        env.mockCore, env.mockProvider
      );
    });

    test('customProviders and extensions can be used together', async () => {
      const customProviders = JSON.stringify([{
        name: 'my-llm',
        baseUrl: 'https://custom.example.com/v1',
      }]);

      env.getInputMock.mockImplementation((name: string) => {
        return defaultInputs({
          extensions: 'npm:my-extension',
          custom_providers: customProviders,
        })[name] ?? '';
      });

      const orchestrator = new ActionOrchestrator(
        env.mockCore, env.mockGit, env.mockPiFactory, env.mockProvider
      );
      await orchestrator.execute();

      expect(env.mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['npm:my-extension'],
          customProviders: [{
            name: 'my-llm',
            baseUrl: 'https://custom.example.com/v1',
          }],
        }),
        env.mockCore, env.mockProvider
      );
    });
  });
});

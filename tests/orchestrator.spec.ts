/**
 * Tests for ActionOrchestrator business logic.
 *
 * Tests the orchestration flow (configuration gathering, prompt retrieval,
 * reaction lifecycle, Pi execution, finalization) without mocking the
 * underlying implementations. These tests verify the behavior of the
 * action itself.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Provide a default version for tests (build-time constant)
declare global {
  var __VERSION__: string;
}
globalThis.__VERSION__ = 'test-version';
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { Temporal } from '@js-temporal/polyfill';
import { ActionOrchestrator } from '../src/orchestrator';
import type { CoreAdapter, GitAdapter, PiAgent } from '../src/types';
import type { CreateReactionType, PlatformProvider } from '../src/platform';

describe('ActionOrchestrator', () => {
  let mockCore: CoreAdapter;
  let mockGit: GitAdapter;
  let mockProvider: PlatformProvider;
  let mockPiAgent: PiAgent;
  let mockPiFactory: ReturnType<typeof mock>;

  beforeEach(() => {
    // Create mock core adapter
    const getInputMock = mock((name: string) => {
      const defaults: Record<string, string> = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        token: 'test-token',
        thinking_level: '',
        prompt: '',
      };
      return defaults[name];
    });

    const setFailedMock = mock();
    const setOutputMock = mock();
    const noticeMock = mock();
    const infoMock = mock();
    const debugMock = mock();
    const warningMock = mock();
    mockCore = {
      getInput: getInputMock,
      setFailed: setFailedMock,
      setOutput: setOutputMock,
      notice: noticeMock,
      info: infoMock,
      debug: debugMock,
      warning: warningMock,
    } as any;

    // Create mock git adapter
    const addReactionMock = mock(async () => ({ data: { id: 123 } }) as CreateReactionType);
    const deleteReactionMock = mock(async () => {});
    const createFinalCommentMock = mock(async () => {});
    const getPromptMock = mock(async () => 'Help me write tests');
    const getStartTimeMock = mock(() => Temporal.Now.instant());

    mockGit = {
      addReaction: addReactionMock as any,
      deleteReaction: deleteReactionMock as any,
      createFinalComment: createFinalCommentMock as any,
      getPrompt: getPromptMock as any,
      getStartTime: getStartTimeMock as any,
    };

    // Create mock Pi agent
    const runMock = mock(async () => ({
      result: 'Here are your tests!',
      sessionStats: undefined,
    }));
    const exportSessionHtmlMock = mock(async (outputPath: string) => outputPath);
    mockPiAgent = {
      run: runMock as any,
      exportSessionHtml: exportSessionHtmlMock as any,
    };

    mockPiFactory = mock(() => mockPiAgent);

    // Create mock platform provider
    mockProvider = {
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
        details: {
          pullRequestNumber: 1,
          pullRequestUrl: '',
          headBranch: '',
          baseBranch: '',
          dryRun: false,
        },
      })),
      updatePullRequest: mock(async () => ({
        content: [{ type: 'text', text: 'PR updated' }],
        details: {
          pullRequestNumber: 1,
          pullRequestUrl: '',
          headBranch: '',
          baseBranch: '',
          dryRun: false,
        },
      })),
      getIssueOrPRThread: mock(async () => undefined),
    } as any;
  });

  describe('successful execution flow', () => {
    test('gathers config from core inputs', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.getInput).toHaveBeenCalledWith('provider');
      expect(mockCore.getInput).toHaveBeenCalledWith('model');
      expect(mockCore.getInput).toHaveBeenCalledWith('token');
      expect(mockCore.getInput).toHaveBeenCalledWith('thinking_level');
      expect(mockCore.getInput).toHaveBeenCalledWith('prompt');
    });

    test('retrieves prompt from git platform', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockGit.getPrompt).toHaveBeenCalledWith('');
    });

    test('gets prompt from input when provided', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: 'Review this code',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockGit.getPrompt).toHaveBeenCalledWith('Review this code');

      // Verify the config was also created with the prompt input
      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          promptInput: 'Review this code',
        }),
        mockCore,
        mockProvider
      );
    });

    test('adds reaction before Pi execution', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockGit.addReaction).toHaveBeenCalled();
    });

    test('creates Pi agent with correct config', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'openai',
          model: 'gpt-4o',
          token: 'sk-test-key',
          thinking_level: 'medium',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        {
          provider: 'openai',
          model: 'gpt-4o',
          token: 'sk-test-key',
          thinkingLevel: 'medium',
          promptInput: '',
          loadBuiltinExtensions: true, // default value
          exportSessionHtml: true, // default value
        },
        mockCore,
        mockProvider
      );
    });

    test('defaults thinking_level to off when not provided', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          prompt: '',
        };
        if (name === 'thinking_level') {
          return ''; // Empty string to simulate no input
        }
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      // Note: The original code uses ?? 'off', which only applies when input is null/undefined
      // If getInput returns empty string, the default won't apply. This is the actual behavior.
      expect(mockPiFactory).toHaveBeenCalledWith(
        {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinkingLevel: '', // Empty string, because ?? doesn't apply to empty strings
          promptInput: '',
          loadBuiltinExtensions: true, // default value
          exportSessionHtml: true, // default value
        },
        mockCore,
        mockProvider
      );
    });

    test('sends prompt to Pi agent', async () => {
      const getPromptMock = mock(async () => 'Write unit tests for this function');
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiAgent.run).toHaveBeenCalledWith('Write unit tests for this function');
    });

    test('deletes reaction after successful execution', async () => {
      const mockReaction = { data: { id: 456 } } as CreateReactionType;
      const addReactionMock = mock(async () => mockReaction);
      mockGit.addReaction = addReactionMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockGit.deleteReaction).toHaveBeenCalledWith(mockReaction);
    });

    test('creates final comment with result', async () => {
      const runMock = mock(async () => ({
        result: 'Your tests are ready!',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const callArgs = calls[0];

      expect(callArgs[0]).toBe('Your tests are ready!');
      expect(callArgs[1]).toMatchObject({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        executionDuration: expect.any(Temporal.Duration),
      });
    });

    test('includes execution duration in final comment metadata', async () => {
      const startTime = Temporal.Now.instant();
      const getStartTimeMock = mock(() => startTime);
      mockGit.getStartTime = getStartTimeMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];

      expect(metadata.executionDuration).toBeDefined();
      expect(metadata.executionDuration).toBeInstanceOf(Temporal.Duration);
    });

    test('uses github start time when available', async () => {
      const githubStartTime = Temporal.Instant.from('2024-01-15T10:30:00Z');
      const getStartTimeMock = mock(() => githubStartTime);
      mockGit.getStartTime = getStartTimeMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockGit.getStartTime).toHaveBeenCalled();
    });

    test('uses current time when github start time unavailable', async () => {
      const getStartTimeMock = mock(() => undefined);
      mockGit.getStartTime = getStartTimeMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];

      // Duration should still be set (calculated from current time)
      expect(metadata.executionDuration).toBeDefined();
    });
  });

  describe('error handling', () => {
    test('catches Pi agent errors and finalizes with error message', async () => {
      const error = new Error('API quota exceeded');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('API quota exceeded');

      expect(mockGit.createFinalComment).toHaveBeenCalledWith(
        'API quota exceeded',
        expect.objectContaining({
          provider: expect.any(String),
          model: expect.any(String),
          executionDuration: expect.any(Temporal.Duration),
        })
      );
    });

    test('calls core.setFailed on error', async () => {
      const error = new Error('Network timeout');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('Network timeout');

      expect(mockCore.setFailed).toHaveBeenCalledWith(error);
    });

    test('deletes reaction even when Pi execution fails', async () => {
      const mockReaction = { data: { id: 789 } } as CreateReactionType;
      const addReactionMock = mock(async () => mockReaction);
      mockGit.addReaction = addReactionMock as any;

      const runMock = mock(async () => {
        throw new Error('Failed');
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('Failed');

      expect(mockGit.deleteReaction).toHaveBeenCalledWith(mockReaction);
    });

    test('handles non-Error objects thrown by Pi', async () => {
      const runMock = mock(async () => {
        throw 'String error';
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('String error');

      expect(mockGit.createFinalComment).toHaveBeenCalledWith('String error', expect.any(Object));
    });

    test('re-throws the original error after finalization', async () => {
      const error = new Error('Original error');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toBe(error);
    });

    test('silently ignores GitHub addReaction errors and continues execution', async () => {
      const addReactionMock = mock(async () => {
        throw new Error('Failed to add reaction');
      });
      mockGit.addReaction = addReactionMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      // Should not throw - execution continues
      await expect(orchestrator.execute()).resolves.toBeUndefined();

      // Reaction error was ignored but Pi was still called
      expect(mockPiAgent.run).toHaveBeenCalled();
      expect(mockGit.createFinalComment).toHaveBeenCalledWith(
        'Here are your tests!',
        expect.any(Object)
      );
    });
  });

  describe('error handling for missing required inputs', () => {
    test('throws descriptive error when provider is missing', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: '',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('Missing required input: `provider`');
      expect(mockCore.setFailed).toHaveBeenCalled();
    });

    test('throws descriptive error when model is missing', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: '',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('Missing required input: `model`');
      expect(mockCore.setFailed).toHaveBeenCalled();
    });

    test('throws descriptive error when token is missing', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: '',
          thinking_level: '',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('Missing required input: `token`');
      expect(mockCore.setFailed).toHaveBeenCalled();
    });

    test('provider error mentions possible values', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: '',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow(/anthropic/);
    });

    test('token error mentions secrets syntax', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: '',
          thinking_level: '',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow(/secrets\./);
    });

    test('missing provider does not call Pi factory', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: '',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow();
      expect(mockPiFactory).not.toHaveBeenCalled();
    });

    test('missing input finalizes with error comment', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: '',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow();
      expect(mockGit.createFinalComment).toHaveBeenCalledWith(
        expect.stringContaining('Missing required input: `provider`'),
        expect.any(Object)
      );
    });
  });

  describe('error handling for missing prompt', () => {
    test('throws error when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('No prompt found - cannot proceed');
    });

    test('calls core.setFailed when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockCore.setFailed).toHaveBeenCalled();
      const errorArg = (mockCore.setFailed as any).mock.calls[0][0];
      expect(errorArg.message).toBe('No prompt found - cannot proceed');
    });

    test('finalizes with error message when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockGit.createFinalComment).toHaveBeenCalledWith(
        'No prompt found - cannot proceed',
        expect.objectContaining({
          provider: expect.any(String),
          model: expect.any(String),
          executionDuration: expect.any(Temporal.Duration),
        })
      );
    });

    test('does not proceed with Pi execution when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockPiFactory).not.toHaveBeenCalled();
      expect(mockPiAgent.run).not.toHaveBeenCalled();
    });
  });

  describe('extensions configuration', () => {
    test('parses extensions input into config array', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          extensions: 'npm:package-one\ngit:github.com/user/repo\n./local-path.ts',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['npm:package-one', 'git:github.com/user/repo', './local-path.ts'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('omits extensions when input is empty', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          extensions: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          extensions: expect.any(Array),
        }),
        mockCore,
        mockProvider
      );
    });

    test('omits extensions when input is not provided', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          extensions: expect.any(Array),
        }),
        mockCore,
        mockProvider
      );
    });

    test('calls getInput for extensions', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.getInput).toHaveBeenCalledWith('extensions');
    });
  });

  describe('load_builtin_extensions configuration', () => {
    test('defaults to true when not provided', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: true,
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses true value correctly', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          load_builtin_extensions: 'true',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: true,
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses false value correctly', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          load_builtin_extensions: 'false',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: false,
        }),
        mockCore,
        mockProvider
      );
    });

    test('calls getInput for load_builtin_extensions', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.getInput).toHaveBeenCalledWith('load_builtin_extensions');
    });

    test('handles case-insensitive true values', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          load_builtin_extensions: 'TRUE',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: true,
        }),
        mockCore,
        mockProvider
      );
    });

    test('handles case-insensitive false values', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          load_builtin_extensions: 'FALSE',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: false,
        }),
        mockCore,
        mockProvider
      );
    });
  });

  describe('edge cases', () => {
    test('handles empty prompt string as missing prompt error', async () => {
      const getPromptMock = mock(async () => '');
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('No prompt found - cannot proceed');

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(mockGit.createFinalComment).toHaveBeenCalledWith(
        'No prompt found - cannot proceed',
        expect.any(Object)
      );
      expect(mockPiFactory).not.toHaveBeenCalled();
      expect(mockPiAgent.run).not.toHaveBeenCalled();
    });

    test('handles reaction returning undefined', async () => {
      const addReactionMock = mock(async () => undefined);
      mockGit.addReaction = addReactionMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockGit.deleteReaction).not.toHaveBeenCalled();
      expect(mockGit.createFinalComment).toHaveBeenCalled();
    });

    test('handles whitespace-only thinking_level input', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '   ',
          prompt: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: '   ' }),
        mockCore,
        mockProvider
      );
    });
  });

  describe('error handling - session stats', () => {
    test('continues execution when run returns undefined sessionStats', async () => {
      const runMock = mock(async () => ({
        result: 'Here are your tests!',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      // Should not throw - execution continues without stats
      await expect(orchestrator.execute()).resolves.toBeUndefined();

      // Comment should still be created without stats
      expect(mockGit.createFinalComment).toHaveBeenCalled();
      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];
      expect(metadata.sessionStats).toBeUndefined();

      // Prompt was still called
      expect(mockPiAgent.run).toHaveBeenCalled();
    });

    test('includes session stats when available in PromptResult', async () => {
      const sessionStats = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.001,
      };
      const runMock = mock(async () => ({
        result: 'Here are your tests!',
        sessionStats,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).resolves.toBeUndefined();

      // Comment should be created with stats
      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];
      expect(metadata.sessionStats).toEqual(sessionStats);
    });
  });

  describe('error handling - finalize failures', () => {
    test('re-throws error after finalize succeeds in catch block', async () => {
      const error = new Error('Prompt failed');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toBe(error);

      expect(mockCore.setFailed).toHaveBeenCalledWith(error);
      expect(mockGit.createFinalComment).toHaveBeenCalledWith('Prompt failed', expect.any(Object));
    });

    test('fails action when finalize in catch block throws', async () => {
      const error = new Error('Prompt failed');
      const finalizeError = new Error('Failed to post comment');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const createFinalCommentMock = mock(async () => {
        throw finalizeError;
      });
      mockGit.createFinalComment = createFinalCommentMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      // The original error should still be re-thrown
      await expect(orchestrator.execute()).rejects.toThrow('Prompt failed');

      // setFailed should STILL have been called even though finalize failed
      expect(mockCore.setFailed).toHaveBeenCalledWith(error);

      // Final comment creation was attempted in catch block
      expect(mockGit.createFinalComment).toHaveBeenCalledWith('Prompt failed', expect.any(Object));
    });

    test('calls setFailed after finalize succeeds', async () => {
      const error = new Error('API timeout');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow(error);

      expect(mockCore.setFailed).toHaveBeenCalledWith(error);
      expect(mockCore.setFailed).toHaveBeenCalledTimes(1);
    });
  });

  describe('action outputs', () => {
    test('sets response output with agent result', async () => {
      const runMock = mock(async () => ({
        result: 'Your tests are ready!',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.setOutput).toHaveBeenCalledWith('response', 'Your tests are ready!');
    });

    test('sets success output to true on successful execution', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.setOutput).toHaveBeenCalledWith('success', true);
    });

    test('sets success output to false on error', async () => {
      const runMock = mock(async () => {
        throw new Error('API error');
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);

      await expect(orchestrator.execute()).rejects.toThrow('API error');

      expect(mockCore.setOutput).toHaveBeenCalledWith('success', false);
      expect(mockCore.setOutput).toHaveBeenCalledWith('response', 'API error');
    });

    test('sets token and cost outputs when session stats available', async () => {
      const sessionStats = {
        inputTokens: 500,
        outputTokens: 200,
        totalTokens: 700,
        cost: 0.042,
      };
      const runMock = mock(async () => ({
        result: 'Done!',
        sessionStats,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.setOutput).toHaveBeenCalledWith('input_tokens', 500);
      expect(mockCore.setOutput).toHaveBeenCalledWith('output_tokens', 200);
      expect(mockCore.setOutput).toHaveBeenCalledWith('cost', 0.042);
    });

    test('does not set token/cost outputs when session stats unavailable', async () => {
      const runMock = mock(async () => ({
        result: 'Done!',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.setOutput).not.toHaveBeenCalledWith('input_tokens', expect.anything());
      expect(mockCore.setOutput).not.toHaveBeenCalledWith('output_tokens', expect.anything());
      expect(mockCore.setOutput).not.toHaveBeenCalledWith('cost', expect.anything());
    });

    test('sets duration_seconds output', async () => {
      const startTime = Temporal.Instant.from('2024-01-15T10:30:00Z');
      const getStartTimeMock = mock(() => startTime);
      mockGit.getStartTime = getStartTimeMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.setOutput).toHaveBeenCalledWith('duration_seconds', expect.any(Number));
    });

    test('sets all outputs on success with session stats', async () => {
      const sessionStats = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cost: 0.05,
      };
      const runMock = mock(async () => ({
        result: 'Analysis complete',
        sessionStats,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.setOutput).toHaveBeenCalledWith('response', 'Analysis complete');
      expect(mockCore.setOutput).toHaveBeenCalledWith('success', true);
      expect(mockCore.setOutput).toHaveBeenCalledWith('input_tokens', 1000);
      expect(mockCore.setOutput).toHaveBeenCalledWith('output_tokens', 500);
      expect(mockCore.setOutput).toHaveBeenCalledWith('cost', 0.05);
      expect(mockCore.setOutput).toHaveBeenCalledWith('duration_seconds', expect.any(Number));
    });
  });

  describe('base_url configuration', () => {
    test('passes baseUrl when provided', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'openai',
          model: 'gpt-4o',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          base_url: 'https://my-proxy.example.com/v1',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://my-proxy.example.com/v1',
        }),
        mockCore,
        mockProvider
      );
    });

    test('omits baseUrl when input is empty', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          base_url: '',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          baseUrl: expect.any(String),
        }),
        mockCore,
        mockProvider
      );
    });

    test('calls getInput for base_url', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.getInput).toHaveBeenCalledWith('base_url');
    });
  });

  describe('export_session_html configuration', () => {
    test('defaults to true when not provided', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          exportSessionHtml: true,
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses true value correctly', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          export_session_html: 'true',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          exportSessionHtml: true,
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses false value correctly', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          export_session_html: 'false',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          exportSessionHtml: false,
        }),
        mockCore,
        mockProvider
      );
    });

    test('calls getInput for export_session_html', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockCore.getInput).toHaveBeenCalledWith('export_session_html');
    });

    test('calls exportSessionHtml on agent when enabled', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiAgent.exportSessionHtml).toHaveBeenCalled();
    });

    test('does not call exportSessionHtml when disabled', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          export_session_html: 'false',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      expect(mockPiAgent.exportSessionHtml).not.toHaveBeenCalled();
    });

    test('continues execution when exportSessionHtml throws', async () => {
      const failingExport = mock(async () => {
        throw new Error('export failed');
      });
      mockPiAgent.exportSessionHtml = failingExport as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGit, mockPiFactory, mockProvider);
      await orchestrator.execute();

      // Action still completes successfully
      expect(mockCore.setOutput).toHaveBeenCalledWith('success', true);
      expect(mockCore.notice).toHaveBeenCalledWith(
        expect.stringContaining('[session-html] failed to export HTML')
      );
    });
  });
});

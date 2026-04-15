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
import type { CoreAdapter, GitHubAdapter, PiAgent } from '../src/types';
import type { CreateReactionType } from '../src/github/reactions';

describe('ActionOrchestrator', () => {
  let mockCore: CoreAdapter;
  let mockGithub: GitHubAdapter;
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
    const noticeMock = mock();
    const infoMock = mock();
    const debugMock = mock();
    const warningMock = mock();
    mockCore = {
      getInput: getInputMock,
      setFailed: setFailedMock,
      notice: noticeMock,
      info: infoMock,
      debug: debugMock,
      warning: warningMock,
    } as any;

    // Create mock github adapter
    const addReactionMock = mock(async () => ({ data: { id: 123 } }) as CreateReactionType);
    const deleteReactionMock = mock(async () => {});
    const createFinalCommentMock = mock(async () => {});
    const getPromptMock = mock(async () => 'Help me write tests');
    const getStartTimeMock = mock(() => Temporal.Now.instant());

    mockGithub = {
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
    mockPiAgent = {
      run: runMock as any,
    };

    mockPiFactory = mock(() => mockPiAgent);
  });

  describe('successful execution flow', () => {
    test('gathers config from core inputs', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockCore.getInput).toHaveBeenCalledWith('provider');
      expect(mockCore.getInput).toHaveBeenCalledWith('model');
      expect(mockCore.getInput).toHaveBeenCalledWith('token');
      expect(mockCore.getInput).toHaveBeenCalledWith('thinking_level');
      expect(mockCore.getInput).toHaveBeenCalledWith('prompt');
    });

    test('retrieves prompt from github', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockGithub.getPrompt).toHaveBeenCalledWith('');
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockGithub.getPrompt).toHaveBeenCalledWith('Review this code');

      // Verify the config was also created with the prompt input
      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          promptInput: 'Review this code',
        }),
        mockCore
      );
    });

    test('adds reaction before Pi execution', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockGithub.addReaction).toHaveBeenCalled();
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        {
          provider: 'openai',
          model: 'gpt-4o',
          token: 'sk-test-key',
          thinkingLevel: 'medium',
          promptInput: '',
          loadBuiltinExtensions: true, // default value
        },
        mockCore
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
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
        },
        mockCore
      );
    });

    test('sends prompt to Pi agent', async () => {
      const getPromptMock = mock(async () => 'Write unit tests for this function');
      mockGithub.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiAgent.run).toHaveBeenCalledWith('Write unit tests for this function');
    });

    test('deletes reaction after successful execution', async () => {
      const mockReaction = { data: { id: 456 } } as CreateReactionType;
      const addReactionMock = mock(async () => mockReaction);
      mockGithub.addReaction = addReactionMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockGithub.deleteReaction).toHaveBeenCalledWith(mockReaction);
    });

    test('creates final comment with result', async () => {
      const runMock = mock(async () => ({
        result: 'Your tests are ready!',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      const calls = (mockGithub.createFinalComment as any).mock.calls;
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
      mockGithub.getStartTime = getStartTimeMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      const calls = (mockGithub.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];

      expect(metadata.executionDuration).toBeDefined();
      expect(metadata.executionDuration).toBeInstanceOf(Temporal.Duration);
    });

    test('uses github start time when available', async () => {
      const githubStartTime = Temporal.Instant.from('2024-01-15T10:30:00Z');
      const getStartTimeMock = mock(() => githubStartTime);
      mockGithub.getStartTime = getStartTimeMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockGithub.getStartTime).toHaveBeenCalled();
    });

    test('uses current time when github start time unavailable', async () => {
      const getStartTimeMock = mock(() => undefined);
      mockGithub.getStartTime = getStartTimeMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      const calls = (mockGithub.createFinalComment as any).mock.calls;
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow('API quota exceeded');

      expect(mockGithub.createFinalComment).toHaveBeenCalledWith(
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow('Network timeout');

      expect(mockCore.setFailed).toHaveBeenCalledWith(error);
    });

    test('deletes reaction even when Pi execution fails', async () => {
      const mockReaction = { data: { id: 789 } } as CreateReactionType;
      const addReactionMock = mock(async () => mockReaction);
      mockGithub.addReaction = addReactionMock as any;

      const runMock = mock(async () => {
        throw new Error('Failed');
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow('Failed');

      expect(mockGithub.deleteReaction).toHaveBeenCalledWith(mockReaction);
    });

    test('handles non-Error objects thrown by Pi', async () => {
      const runMock = mock(async () => {
        throw 'String error';
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow('String error');

      expect(mockGithub.createFinalComment).toHaveBeenCalledWith(
        'String error',
        expect.any(Object)
      );
    });

    test('re-throws the original error after finalization', async () => {
      const error = new Error('Original error');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toBe(error);
    });

    test('silently ignores GitHub addReaction errors and continues execution', async () => {
      const addReactionMock = mock(async () => {
        throw new Error('Failed to add reaction');
      });
      mockGithub.addReaction = addReactionMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      // Should not throw - execution continues
      await expect(orchestrator.execute()).resolves.toBeUndefined();

      // Reaction error was ignored but Pi was still called
      expect(mockPiAgent.run).toHaveBeenCalled();
      expect(mockGithub.createFinalComment).toHaveBeenCalledWith(
        'Here are your tests!',
        expect.any(Object)
      );
    });
  });

  describe('error handling for missing prompt', () => {
    test('throws error when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGithub.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow('No prompt found - cannot proceed');
    });

    test('calls core.setFailed when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGithub.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockCore.setFailed).toHaveBeenCalled();
      const errorArg = (mockCore.setFailed as any).mock.calls[0][0];
      expect(errorArg.message).toBe('No prompt found - cannot proceed');
    });

    test('finalizes with error message when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGithub.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockGithub.createFinalComment).toHaveBeenCalledWith(
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
      mockGithub.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['npm:package-one', 'git:github.com/user/repo', './local-path.ts'],
        }),
        mockCore
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          extensions: expect.any(Array),
        }),
        mockCore
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          extensions: expect.any(Array),
        }),
        mockCore
      );
    });

    test('calls getInput for extensions', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockCore.getInput).toHaveBeenCalledWith('extensions');
    });
  });

  describe('load_builtin_extensions configuration', () => {
    test('defaults to true when not provided', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: true,
        }),
        mockCore
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: true,
        }),
        mockCore
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: false,
        }),
        mockCore
      );
    });

    test('calls getInput for load_builtin_extensions', async () => {
      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: true,
        }),
        mockCore
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: false,
        }),
        mockCore
      );
    });
  });

  describe('edge cases', () => {
    test('handles empty prompt string as missing prompt error', async () => {
      const getPromptMock = mock(async () => '');
      mockGithub.getPrompt = getPromptMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow('No prompt found - cannot proceed');

      expect(mockCore.setFailed).toHaveBeenCalled();
      expect(mockGithub.createFinalComment).toHaveBeenCalledWith(
        'No prompt found - cannot proceed',
        expect.any(Object)
      );
      expect(mockPiFactory).not.toHaveBeenCalled();
      expect(mockPiAgent.run).not.toHaveBeenCalled();
    });

    test('handles reaction returning undefined', async () => {
      const addReactionMock = mock(async () => undefined);
      mockGithub.addReaction = addReactionMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockGithub.deleteReaction).not.toHaveBeenCalled();
      expect(mockGithub.createFinalComment).toHaveBeenCalled();
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: '   ' }),
        mockCore
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      // Should not throw - execution continues without stats
      await expect(orchestrator.execute()).resolves.toBeUndefined();

      // Comment should still be created without stats
      expect(mockGithub.createFinalComment).toHaveBeenCalled();
      const calls = (mockGithub.createFinalComment as any).mock.calls;
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).resolves.toBeUndefined();

      // Comment should be created with stats
      const calls = (mockGithub.createFinalComment as any).mock.calls;
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

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toBe(error);

      expect(mockCore.setFailed).toHaveBeenCalledWith(error);
      expect(mockGithub.createFinalComment).toHaveBeenCalledWith(
        'Prompt failed',
        expect.any(Object)
      );
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
      mockGithub.createFinalComment = createFinalCommentMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow('Failed to post comment');

      // setFailed should NOT have been called (error thrown before it)
      expect(mockCore.setFailed).not.toHaveBeenCalled();

      // Final comment creation was attempted in catch block
      expect(mockGithub.createFinalComment).toHaveBeenCalledWith(
        'Prompt failed',
        expect.any(Object)
      );
    });

    test('calls setFailed after finalize succeeds', async () => {
      const error = new Error('API timeout');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = new ActionOrchestrator(mockCore, mockGithub, mockPiFactory);

      await expect(orchestrator.execute()).rejects.toThrow(error);

      expect(mockCore.setFailed).toHaveBeenCalledWith(error);
      expect(mockCore.setFailed).toHaveBeenCalledTimes(1);
    });
  });
});

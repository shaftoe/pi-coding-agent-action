/**
 * Tests for ActionOrchestrator business logic.
 *
 * Tests the orchestration flow (configuration gathering, prompt retrieval,
 * reaction lifecycle, Pi execution, finalization) without mocking the
 * underlying implementations. These tests verify the behavior of the
 * action itself.
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { Temporal } from '@js-temporal/polyfill';
import { ActionOrchestrator } from '@alexanderfortin/pi-orchestrator';
import type {
  CoreAdapter,
  GitAdapter,
  PiAgent,
  Logger,
  OutputSink,
  PiConfig,
} from '@alexanderfortin/pi-orchestrator';
import type { CreateReactionType, PlatformProvider } from '@alexanderfortin/pi-orchestrator';

describe('ActionOrchestrator', () => {
  let mockCore: CoreAdapter;
  let mockGit: GitAdapter;
  let mockProvider: PlatformProvider;
  let mockPiAgent: PiAgent;
  let mockPiFactory: ReturnType<typeof mock>;
  let mockOutputSink: OutputSink;
  let defaultConfig: PiConfig;

  /**
   * Helper to create an orchestrator with the default config and mocks.
   * Config overrides are merged onto the default config.
   */
  function createOrchestrator(configOverrides?: Partial<PiConfig>) {
    const config = { ...defaultConfig, ...configOverrides };
    return new ActionOrchestrator(
      config,
      mockCore as unknown as Logger,
      mockOutputSink,
      mockGit,
      mockPiFactory,
      mockProvider
    );
  }

  beforeEach(() => {
    // Create mock core adapter (used as Logger)
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
    const errorMock = mock();
    mockCore = {
      getInput: getInputMock,
      setFailed: setFailedMock,
      setOutput: setOutputMock,
      notice: noticeMock,
      info: infoMock,
      debug: debugMock,
      warning: warningMock,
      error: errorMock,
    } as any;

    // Default config (matches what gatherActionsConfig produces with default inputs)
    defaultConfig = {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      token: 'test-token',
      thinkingLevel: '',
      promptInput: '',
      loadBuiltinExtensions: true,
      exportSessionHtml: true,
      exportSessionJsonl: false,
      autoCompaction: false,
    };

    // Create mock output sink
    mockOutputSink = {
      setOutput: mock() as any,
      setFailed: mock() as any,
      getExportDirectory: mock(
        (format: 'html' | 'jsonl') => `/tmp/pi-session-${format}-test`
      ) as any,
    };

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
    const exportSessionJsonlMock = mock(async (outputPath: string) => outputPath);
    mockPiAgent = {
      run: runMock as any,
      exportSessionHtml: exportSessionHtmlMock as any,
      exportSessionJsonl: exportSessionJsonlMock as any,
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
    test('forwards config to Pi agent factory', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
        }),
        mockCore,
        mockProvider
      );
    });

    test('retrieves prompt from git platform', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockGit.getPrompt).toHaveBeenCalledWith('');
    });

    test('gets prompt from config promptInput', async () => {
      const orchestrator = createOrchestrator({ promptInput: 'Review this code' });
      await orchestrator.execute();

      expect(mockGit.getPrompt).toHaveBeenCalledWith('Review this code');

      // Verify the config was forwarded with the prompt input
      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          promptInput: 'Review this code',
        }),
        mockCore,
        mockProvider
      );
    });

    test('adds reaction before Pi execution', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockGit.addReaction).toHaveBeenCalled();
    });

    test('creates Pi agent with correct config', async () => {
      const orchestrator = createOrchestrator({
        provider: 'openai',
        model: 'gpt-4o',
        token: 'sk-test-key',
        thinkingLevel: 'medium',
      });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        {
          provider: 'openai',
          model: 'gpt-4o',
          token: 'sk-test-key',
          thinkingLevel: 'medium',
          promptInput: '',
          loadBuiltinExtensions: true,
          exportSessionHtml: true,
          exportSessionJsonl: false,
          autoCompaction: false,
        },
        mockCore,
        mockProvider
      );
    });

    test('uses thinkingLevel from config', async () => {
      const orchestrator = createOrchestrator({ thinkingLevel: '' });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: '' }),
        mockCore,
        mockProvider
      );
    });

    test('sends prompt to Pi agent', async () => {
      const getPromptMock = mock(async () => 'Write unit tests for this function');
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiAgent.run).toHaveBeenCalledWith('Write unit tests for this function');
    });

    test('deletes reaction after successful execution', async () => {
      const mockReaction = { data: { id: 456 } } as CreateReactionType;
      const addReactionMock = mock(async () => mockReaction);
      mockGit.addReaction = addReactionMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockGit.deleteReaction).toHaveBeenCalledWith(mockReaction);
    });

    test('logs agent session completed banner after successful run', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockCore.info).toHaveBeenCalledWith('✅ Agent session completed');
    });

    test('does not log agent session completed banner when run throws', async () => {
      const runMock = mock(async () => {
        throw new Error('API error');
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('API error');

      // The completion banner should NOT have been logged
      const infoCalls = (mockCore.info as any).mock.calls.map((c: string[]) => c[0]);
      expect(infoCalls).not.toContain('✅ Agent session completed');
    });

    test('creates final comment with result', async () => {
      const runMock = mock(async () => ({
        result: 'Your tests are ready!',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();
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

    test('posts default completion comment when agent returns empty result', async () => {
      const runMock = mock(async () => ({
        result: '',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      // Should always post a comment even when result is empty
      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toBe('✅ Agent session completed');
    });

    test('logs completion banner after session html export', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      const bannerIndex = infoCalls.indexOf('✅ Agent session completed');
      const htmlExportCalls = infoCalls.filter((c: string) => c.includes('[session-html]'));

      // The completion banner should appear after the HTML export log
      if (htmlExportCalls.length > 0) {
        const htmlExportIndex = infoCalls.findIndex((c: string) => c.includes('[session-html]'));
        expect(bannerIndex).toBeGreaterThan(htmlExportIndex);
      }
    });

    test('includes execution duration in final comment metadata', async () => {
      const startTime = Temporal.Now.instant();
      const getStartTimeMock = mock(() => startTime);
      mockGit.getStartTime = getStartTimeMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];

      expect(metadata.executionDuration).toBeDefined();
      expect(metadata.executionDuration).toBeInstanceOf(Temporal.Duration);
    });

    test('includes actionVersion in final comment metadata', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];

      expect(metadata.actionVersion).toBeDefined();
      expect(typeof metadata.actionVersion).toBe('string');
      expect(metadata.actionVersion).not.toBe('unknown');
      expect(metadata.actionVersion).toMatch(/^\d+\.\d+\.\d+/);
    });

    test('includes version in sessionStats when stats are available', async () => {
      const sessionStats = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.001,
        version: '0.99.0-test',
      };
      const runMock = mock(async () => ({
        result: 'Done!',
        sessionStats,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];

      expect(metadata.sessionStats).toBeDefined();
      expect(metadata.sessionStats.version).toBe('0.99.0-test');
    });

    test('uses github start time when available', async () => {
      const githubStartTime = Temporal.Instant.from('2024-01-15T10:30:00Z');
      const getStartTimeMock = mock(() => githubStartTime);
      mockGit.getStartTime = getStartTimeMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockGit.getStartTime).toHaveBeenCalled();
    });

    test('uses current time when github start time unavailable', async () => {
      const getStartTimeMock = mock(() => undefined);
      mockGit.getStartTime = getStartTimeMock as any;

      const orchestrator = createOrchestrator();
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

      const orchestrator = createOrchestrator();

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

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('Network timeout');

      expect(mockOutputSink.setFailed).toHaveBeenCalledWith(error);
    });

    test('deletes reaction even when Pi execution fails', async () => {
      const mockReaction = { data: { id: 789 } } as CreateReactionType;
      const addReactionMock = mock(async () => mockReaction);
      mockGit.addReaction = addReactionMock as any;

      const runMock = mock(async () => {
        throw new Error('Failed');
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('Failed');

      expect(mockGit.deleteReaction).toHaveBeenCalledWith(mockReaction);
    });

    test('handles non-Error objects thrown by Pi', async () => {
      const runMock = mock(async () => {
        throw 'String error';
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('String error');

      expect(mockGit.createFinalComment).toHaveBeenCalledWith('String error', expect.any(Object));
    });

    test('re-throws the original error after finalization', async () => {
      const error = new Error('Original error');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toBe(error);
    });

    test('silently ignores GitHub addReaction errors and continues execution', async () => {
      const addReactionMock = mock(async () => {
        throw new Error('Failed to add reaction');
      });
      mockGit.addReaction = addReactionMock as any;

      const orchestrator = createOrchestrator();

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

  describe('config forwarding', () => {
    test('allows empty token for provider-side auth (e.g. ADC)', async () => {
      mockGit.getPrompt = mock(async () => 'Hello');
      const orchestrator = createOrchestrator({ token: '', promptInput: 'Hello' });
      await orchestrator.execute();
      expect(mockPiFactory).toHaveBeenCalled();
    });
  });

  describe('error handling for missing prompt', () => {
    test('throws error when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('No prompt found - cannot proceed');
    });

    test('calls core.setFailed when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockOutputSink.setFailed).toHaveBeenCalled();
      const errorArg = (mockOutputSink.setFailed as any).mock.calls[0][0];
      expect(errorArg.message).toBe('No prompt found - cannot proceed');
    });

    test('finalizes with error message when no prompt found', async () => {
      const getPromptMock = mock(async () => undefined);
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = createOrchestrator();

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

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockPiFactory).not.toHaveBeenCalled();
      expect(mockPiAgent.run).not.toHaveBeenCalled();
    });
  });

  describe('extensions configuration', () => {
    test('passes extensions config to Pi agent factory', async () => {
      const orchestrator = createOrchestrator({
        extensions: ['npm:package-one', 'git:github.com/user/repo', './local-path.ts'],
      });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          extensions: ['npm:package-one', 'git:github.com/user/repo', './local-path.ts'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('omits extensions when not in config', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          extensions: expect.any(Array),
        }),
        mockCore,
        mockProvider
      );
    });
  });

  describe('load_builtin_extensions configuration', () => {
    test('defaults to true when not provided', async () => {
      const orchestrator = createOrchestrator();
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
      const orchestrator = createOrchestrator({
        loadBuiltinExtensions: true,
      });
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
      const orchestrator = createOrchestrator({
        loadBuiltinExtensions: false,
      });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadBuiltinExtensions: false,
        }),
        mockCore,
        mockProvider
      );
    });

    test('handles case-insensitive true values', async () => {
      const orchestrator = createOrchestrator({
        loadBuiltinExtensions: true,
      });
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
      const orchestrator = createOrchestrator({
        loadBuiltinExtensions: false,
      });
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

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('No prompt found - cannot proceed');

      expect(mockOutputSink.setFailed).toHaveBeenCalled();
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

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockGit.deleteReaction).not.toHaveBeenCalled();
      expect(mockGit.createFinalComment).toHaveBeenCalled();
    });

    test('handles whitespace-only thinking_level input', async () => {
      const orchestrator = createOrchestrator({ thinkingLevel: '   ' });
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

      const orchestrator = createOrchestrator();

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
        version: '2.18.0',
      };
      const runMock = mock(async () => ({
        result: 'Here are your tests!',
        sessionStats,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).resolves.toBeUndefined();

      // Comment should be created with stats
      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];
      expect(metadata.sessionStats).toEqual(sessionStats);
    });

    test('passes actionVersion through metadata to createFinalComment', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const calls = (mockGit.createFinalComment as any).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const metadata = calls[0][1];

      // actionVersion should be a non-empty, non-unknown version string
      expect(metadata.actionVersion).toBeDefined();
      expect(metadata.actionVersion).not.toBe('unknown');
      expect(typeof metadata.actionVersion).toBe('string');
    });
  });

  describe('error handling - finalize failures', () => {
    test('re-throws error after finalize succeeds in catch block', async () => {
      const error = new Error('Prompt failed');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toBe(error);

      expect(mockOutputSink.setFailed).toHaveBeenCalledWith(error);
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

      const orchestrator = createOrchestrator();

      // The original error should still be re-thrown
      await expect(orchestrator.execute()).rejects.toThrow('Prompt failed');

      // setFailed should STILL have been called even though finalize failed
      expect(mockOutputSink.setFailed).toHaveBeenCalledWith(error);

      // Final comment creation was attempted in catch block
      expect(mockGit.createFinalComment).toHaveBeenCalledWith('Prompt failed', expect.any(Object));
    });

    test('calls setFailed after finalize succeeds', async () => {
      const error = new Error('API timeout');
      const runMock = mock(async () => {
        throw error;
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow(error);

      expect(mockOutputSink.setFailed).toHaveBeenCalledWith(error);
      expect(mockOutputSink.setFailed).toHaveBeenCalledTimes(1);
    });
  });

  describe('action outputs', () => {
    test('sets response output with agent result', async () => {
      const runMock = mock(async () => ({
        result: 'Your tests are ready!',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('response', 'Your tests are ready!');
    });

    test('sets success output to true on successful execution', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('success', true);
    });

    test('sets success output to false on error', async () => {
      const runMock = mock(async () => {
        throw new Error('API error');
      });
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('API error');

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('success', false);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('response', 'API error');
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

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('input_tokens', 500);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('output_tokens', 200);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('cost', 0.042);
    });

    test('does not set token/cost outputs when session stats unavailable', async () => {
      const runMock = mock(async () => ({
        result: 'Done!',
        sessionStats: undefined,
      }));
      mockPiAgent.run = runMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('input_tokens', expect.anything());
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('output_tokens', expect.anything());
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('cost', expect.anything());
    });

    test('sets duration_seconds output', async () => {
      const startTime = Temporal.Instant.from('2024-01-15T10:30:00Z');
      const getStartTimeMock = mock(() => startTime);
      mockGit.getStartTime = getStartTimeMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('duration_seconds', expect.any(Number));
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

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('response', 'Analysis complete');
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('success', true);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('input_tokens', 1000);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('output_tokens', 500);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('cost', 0.05);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('duration_seconds', expect.any(Number));
    });
  });

  describe('base_url configuration', () => {
    test('passes baseUrl when provided', async () => {
      const orchestrator = createOrchestrator({
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: 'https://my-proxy.example.com/v1',
      });
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
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.not.objectContaining({
          baseUrl: expect.any(String),
        }),
        mockCore,
        mockProvider
      );
    });
  });

  describe('export_session_html configuration', () => {
    test('defaults to true when not provided', async () => {
      const orchestrator = createOrchestrator();
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
      const orchestrator = createOrchestrator({ exportSessionHtml: true });
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
      const orchestrator = createOrchestrator({ exportSessionHtml: false });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          exportSessionHtml: false,
        }),
        mockCore,
        mockProvider
      );
    });

    test('calls exportSessionHtml on agent when enabled', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiAgent.exportSessionHtml).toHaveBeenCalled();
    });

    test('does not call exportSessionHtml when disabled', async () => {
      const orchestrator = createOrchestrator({ exportSessionHtml: false });
      await orchestrator.execute();

      expect(mockPiAgent.exportSessionHtml).not.toHaveBeenCalled();
    });

    test('continues execution when exportSessionHtml throws', async () => {
      const failingExport = mock(async () => {
        throw new Error('export failed');
      });
      mockPiAgent.exportSessionHtml = failingExport as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      // Action still completes successfully
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('success', true);
      expect(mockCore.notice).toHaveBeenCalledWith(
        expect.stringContaining('[session-html] failed to export HTML')
      );
    });
  });

  describe('diff configuration', () => {
    test('passes diff config to Pi agent factory', async () => {
      const orchestrator = createOrchestrator({
        diffMaxLines: 500,
        diffMaxBytes: 204800,
        diffIgnorePatterns: ['dist/'],
      });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          diffMaxLines: 500,
          diffMaxBytes: 204800,
          diffIgnorePatterns: ['dist/'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('passes diffMaxLines when provided', async () => {
      const orchestrator = createOrchestrator({ diffMaxLines: 500 });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          diffMaxLines: 500,
        }),
        mockCore,
        mockProvider
      );
    });

    test('passes diffMaxBytes when provided', async () => {
      const orchestrator = createOrchestrator({ diffMaxBytes: 204800 });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          diffMaxBytes: 204800,
        }),
        mockCore,
        mockProvider
      );
    });

    test('passes diffIgnorePatterns when provided', async () => {
      const orchestrator = createOrchestrator({
        diffIgnorePatterns: ['dist/', 'package-lock.json', 'yarn.lock'],
      });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          diffIgnorePatterns: ['dist/', 'package-lock.json', 'yarn.lock'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('omits diff config when inputs are empty', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.diffMaxLines).toBeUndefined();
      expect(callArgs.diffMaxBytes).toBeUndefined();
      expect(callArgs.diffIgnorePatterns).toBeUndefined();
    });

    test('ignores non-numeric diff_max_lines input', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.diffMaxLines).toBeUndefined();
    });

    test('ignores negative diff_max_lines input', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.diffMaxLines).toBeUndefined();
    });

    test('ignores negative diff_max_bytes input', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.diffMaxBytes).toBeUndefined();
    });

    test('ignores zero diff_max_lines input', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.diffMaxLines).toBeUndefined();
    });
  });

  describe('loaded_tools configuration', () => {
    test('defaults to undefined when not provided (all tools)', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.loadedTools).toBeUndefined();
    });

    test('defaults to undefined when input is empty string', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.loadedTools).toBeUndefined();
    });

    test('defaults to undefined when input is "all"', async () => {
      const getInputMock = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          token: 'test-token',
          thinking_level: '',
          prompt: '',
          loaded_tools: 'all',
        };
        return inputs[name];
      });
      mockCore.getInput = getInputMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.loadedTools).toBeUndefined();
    });

    test('defaults to undefined when input is "ALL" (case insensitive)', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.loadedTools).toBeUndefined();
    });

    test('parses single tool name', async () => {
      const orchestrator = createOrchestrator({ loadedTools: ['get_pr_diff'] });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadedTools: ['get_pr_diff'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses comma-separated tool names', async () => {
      const orchestrator = createOrchestrator({
        loadedTools: ['get_pr_diff', 'create_pull_request_review'],
      });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadedTools: ['get_pr_diff', 'create_pull_request_review'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('trims whitespace around tool names', async () => {
      const orchestrator = createOrchestrator({
        loadedTools: ['get_pr_diff', 'create_pull_request_review', 'read'],
      });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadedTools: ['get_pr_diff', 'create_pull_request_review', 'read'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('filters out empty items from trailing commas', async () => {
      const orchestrator = createOrchestrator({
        loadedTools: ['get_pr_diff', 'create_pull_request_review'],
      });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadedTools: ['get_pr_diff', 'create_pull_request_review'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('deduplicates duplicate tool names', async () => {
      const orchestrator = createOrchestrator({ loadedTools: ['read', 'write'] });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          loadedTools: ['read', 'write'],
        }),
        mockCore,
        mockProvider
      );
    });

    test('handles whitespace-only input as undefined', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.loadedTools).toBeUndefined();
    });
  });

  describe('export_session_jsonl configuration', () => {
    test('defaults to false when not provided', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          exportSessionJsonl: false,
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses true value correctly', async () => {
      const orchestrator = createOrchestrator({ exportSessionJsonl: true });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          exportSessionJsonl: true,
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses false value correctly', async () => {
      const orchestrator = createOrchestrator({ exportSessionJsonl: false });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          exportSessionJsonl: false,
        }),
        mockCore,
        mockProvider
      );
    });

    test('calls exportSessionJsonl on agent when enabled', async () => {
      const orchestrator = createOrchestrator({ exportSessionJsonl: true });
      await orchestrator.execute();

      expect(mockPiAgent.exportSessionJsonl).toHaveBeenCalled();
    });

    test('does not call exportSessionJsonl when disabled', async () => {
      const orchestrator = createOrchestrator({ exportSessionJsonl: false });
      await orchestrator.execute();

      expect(mockPiAgent.exportSessionJsonl).not.toHaveBeenCalled();
    });

    test('continues execution when exportSessionJsonl throws', async () => {
      const failingExport = mock(async () => {
        throw new Error('jsonl export failed');
      });
      mockPiAgent.exportSessionJsonl = failingExport as any;

      const orchestrator = createOrchestrator({ exportSessionJsonl: true });
      await orchestrator.execute();

      // Action still completes successfully
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('success', true);
      expect(mockCore.notice).toHaveBeenCalledWith(
        expect.stringContaining('[session-jsonl] failed to export JSONL')
      );
    });

    test('sets session_jsonl_path output when export succeeds', async () => {
      const orchestrator = createOrchestrator({ exportSessionJsonl: true });
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith(
        'session_jsonl_path',
        expect.stringContaining('session.jsonl')
      );
    });
  });

  describe('auto_compaction configuration', () => {
    test('defaults to false when not provided', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          autoCompaction: false,
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses true value correctly', async () => {
      const orchestrator = createOrchestrator({ autoCompaction: true });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          autoCompaction: true,
        }),
        mockCore,
        mockProvider
      );
    });

    test('parses false value correctly', async () => {
      const orchestrator = createOrchestrator({ autoCompaction: false });
      await orchestrator.execute();

      expect(mockPiFactory).toHaveBeenCalledWith(
        expect.objectContaining({
          autoCompaction: false,
        }),
        mockCore,
        mockProvider
      );
    });
  });
});

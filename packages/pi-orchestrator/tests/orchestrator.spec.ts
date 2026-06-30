/**
 * Tests for ActionOrchestrator business logic.
 *
 * Tests the orchestration flow (configuration gathering, prompt retrieval,
 * reaction lifecycle, Pi execution, finalization) without mocking the
 * underlying implementations. These tests verify the behavior of the
 * action itself.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { Temporal } from '@js-temporal/polyfill';
import * as fs from 'node:fs';
import * as path from 'node:path';
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
import {
  setAgentRunResult,
  setAgentRunError,
  setAgentGetSessionStats,
  setAddReactionReturn,
  getFinalCommentCall,
  expectFactoryCalledWith,
} from './orchestrator/helpers';

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
      appendSummary: mock(async () => {}) as any,
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
      error: undefined,
    }));
    const exportSessionHtmlMock = mock(async (outputPath: string) => outputPath);
    const exportSessionJsonlMock = mock(async (outputPath: string) => outputPath);
    const getSessionStatsMock = mock(() => undefined);
    mockPiAgent = {
      run: runMock as any,
      getSessionStats: getSessionStatsMock as any,
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

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        token: 'test-token',
      });
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
      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        promptInput: 'Review this code',
      });
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

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        thinkingLevel: '',
      });
    });

    test('sends prompt to Pi agent', async () => {
      const getPromptMock = mock(async () => 'Write unit tests for this function');
      mockGit.getPrompt = getPromptMock as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiAgent.run).toHaveBeenCalledWith('Write unit tests for this function');
    });

    test('deletes reaction after successful execution', async () => {
      const mockReaction = setAddReactionReturn(mockGit, 456);

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
      setAgentRunError(mockPiAgent, new Error('API error'));

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('API error');

      // The completion banner should NOT have been logged
      const infoCalls = (mockCore.info as any).mock.calls.map((c: string[]) => c[0]);
      expect(infoCalls).not.toContain('✅ Agent session completed');
    });

    test('creates final comment with result', async () => {
      setAgentRunResult(mockPiAgent, { result: 'Your tests are ready!' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const [text, metadata] = getFinalCommentCall(mockGit);
      expect(text).toBe('Your tests are ready!');
      expect(metadata).toMatchObject({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        executionDuration: expect.any(Temporal.Duration),
      });
    });

    test('posts default completion comment when agent returns empty result', async () => {
      setAgentRunResult(mockPiAgent, { result: '' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      // Should always post a comment even when result is empty
      const [text] = getFinalCommentCall(mockGit);
      expect(text).toBe('✅ Agent session completed');
    });

    test('logs session html export path in summary block after banner', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      const bannerIndex = infoCalls.indexOf('✅ Agent session completed');
      const htmlExportIndex = infoCalls.findIndex((c: string) =>
        c.includes('📄 exported session HTML')
      );

      // The export path summary should appear after the banner (deferred
      // to the summary block, not logged mid-stream during the export).
      expect(bannerIndex).toBeGreaterThanOrEqual(0);
      expect(htmlExportIndex).toBeGreaterThan(bannerIndex);
      // The mid-stream [session-html] log is now at debug level, not info.
      const staleInfoLogs = infoCalls.filter((c: string) => c.includes('[session-html]'));
      expect(staleInfoLogs).toHaveLength(0);
    });

    test('includes execution duration in final comment metadata', async () => {
      const startTime = Temporal.Now.instant();
      mockGit.getStartTime = mock(() => startTime) as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const [, metadata] = getFinalCommentCall(mockGit);
      expect(metadata.executionDuration).toBeDefined();
      expect(metadata.executionDuration).toBeInstanceOf(Temporal.Duration);
    });

    test('includes actionVersion in final comment metadata', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const [, metadata] = getFinalCommentCall(mockGit);
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
      setAgentRunResult(mockPiAgent, { result: 'Done!', sessionStats });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const [, metadata] = getFinalCommentCall(mockGit);
      expect(metadata.sessionStats).toBeDefined();
      expect((metadata.sessionStats as { version: string }).version).toBe('0.99.0-test');
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
      mockGit.getStartTime = mock(() => undefined) as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const [, metadata] = getFinalCommentCall(mockGit);
      // Duration should still be set (calculated from current time)
      expect(metadata.executionDuration).toBeDefined();
    });
  });

  describe('error handling', () => {
    test('catches Pi agent errors and finalizes with error message', async () => {
      const error = new Error('API quota exceeded');
      setAgentRunError(mockPiAgent, error);

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
      setAgentRunError(mockPiAgent, error);

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('Network timeout');

      expect(mockOutputSink.setFailed).toHaveBeenCalledWith(error);
    });

    test('deletes reaction even when Pi execution fails', async () => {
      const mockReaction = setAddReactionReturn(mockGit, 789);
      setAgentRunError(mockPiAgent, new Error('Failed'));

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('Failed');

      expect(mockGit.deleteReaction).toHaveBeenCalledWith(mockReaction);
    });

    test('handles non-Error objects thrown by Pi', async () => {
      setAgentRunError(mockPiAgent, 'String error');

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('String error');

      expect(mockGit.createFinalComment).toHaveBeenCalledWith('String error', expect.any(Object));
    });

    test('re-throws the original error after finalization', async () => {
      const error = new Error('Original error');
      setAgentRunError(mockPiAgent, error);

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toBe(error);
    });

    test('silently ignores GitHub addReaction errors and continues execution', async () => {
      mockGit.addReaction = mock(async () => {
        throw new Error('Failed to add reaction');
      }) as any;

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

  describe('session-level error handling (PromptResult.error)', () => {
    test('posts error comment when session ends with quota error', async () => {
      const sessionError =
        '429 Usage limit reached for 5 hour. Your limit will reset at 2026-06-02 19:05:44';
      setAgentRunResult(mockPiAgent, { error: sessionError });

      const orchestrator = createOrchestrator();

      // Should NOT throw — the error is reported via the result, not via exception
      await expect(orchestrator.execute()).resolves.toBeUndefined();

      const [text] = getFinalCommentCall(mockGit);
      expect(text).toBe(`❌ Agent session ended with error: ${sessionError}`);
    });

    test('marks action as failed when session ends with error', async () => {
      setAgentRunResult(mockPiAgent, { error: '429 Usage limit reached' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setFailed).toHaveBeenCalledWith(
        expect.objectContaining({ message: '429 Usage limit reached' })
      );
    });

    test('sets success output to false when session ends with error', async () => {
      setAgentRunResult(mockPiAgent, { error: 'insufficient_quota' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('success', false);
    });

    test('does not log success banner when session ends with error', async () => {
      setAgentRunResult(mockPiAgent, { error: 'quota exceeded' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls).not.toContain('✅ Agent session completed');
      expect(infoCalls).toContain('❌ Agent session ended with error: quota exceeded');
    });

    test('includes partial result in error comment when agent produced output', async () => {
      setAgentRunResult(mockPiAgent, {
        result: 'I have created the PR. Now let me run the tests…',
        error: '429 rate limit exceeded',
      });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const [text] = getFinalCommentCall(mockGit);
      expect(text).toBe(
        'I have created the PR. Now let me run the tests…\n\n---\n\n❌ Agent session ended with error: 429 rate limit exceeded'
      );
    });

    test('includes session stats in error comment metadata', async () => {
      const sessionStats = {
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
        cost: 0.02,
        version: '1.0.0',
      };
      setAgentRunResult(mockPiAgent, { error: 'quota exceeded', sessionStats });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const [, metadata] = getFinalCommentCall(mockGit);
      expect(metadata.sessionStats).toEqual(sessionStats);
    });

    test('still runs session exports when session ends with error', async () => {
      setAgentRunResult(mockPiAgent, { error: 'quota exceeded' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockPiAgent.exportSessionHtml).toHaveBeenCalled();
    });

    test('deletes reaction when session ends with error', async () => {
      const mockReaction = setAddReactionReturn(mockGit, 999);
      setAgentRunResult(mockPiAgent, { error: 'quota exceeded' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockGit.deleteReaction).toHaveBeenCalledWith(mockReaction);
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
      mockGit.getPrompt = mock(async () => undefined) as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('No prompt found - cannot proceed');
    });

    test('calls core.setFailed when no prompt found', async () => {
      mockGit.getPrompt = mock(async () => undefined) as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockOutputSink.setFailed).toHaveBeenCalled();
      const errorArg = (mockOutputSink.setFailed as any).mock.calls[0][0];
      expect(errorArg.message).toBe('No prompt found - cannot proceed');
    });

    test('finalizes with error message when no prompt found', async () => {
      mockGit.getPrompt = mock(async () => undefined) as any;

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
      mockGit.getPrompt = mock(async () => undefined) as any;

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow();

      expect(mockPiFactory).not.toHaveBeenCalled();
      expect(mockPiAgent.run).not.toHaveBeenCalled();
    });
  });

  describe('extensions configuration', () => {
    test('passes extensions config to Pi agent factory', async () => {
      const extensions = ['npm:package-one', 'git:github.com/user/repo', './local-path.ts'];
      const orchestrator = createOrchestrator({ extensions });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { extensions });
    });

    test('omits extensions when not in config', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expectFactoryCalledWith(
        mockPiFactory,
        mockCore,
        mockProvider,
        { extensions: expect.any(Array) },
        { not: true }
      );
    });
  });

  describe('load_builtin_extensions configuration', () => {
    test('defaults to true when not provided', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadBuiltinExtensions: true,
      });
    });

    test('parses true value correctly', async () => {
      const orchestrator = createOrchestrator({ loadBuiltinExtensions: true });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadBuiltinExtensions: true,
      });
    });

    test('parses false value correctly', async () => {
      const orchestrator = createOrchestrator({ loadBuiltinExtensions: false });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadBuiltinExtensions: false,
      });
    });

    test('handles case-insensitive true values', async () => {
      const orchestrator = createOrchestrator({ loadBuiltinExtensions: true });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadBuiltinExtensions: true,
      });
    });

    test('handles case-insensitive false values', async () => {
      const orchestrator = createOrchestrator({ loadBuiltinExtensions: false });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadBuiltinExtensions: false,
      });
    });
  });

  describe('edge cases', () => {
    test('handles empty prompt string as missing prompt error', async () => {
      mockGit.getPrompt = mock(async () => '') as any;

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
      mockGit.addReaction = mock(async () => undefined) as any;

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockGit.deleteReaction).not.toHaveBeenCalled();
      expect(mockGit.createFinalComment).toHaveBeenCalled();
    });

    test('handles whitespace-only thinking_level input', async () => {
      const orchestrator = createOrchestrator({ thinkingLevel: '   ' });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { thinkingLevel: '   ' });
    });
  });

  describe('error handling - session stats', () => {
    test('continues execution when run returns undefined sessionStats', async () => {
      setAgentRunResult(mockPiAgent, { result: 'Here are your tests!' });

      const orchestrator = createOrchestrator();

      // Should not throw - execution continues without stats
      await expect(orchestrator.execute()).resolves.toBeUndefined();

      // Comment should still be created without stats
      const [, metadata] = getFinalCommentCall(mockGit);
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
      setAgentRunResult(mockPiAgent, { result: 'Here are your tests!', sessionStats });

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).resolves.toBeUndefined();

      const [, metadata] = getFinalCommentCall(mockGit);
      expect(metadata.sessionStats).toEqual(sessionStats);
    });

    test('passes actionVersion through metadata to createFinalComment', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const [, metadata] = getFinalCommentCall(mockGit);

      // actionVersion should be a non-empty, non-unknown version string
      expect(metadata.actionVersion).toBeDefined();
      expect(metadata.actionVersion).not.toBe('unknown');
      expect(typeof metadata.actionVersion).toBe('string');
    });
  });

  describe('error handling - finalize failures', () => {
    test('re-throws error after finalize succeeds in catch block', async () => {
      const error = new Error('Prompt failed');
      setAgentRunError(mockPiAgent, error);

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toBe(error);

      expect(mockOutputSink.setFailed).toHaveBeenCalledWith(error);
      expect(mockGit.createFinalComment).toHaveBeenCalledWith('Prompt failed', expect.any(Object));
    });

    test('fails action when finalize in catch block throws', async () => {
      const error = new Error('Prompt failed');
      const finalizeError = new Error('Failed to post comment');
      setAgentRunError(mockPiAgent, error);
      mockGit.createFinalComment = mock(async () => {
        throw finalizeError;
      }) as any;

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
      setAgentRunError(mockPiAgent, error);

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow(error);

      expect(mockOutputSink.setFailed).toHaveBeenCalledWith(error);
      expect(mockOutputSink.setFailed).toHaveBeenCalledTimes(1);
    });
  });

  describe('action outputs', () => {
    test('sets response output with agent result', async () => {
      setAgentRunResult(mockPiAgent, { result: 'Your tests are ready!' });

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
      setAgentRunError(mockPiAgent, new Error('API error'));

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
      setAgentRunResult(mockPiAgent, { result: 'Done!', sessionStats });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('input_tokens', 500);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('output_tokens', 200);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('cost', 0.042);
    });

    test('does not set token/cost outputs when session stats unavailable', async () => {
      setAgentRunResult(mockPiAgent, { result: 'Done!' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('input_tokens', expect.anything());
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('output_tokens', expect.anything());
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('cost', expect.anything());
    });

    test('sets duration_seconds output', async () => {
      const startTime = Temporal.Instant.from('2024-01-15T10:30:00Z');
      mockGit.getStartTime = mock(() => startTime) as any;

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
      setAgentRunResult(mockPiAgent, { result: 'Analysis complete', sessionStats });

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

  describe('token usage report', () => {
    test('logs token usage report when session stats available', async () => {
      const sessionStats = {
        inputTokens: 1500,
        outputTokens: 500,
        totalTokens: 2000,
        cost: 0.042,
        version: '1.0.0',
      };
      setAgentRunResult(mockPiAgent, { result: 'Done!', sessionStats });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls).toContain(
        '📊 Token usage: input 1,500 · output 500 · total 2,000 · cost $0.0420'
      );
    });

    test('omits cost from report when cost is zero', async () => {
      const sessionStats = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0,
        version: '1.0.0',
      };
      setAgentRunResult(mockPiAgent, { result: 'Done!', sessionStats });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls).toContain('📊 Token usage: input 100 · output 50 · total 150');
    });

    test('uses absolute value for cost (handles negative balance reporting)', async () => {
      const sessionStats = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: -0.005,
        version: '1.0.0',
      };
      setAgentRunResult(mockPiAgent, { result: 'Done!', sessionStats });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls).toContain(
        '📊 Token usage: input 100 · output 50 · total 150 · cost $0.0050'
      );
    });

    test('omits cost when tiny positive cost rounds to zero at 4 decimals', async () => {
      // 0.00001 > 0 but toFixed(4) rounds back to "0.0000" — the shared
      // formatCost helper rounds before the threshold check, so the segment
      // is omitted rather than shown as a confusing "cost $0.0000".
      const sessionStats = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.00001,
        version: '1.0.0',
      };
      setAgentRunResult(mockPiAgent, { result: 'Done!', sessionStats });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls).toContain('📊 Token usage: input 100 · output 50 · total 150');
      expect(infoCalls.some((c: string) => c.includes('cost $0.0000'))).toBe(false);
    });

    test('does not log token usage report when session stats unavailable', async () => {
      setAgentRunResult(mockPiAgent, { result: 'Done!' });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls.some((c: string) => c.startsWith('📊 Token usage:'))).toBe(false);
    });

    test('logs token usage report even when session ends with error', async () => {
      const sessionStats = {
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
        cost: 0.02,
        version: '1.0.0',
      };
      setAgentRunResult(mockPiAgent, { error: 'quota exceeded', sessionStats });

      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls).toContain(
        '📊 Token usage: input 500 · output 100 · total 600 · cost $0.0200'
      );
    });

    test('recovers partial token usage when run() throws', async () => {
      // Simulate pi.run() rejecting after consuming tokens (e.g. the
      // underlying prompt() threw mid-turn). Partial usage is recovered via
      // the agent's getSessionStats() so it still shows up in the logs.
      const partialStats = {
        inputTokens: 300,
        outputTokens: 40,
        totalTokens: 340,
        cost: 0.015,
        version: '1.0.0',
      };
      setAgentRunError(mockPiAgent, new Error('prompt crashed'));
      setAgentGetSessionStats(mockPiAgent, partialStats);

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('prompt crashed');

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls).toContain(
        '📊 Token usage: input 300 · output 40 · total 340 · cost $0.0150'
      );
      // Recovered stats also flow to action outputs.
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('input_tokens', 300);
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('cost', 0.015);
      expect(mockPiAgent.getSessionStats).toHaveBeenCalled();
    });

    test('does not throw when recovering stats after run() rejects', async () => {
      // pi.run() throws and getSessionStats() is unavailable → finalize
      // proceeds without stats, action still fails with the original error.
      setAgentRunError(mockPiAgent, new Error('prompt crashed'));
      setAgentGetSessionStats(mockPiAgent, undefined);

      const orchestrator = createOrchestrator();

      await expect(orchestrator.execute()).rejects.toThrow('prompt crashed');

      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      expect(infoCalls.some((c: string) => c.startsWith('📊 Token usage:'))).toBe(false);
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('input_tokens', expect.anything());
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

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        baseUrl: 'https://my-proxy.example.com/v1',
      });
    });

    test('omits baseUrl when input is empty', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expectFactoryCalledWith(
        mockPiFactory,
        mockCore,
        mockProvider,
        { baseUrl: expect.any(String) },
        { not: true }
      );
    });
  });

  describe('export_session_html configuration', () => {
    test('defaults to true when not provided', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { exportSessionHtml: true });
    });

    test('parses true value correctly', async () => {
      const orchestrator = createOrchestrator({ exportSessionHtml: true });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { exportSessionHtml: true });
    });

    test('parses false value correctly', async () => {
      const orchestrator = createOrchestrator({ exportSessionHtml: false });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { exportSessionHtml: false });
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
      mockPiAgent.exportSessionHtml = mock(async () => {
        throw new Error('export failed');
      }) as any;

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

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        diffMaxLines: 500,
        diffMaxBytes: 204800,
        diffIgnorePatterns: ['dist/'],
      });
    });

    test('passes diffMaxLines when provided', async () => {
      const orchestrator = createOrchestrator({ diffMaxLines: 500 });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { diffMaxLines: 500 });
    });

    test('passes diffMaxBytes when provided', async () => {
      const orchestrator = createOrchestrator({ diffMaxBytes: 204800 });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { diffMaxBytes: 204800 });
    });

    test('passes diffIgnorePatterns when provided', async () => {
      const orchestrator = createOrchestrator({
        diffIgnorePatterns: ['dist/', 'package-lock.json', 'yarn.lock'],
      });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        diffIgnorePatterns: ['dist/', 'package-lock.json', 'yarn.lock'],
      });
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

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadedTools: ['get_pr_diff'],
      });
    });

    test('parses comma-separated tool names', async () => {
      const orchestrator = createOrchestrator({
        loadedTools: ['get_pr_diff', 'create_pull_request_review'],
      });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadedTools: ['get_pr_diff', 'create_pull_request_review'],
      });
    });

    test('trims whitespace around tool names', async () => {
      const orchestrator = createOrchestrator({
        loadedTools: ['get_pr_diff', 'create_pull_request_review', 'read'],
      });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadedTools: ['get_pr_diff', 'create_pull_request_review', 'read'],
      });
    });

    test('filters out empty items from trailing commas', async () => {
      const orchestrator = createOrchestrator({
        loadedTools: ['get_pr_diff', 'create_pull_request_review'],
      });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadedTools: ['get_pr_diff', 'create_pull_request_review'],
      });
    });

    test('deduplicates duplicate tool names', async () => {
      const orchestrator = createOrchestrator({ loadedTools: ['read', 'write'] });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, {
        loadedTools: ['read', 'write'],
      });
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

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { exportSessionJsonl: false });
    });

    test('parses true value correctly', async () => {
      const orchestrator = createOrchestrator({ exportSessionJsonl: true });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { exportSessionJsonl: true });
    });

    test('parses false value correctly', async () => {
      const orchestrator = createOrchestrator({ exportSessionJsonl: false });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { exportSessionJsonl: false });
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
      mockPiAgent.exportSessionJsonl = mock(async () => {
        throw new Error('jsonl export failed');
      }) as any;

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

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { autoCompaction: false });
    });

    test('parses true value correctly', async () => {
      const orchestrator = createOrchestrator({ autoCompaction: true });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { autoCompaction: true });
    });

    test('parses false value correctly', async () => {
      const orchestrator = createOrchestrator({ autoCompaction: false });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { autoCompaction: false });
    });
  });

  describe('prNumber configuration', () => {
    test('defaults to undefined when not provided', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      const callArgs = (mockPiFactory as any).mock.calls[0][0];
      expect(callArgs.prNumber).toBeUndefined();
    });

    test('passes prNumber when provided', async () => {
      const orchestrator = createOrchestrator({ prNumber: 42 });
      await orchestrator.execute();

      expectFactoryCalledWith(mockPiFactory, mockCore, mockProvider, { prNumber: 42 });
    });
  });

  describe('share_session configuration', () => {
    const originalFetch = globalThis.fetch;
    const htmlPath = '/tmp/pi-session-html-test/session.html';

    beforeEach(() => {
      // Override exportSessionHtml to actually write the file when called,
      // rather than pre-creating it. This ensures runSessionShare only finds
      // the HTML when exportSessionHtml was truly invoked (via share_session
      // auto-enable), guarding against the needsPersistence bug where an
      // in-memory session silently skips the export.
      mockPiAgent.exportSessionHtml = mock(async (outputPath: string) => {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, '<html>session</html>');
        return outputPath;
      }) as any;
      globalThis.fetch = mock(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'abc123def456',
          html_url: 'https://gist.github.com/bot/abc123def456',
          files: {
            'session.html': { raw_url: 'https://gist.githubusercontent.com/bot/abc123def456/raw' },
          },
        }),
        text: async () => '',
      })) as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      // Clean up the temp HTML fixture so it doesn't leak between test runs.
      try {
        fs.rmSync(path.dirname(htmlPath), { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    test('does not share when disabled (default)', async () => {
      const orchestrator = createOrchestrator();
      await orchestrator.execute();

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('share_url', expect.anything());
    });

    test('shares the session to a gist and surfaces the viewer link', async () => {
      const orchestrator = createOrchestrator({
        shareSession: true,
        githubToken: 'ghp_token',
      });
      await orchestrator.execute();

      // action outputs
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith(
        'share_url',
        'https://pi.dev/session/#abc123def456'
      );
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith(
        'gist_url',
        'https://gist.github.com/bot/abc123def456'
      );
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('gist_id', 'abc123def456');

      // The clickable viewer + gist links are surfaced in the summary
      // block (info), NOT as GitHub notice annotations.
      expect(mockCore.info).toHaveBeenCalledWith(
        '🔗 Session shared: https://pi.dev/session/#abc123def456'
      );
      expect(mockCore.info).toHaveBeenCalledWith(
        '🔗 Session gist: https://gist.github.com/bot/abc123def456'
      );
      // No notice annotations are emitted for the share links.
      const shareNotices = (mockCore.notice as any).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((m: string) => m.includes('Session shared') || m.includes('Session gist'));
      expect(shareNotices).toHaveLength(0);
      // Diagnostic detail is logged at debug level
      expect(mockCore.debug).toHaveBeenCalledWith(
        expect.stringContaining('view session: https://pi.dev/session/#abc123def456')
      );

      // The share links sit in the summary block after the banner and
      // before the export path (banner -> token usage -> share -> export).
      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      const bannerIndex = infoCalls.indexOf('✅ Agent session completed');
      const shareIndex = infoCalls.indexOf(
        '🔗 Session shared: https://pi.dev/session/#abc123def456'
      );
      const exportIndex = infoCalls.findIndex((c: string) =>
        c.includes('📄 exported session HTML')
      );
      expect(bannerIndex).toBeGreaterThanOrEqual(0);
      expect(shareIndex).toBeGreaterThan(bannerIndex);
      expect(exportIndex).toBeGreaterThan(shareIndex);

      // job summary exposes both clickable links
      expect(mockOutputSink.appendSummary).toHaveBeenCalledWith(
        expect.stringContaining('https://pi.dev/session/#abc123def456')
      );
      expect(mockOutputSink.appendSummary).toHaveBeenCalledWith(
        expect.stringContaining('https://gist.github.com/bot/abc123def456')
      );
    });

    test('builds the share_url from a custom share_viewer_url (github provider)', async () => {
      const orchestrator = createOrchestrator({
        shareSession: true,
        githubToken: 'ghp_token',
        shareViewerUrl: 'https://gistviewer.l3x.in/',
      });
      await orchestrator.execute();

      // The viewer link uses the custom viewer base + the gist id.
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith(
        'share_url',
        'https://gistviewer.l3x.in/#abc123def456'
      );
      expect(mockCore.info).toHaveBeenCalledWith(
        '🔗 Session shared: https://gistviewer.l3x.in/#abc123def456'
      );
    });

    test('enriches the gist description with repo/issue/run context', async () => {
      const orchestrator = createOrchestrator({
        shareSession: true,
        githubToken: 'ghp_token',
      });
      await orchestrator.execute();

      const calls = (globalThis.fetch as any).mock.calls;
      const body = JSON.parse(calls[0][1].body);
      expect(body.description).toBe('Pi session — test-owner/test-repo#1 (run 123)');
    });

    test('auto-enables export_session_html so the HTML is produced', async () => {
      const orchestrator = createOrchestrator({
        shareSession: true,
        githubToken: 't',
        exportSessionHtml: false,
      });
      await orchestrator.execute();

      expect(mockPiAgent.exportSessionHtml).toHaveBeenCalled();
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('session_html_path', expect.anything());
    });

    test('hides the auto-exported HTML path from the summary when export_session_html is off', async () => {
      // Sharing auto-enables the HTML export to feed the gist, but the user
      // didn't ask for a persisted HTML file — the throwaway path should not
      // be advertised in the summary block.
      const orchestrator = createOrchestrator({
        shareSession: true,
        githubToken: 'ghp_token',
        exportSessionHtml: false,
      });
      await orchestrator.execute();

      // The HTML was still produced (to feed the gist)...
      expect(mockPiAgent.exportSessionHtml).toHaveBeenCalled();
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('share_url', expect.anything());
      // ...but the summary block must not surface the export path.
      const infoCalls = (mockCore.info as any).mock.calls.map((c: any[]) => c[0] as string);
      const htmlExportCalls = infoCalls.filter((c: string) =>
        c.includes('📄 exported session HTML')
      );
      expect(htmlExportCalls).toHaveLength(0);
      // The share links are still surfaced regardless.
      expect(infoCalls).toContain('🔗 Session shared: https://pi.dev/session/#abc123def456');
    });

    test('skips sharing with a notice when no share token is configured', async () => {
      const orchestrator = createOrchestrator({ shareSession: true });
      await orchestrator.execute();

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('share_url', expect.anything());
      expect(mockCore.notice).toHaveBeenCalledWith(expect.stringContaining('no share token'));
    });

    test('continues execution when gist creation fails', async () => {
      globalThis.fetch = mock(async () => ({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({}),
        text: async () => 'bad credentials',
      })) as unknown as typeof fetch;

      const orchestrator = createOrchestrator({
        shareSession: true,
        githubToken: 'bad',
      });
      await orchestrator.execute();

      // Action still completes successfully
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('success', true);
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('share_url', expect.anything());
      expect(mockCore.notice).toHaveBeenCalledWith(
        expect.stringContaining('failed to share session')
      );
    });

    test('skips sharing with a notice when session HTML exceeds the size limit', async () => {
      // Override the export mock to produce an oversized file (well over
      // the 10 MB gist limit) when it's called.
      mockPiAgent.exportSessionHtml = mock(async (outputPath: string) => {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'x'.repeat(11 * 1024 * 1024));
        return outputPath;
      }) as any;

      const orchestrator = createOrchestrator({
        shareSession: true,
        githubToken: 'ghp_token',
      });
      await orchestrator.execute();

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('share_url', expect.anything());
      expect(mockCore.notice).toHaveBeenCalledWith(expect.stringContaining('exceeds'));
    });

    test('does not log "failed to share" when the gist succeeds but the summary write throws', async () => {
      // Summary write throws after the gist was already created.
      (mockOutputSink.appendSummary as any) = mock(async () => {
        throw new Error('summary IO error');
      });

      const orchestrator = createOrchestrator({
        shareSession: true,
        githubToken: 'ghp_token',
      });
      await orchestrator.execute();

      // Gist was created and outputs were set — sharing succeeded.
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith(
        'share_url',
        'https://pi.dev/session/#abc123def456'
      );
      // No misleading "failed to share session" notice.
      const notices = (mockCore.notice as any).mock.calls.map((c: unknown[]) => String(c[0]));
      expect(notices).not.toContainEqual(expect.stringContaining('failed to share session'));
      // The summary failure is logged at debug level, not as a notice.
      expect(mockCore.debug).toHaveBeenCalledWith(
        expect.stringContaining('job summary write skipped')
      );
    });

    test('shares to Opengist and surfaces a raw-HTML share link', async () => {
      // Opengist create response: id + html_url; the provider derives a
      // raw/HEAD link that renders the self-contained session.
      globalThis.fetch = mock(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'og-uuid-123',
          html_url: 'https://gist.l3x.in/bot/my-session',
        }),
        text: async () => '',
      })) as unknown as typeof fetch;

      const orchestrator = createOrchestrator({
        shareSession: true,
        shareGistProvider: 'opengist',
        shareGistApiUrl: 'https://gist.l3x.in/api/gists',
        shareGistToken: 'og_opengist-token',
      });
      await orchestrator.execute();

      // The request hit the Opengist route with the Opengist body shape.
      const calls = (globalThis.fetch as any).mock.calls;
      const [url, init] = calls[0];
      expect(url).toBe('https://gist.l3x.in/api/gists');
      const body = JSON.parse(init.body);
      expect(body.visibility).toBe('unlisted');
      expect(body.title).toBe('Pi session — test-owner/test-repo#1 (run 123)');
      expect(init.headers.Authorization).toBe('Bearer og_opengist-token');

      // Outputs carry the raw-HTML link (renders standalone), not pi.dev.
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith(
        'share_url',
        'https://gist.l3x.in/bot/my-session/raw/HEAD/session.html'
      );
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith(
        'gist_url',
        'https://gist.l3x.in/bot/my-session'
      );
      expect(mockOutputSink.setOutput).toHaveBeenCalledWith('gist_id', 'og-uuid-123');

      expect(mockCore.info).toHaveBeenCalledWith(
        '🔗 Session shared: https://gist.l3x.in/bot/my-session/raw/HEAD/session.html'
      );
    });

    test('skips Opengist sharing with a notice when share_gist_api_url is missing', async () => {
      const orchestrator = createOrchestrator({
        shareSession: true,
        shareGistProvider: 'opengist',
        shareGistToken: 'og_token',
        // shareGistApiUrl intentionally omitted
      });
      await orchestrator.execute();

      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(mockOutputSink.setOutput).not.toHaveBeenCalledWith('share_url', expect.anything());
      expect(mockCore.notice).toHaveBeenCalledWith(
        expect.stringContaining('opengist provider requires share_gist_api_url')
      );
    });

    test('uses githubToken as the share token fallback for Opengist', async () => {
      globalThis.fetch = mock(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'og-uuid',
          html_url: 'https://gist.l3x.in/bot/s',
        }),
        text: async () => '',
      })) as unknown as typeof fetch;

      const orchestrator = createOrchestrator({
        shareSession: true,
        shareGistProvider: 'opengist',
        shareGistApiUrl: 'https://gist.l3x.in/api/gists',
        // shareGistToken unset — should fall back to githubToken
        githubToken: 'ghp_fallback',
      });
      await orchestrator.execute();

      const init = (globalThis.fetch as any).mock.calls[0][1];
      expect(init.headers.Authorization).toBe('Bearer ghp_fallback');
    });
  });
});

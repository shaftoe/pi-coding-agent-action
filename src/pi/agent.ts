/**
 * @file Pi coding agent wrapper.
 *
 * Provides the `Agent` class that wraps the Pi SDK, handling model resolution,
 * authentication, agent session creation, and prompt execution. Designed for
 * headless / non-interactive use inside GitHub Actions.
 */

import { AuthStorage, createAgentSession, ModelRegistry } from '@mariozechner/pi-coding-agent';
import * as path from 'node:path';
import { getResourceLoader } from './resource-loader';
import { getVersion } from './logging';

import type { AgentSession } from '@mariozechner/pi-coding-agent';
import type { Api, Model } from '@mariozechner/pi-ai';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import type { PromptResult, SessionStats, CoreAdapter } from '../types';
import type { PlatformProvider } from '../platform';

/**
 * Pi coding agent for headless execution inside GitHub Actions.
 *
 * Wraps model resolution, authentication, agent session lifecycle, and prompt
 * execution into a simple interface: construct → {@link ready} → {@link run}.
 */
export class Agent {
  private model: Model<Api>;
  private authStorage: AuthStorage = AuthStorage.create();
  private modelRegistry: ModelRegistry;
  private session!: AgentSession;
  private modelStr: string;
  private provider: string;
  private token: string;
  private thinkingLevel: ThinkingLevel;
  private outputChunks: string[] = [];
  private sessionError: string | undefined;
  private core: CoreAdapter;
  private platformProvider: PlatformProvider;
  private extensions?: string[];
  private loadBuiltinExtensions?: boolean;
  private baseUrl?: string;

  /**
   * Create a new Pi agent.
   *
   * @param modelStr              - Model identifier (e.g. `"claude-sonnet-4-20250514"`).
   * @param provider              - Provider name as expected by the model registry
   *                                (e.g. `"anthropic"`, `"openai"`).
   * @param token                 - API key for the provider. When non-empty it is stored in
   *                                the auth storage automatically.
   * @param level                 - Thinking/reasoning level for the model
   *                                (default `'off'`).
   * @param core                  - The CoreAdapter for logging and debug output.
   * @param platformProvider      - The platform provider for custom tool operations.
   * @param extensions            - Optional array of extension sources (npm, git, or local paths).
   * @param loadBuiltinExtensions - Whether to load built-in GitHub extensions (default true).
   * @param baseUrl               - Optional base URL override for the provider.
   * @throws {Error}   If the requested model cannot be found in the registry.
   */
  constructor(
    modelStr: string,
    provider: string,
    token: string,
    level = 'off',
    core: CoreAdapter,
    platformProvider: PlatformProvider,
    extensions?: string[],
    loadBuiltinExtensions?: boolean,
    baseUrl?: string
  ) {
    this.modelStr = modelStr;
    this.provider = provider;
    this.token = token;
    this.thinkingLevel = level as ThinkingLevel;
    this.core = core;
    this.platformProvider = platformProvider;
    if (extensions !== undefined) {
      this.extensions = extensions;
    }
    if (loadBuiltinExtensions !== undefined) {
      this.loadBuiltinExtensions = loadBuiltinExtensions;
    }
    if (baseUrl !== undefined) {
      this.baseUrl = baseUrl;
    }
    this.modelRegistry = ModelRegistry.create(this.authStorage);

    if (this.token) {
      this.core.debug(`[auth] Setting api_key token for ${this.provider} provider`);
      this.authStorage.set(this.provider, {
        type: 'api_key',
        key: this.token,
      });
    }

    if (this.baseUrl) {
      this.core.debug(`[provider] Overriding base URL for ${this.provider}: ${this.baseUrl}`);
      this.modelRegistry.registerProvider(this.provider, { baseUrl: this.baseUrl });
    }

    const foundModel = this.modelRegistry.find(this.provider, this.modelStr);

    if (foundModel) {
      this.model = foundModel;
    } else {
      throw new Error(
        `Model not found: ${this.provider}/${this.modelStr}. ` +
          `Please check that the \`provider\` and \`model\` inputs are correct and that the provider is supported. ` +
          `See https://github.com/shaftoe/pi-coding-agent-action#usage for details.`
      );
    }
  }

  /**
   * Initialise the underlying agent session and subscribe to streaming events.
   *
   * Text deltas are collected into an internal buffer that is returned by
   * {@link prompt}. Thinking deltas are written to `stdout` in real time.
   *
   * @returns The agent instance itself, for chaining.
   */
  async ready(): Promise<Agent> {
    const { session } = await createAgentSession({
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: await getResourceLoader(
        this.core,
        this.platformProvider,
        this.extensions,
        this.loadBuiltinExtensions
      ),
    });
    this.session = session;

    this.session.subscribe(event => {
      switch (event.type) {
        case 'message_update':
          switch (event.assistantMessageEvent.type) {
            case 'text_delta':
              // Sent to the user as comment as final step
              this.outputChunks.push(event.assistantMessageEvent.delta);
              break;
            case 'thinking_delta':
              // We write the thinking into action logs directly
              process.stdout.write(event.assistantMessageEvent.delta);
              break;
            default:
              break;
          }
          break;

        // Track session errors that the Pi SDK handles internally without throwing.
        // When the LLM returns an error (e.g. context_window_exceeded, server errors),
        // the SDK stores it in the agent state and may attempt recovery (compaction,
        // auto-retry) but never rejects the prompt() promise. We capture these errors
        // so the action can fail the workflow instead of completing "successfully".
        case 'message_end':
          if (event.message.role === 'assistant') {
            if (event.message.stopReason === 'error') {
              this.sessionError = event.message.errorMessage ?? 'Unknown session error';
            } else {
              // SDK recovered successfully (auto-retry or compaction + retry)
              // so clear any stale error from a previous failed turn.
              this.sessionError = undefined;
            }
          }
          break;

        case 'compaction_end':
          if (event.errorMessage) {
            this.sessionError = event.errorMessage;
          }
          break;

        default:
          break;
      }
    });

    return this;
  }

  /**
   * Run the agent with the given prompt and return the accumulated text response with session statistics.
   *
   * @param text - The prompt text to send. Must be non-empty.
   * @returns The full assistant text response and session statistics.
   * @throws {Error} If `text` is falsy.
   */
  async run(text: string | undefined): Promise<PromptResult> {
    if (!text) {
      throw new Error('no text, skipping prompt');
    }

    await this.session.prompt(text);
    process.stdout.write('\n'); // ensure new line after prompt, usually missing from agent

    // Check for session errors that the Pi SDK handles internally without throwing.
    // These include context window exceeded, provider API errors, and compaction failures.
    // The prompt() promise resolves successfully even when the session ends in an error
    // state, so we must check explicitly and throw to make the CI workflow fail.
    //
    // We rely solely on the event-tracked sessionError rather than session.state.errorMessage
    // because the SDK may set state.errorMessage on transient errors (e.g. context window
    // exceeded) that it then auto-recovers from via compaction/retry. Our event listener
    // properly clears sessionError on successful message_end, so only terminal (unrecovered)
    // errors survive into this check.
    if (this.sessionError) {
      throw new Error(`Pi agent session error: ${this.sessionError}`);
    }

    const result = this.outputChunks.join('');
    const sessionStats = this.getSessionStats();

    return { result, sessionStats };
  }

  /**
   * Export the session as a self-contained HTML file.
   *
   * Uses the Pi SDK's built-in HTML export (same renderer as `/share`).
   * Must be called after {@link run} so the session has content.
   *
   * When the action runs from its bundled `dist/index.js`, the SDK's
   * `getPackageDir()` walks up from `__dirname` and finds the action's
   * `package.json` instead of the SDK's. Setting `PI_PACKAGE_DIR` tells
   * the SDK where its own package root is so it can locate template files
   * like `dist/core/export-html/template.html`.
   *
   * @param outputPath - Path to write the HTML file to.
   * @returns The path to the written file.
   */
  async exportSessionHtml(outputPath: string): Promise<string> {
    // When the action runs from its bundled dist/index.js, the SDK's
    // getPackageDir() walks up from __dirname and finds the action's
    // package.json instead of the SDK's. The build script copies the SDK's
    // export-html assets into dist/pi-sdk/, and we point the SDK there via
    // PI_PACKAGE_DIR (its supported escape hatch for bundled deployments).
    const previousPiPackageDir = process.env.PI_PACKAGE_DIR;
    try {
      process.env.PI_PACKAGE_DIR = path.join(__dirname, 'pi-sdk');
      return await this.session.exportToHtml(outputPath);
    } finally {
      if (previousPiPackageDir !== undefined) {
        process.env.PI_PACKAGE_DIR = previousPiPackageDir;
      } else {
        delete process.env.PI_PACKAGE_DIR;
      }
    }
  }

  /**
   * Get session statistics including token usage.
   *
   * @returns Session stats or undefined if session not ready or stats unavailable.
   * @private Internal method used by run().
   */
  private getSessionStats(): SessionStats | undefined {
    if (!this.session) {
      return undefined;
    }

    try {
      const stats = this.session.getSessionStats();
      return {
        inputTokens: stats.tokens.input,
        outputTokens: stats.tokens.output,
        totalTokens: stats.tokens.total,
        cost: stats.cost,
        version: getVersion(),
      };
    } catch (_error) {
      // Session stats are metadata - don't fail the action if unavailable
      this.core.notice('Failed to get session stats, continuing without stats');
      return undefined;
    }
  }
}

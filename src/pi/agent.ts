/**
 * @file Pi coding agent wrapper.
 *
 * Provides the `Agent` class that wraps the Pi SDK, handling model resolution,
 * authentication, agent session creation, and prompt execution. Designed for
 * headless / non-interactive use inside GitHub Actions.
 */

import { AuthStorage, createAgentSession, ModelRegistry } from '@mariozechner/pi-coding-agent';
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
    this.modelRegistry = ModelRegistry.inMemory(this.authStorage);

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
      if (event.type !== 'message_update') {
        return;
      }
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

    const result = this.outputChunks.join('');
    const sessionStats = this.getSessionStats();

    return { result, sessionStats };
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

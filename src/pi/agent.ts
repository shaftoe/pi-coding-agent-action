/**
 * @file Pi coding agent wrapper.
 *
 * Provides the `Agent` class that wraps the Pi SDK, handling model resolution,
 * authentication, agent session creation, and prompt execution. Designed for
 * headless / non-interactive use inside GitHub Actions.
 */

import * as core from '@actions/core';
import { AuthStorage, createAgentSession, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getResourceLoader } from './resource-loader';
import type { AgentSession } from '@mariozechner/pi-coding-agent';
import type { Api, Model } from '@mariozechner/pi-ai';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';

/**
 * Pi coding agent for headless execution inside GitHub Actions.
 *
 * Wraps model resolution, authentication, agent session lifecycle, and prompt
 * execution into a simple interface: construct → {@link ready} → {@link prompt}.
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

  /**
   * Create a new Pi agent.
   *
   * @param modelStr   - Model identifier (e.g. `"claude-sonnet-4-20250514"`).
   * @param provider   - Provider name as expected by the model registry
   *                      (e.g. `"anthropic"`, `"openai"`).
   * @param token      - API key for the provider. When non-empty it is stored in
   *                      the auth storage automatically.
   * @param level      - Thinking/reasoning level for the model
   *                      (default `'off'`).
   * @throws {Error}   If the requested model cannot be found in the registry.
   */
  constructor(modelStr: string, provider: string, token: string, level = 'off') {
    this.modelStr = modelStr;
    this.provider = provider;
    this.token = token;
    this.thinkingLevel = level as ThinkingLevel;
    this.modelRegistry = new ModelRegistry(this.authStorage);

    if (this.token) {
      core.debug(`[auth] Setting api_key token for ${this.provider} provider`);
      this.authStorage.set(this.provider, {
        type: 'api_key',
        key: this.token,
      });
    }

    const foundModel = this.modelRegistry.find(this.provider, this.modelStr);

    if (foundModel) {
      this.model = foundModel;
    } else {
      throw new Error('Model not found: ' + this.provider + '/' + this.modelStr);
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
      resourceLoader: await getResourceLoader(),
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
   * Send a prompt to the agent session and return the accumulated text response.
   *
   * @param text - The prompt text to send. Must be non-empty.
   * @returns The full assistant text response joined from streamed chunks.
   * @throws {Error} If `text` is falsy.
   */
  async prompt(text: string | undefined): Promise<string> {
    if (!text) {
      throw new Error('no text, skipping prompt');
    }

    await this.session.prompt(text);
    process.stdout.write('\n'); // ensure new line after prompt, usually missing from agent

    return this.outputChunks.join('');
  }

  /**
   * Get session statistics including token usage.
   *
   * @returns Session stats or undefined if session not ready or stats unavailable.
   */
  getSessionStats():
    | { inputTokens: number; outputTokens: number; totalTokens: number; cost: number }
    | undefined {
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
      };
    } catch (_error) {
      // Session stats are metadata - don't fail the action if unavailable
      return undefined;
    }
  }
}

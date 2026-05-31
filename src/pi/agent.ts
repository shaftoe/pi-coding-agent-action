/**
 * @file Pi coding agent wrapper.
 *
 * Provides the `Agent` class that wraps the Pi SDK, handling model resolution,
 * authentication, agent session creation, and prompt execution. Designed for
 * headless / non-interactive use inside GitHub Actions.
 */

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import * as path from 'node:path';
import { getResourceLoader } from './resource-loader';
import { getVersion } from './logging';

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type {
  PromptResult,
  SessionStats,
  CoreAdapter,
  PiConfig,
  ResourceLoaderConfig,
} from '../types';
import type { PlatformProvider } from '../platform';

/**
 * Error code used by {@link AgentTimeoutError} so callers can distinguish
 * graceful agent timeouts from ordinary runtime failures.
 */
export const TIMEOUT_ERROR_CODE = 'GH_AGENT_TIMEOUT';

/**
 * Thrown when the agent session exceeds the configured timeout.
 *
 * Carries a stable `code` property ({@link TIMEOUT_ERROR_CODE}) so that the
 * orchestrator and callers can differentiate timeouts from other errors.
 */
export class AgentTimeoutError extends Error {
  readonly code = TIMEOUT_ERROR_CODE;
  constructor(message: string) {
    super(message);
    this.name = 'AgentTimeoutError';
  }
}

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
  private thinkingLevel: ThinkingLevel;
  private outputChunks: string[] = [];
  private core: CoreAdapter;
  private platformProvider: PlatformProvider;
  private config: PiConfig;

  /**
   * Create a new Pi agent.
   *
   * @param core              - The CoreAdapter for logging and debug output.
   * @param platformProvider  - The platform provider for custom tool operations.
   * @param config            - The action configuration.
   * @throws {Error} If the requested model cannot be found in the registry.
   */
  constructor(core: CoreAdapter, platformProvider: PlatformProvider, config: PiConfig) {
    this.core = core;
    this.platformProvider = platformProvider;
    this.config = config;
    this.thinkingLevel = (config.thinkingLevel ?? 'off') as ThinkingLevel;
    this.modelRegistry = ModelRegistry.create(this.authStorage);

    if (config.token) {
      this.core.debug(`[auth] Setting api_key token for ${config.provider} provider`);
      this.authStorage.set(config.provider, {
        type: 'api_key',
        key: config.token,
      });
    }

    if (config.baseUrl) {
      this.core.debug(`[provider] Overriding base URL for ${config.provider}: ${config.baseUrl}`);
      this.modelRegistry.registerProvider(config.provider, { baseUrl: config.baseUrl });
    }

    const foundModel = this.modelRegistry.find(config.provider, config.model);

    if (foundModel) {
      this.model = foundModel;
    } else {
      throw new Error(
        `Model not found: ${config.provider}/${config.model}. ` +
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
    const loaderConfig: ResourceLoaderConfig = this.config;
    const resourceLoader = await getResourceLoader(this.core, this.platformProvider, loaderConfig);

    // Extract loadedTools early so we can pass it to createAgentSession and
    // reuse it for post-creation validation without repeated non-null assertions.
    const loadedTools = this.config.loadedTools;

    // Build SettingsManager with compaction and retry overrides
    const settingsManager = SettingsManager.inMemory({
      ...(this.config.compaction ? { compaction: this.config.compaction } : {}),
      ...(this.config.retry ? { retry: this.config.retry } : {}),
    });

    const { session } = await createAgentSession({
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader,
      settingsManager,
      // Pass loadedTools as the SDK's native allowlist (tools option).
      // Unknown tool names are silently ignored by the SDK, so we validate
      // after session creation below.
      ...(loadedTools ? { tools: loadedTools } : {}),
    });
    this.session = session;

    // Validate that all requested tool names actually exist after extensions
    // are loaded. This provides early, actionable errors instead of silently
    // dropping unknown names.
    if (loadedTools) {
      const availableTools = session.getAllTools().map(t => t.name);
      const availableSet = new Set(availableTools);
      const unknown = loadedTools.filter(name => !availableSet.has(name));

      if (unknown.length > 0) {
        const message =
          `loaded_tools: unknown tool name(s): ${unknown.join(', ')}. ` +
          `Available tools: ${availableTools.sort().join(', ')}`;
        this.core.info(`[loaded_tools] ❌ ${message}`);
        throw new Error(message);
      }

      const removed = availableTools.filter(name => !loadedTools.includes(name));
      if (removed.length > 0) {
        this.core.info(
          `[loaded_tools] Keeping ${loadedTools.length} tool(s): ${loadedTools.join(', ')}\n` +
            `[loaded_tools] Removing ${removed.length} tool(s): ${removed.sort().join(', ')}`
        );
      }
    }

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
   * If a timeout is configured and the session exceeds it, a {@link AgentTimeoutError}
   * is thrown with `code: 'GH_AGENT_TIMEOUT'`.
   *
   * @param text - The prompt text to send. Must be non-empty.
   * @returns The full assistant text response and session statistics.
   * @throws {AgentTimeoutError} If the session exceeds the configured timeout.
   * @throws {Error} If `text` is falsy.
   */
  async run(text: string | undefined): Promise<PromptResult> {
    if (!text) {
      throw new Error('no text, skipping prompt');
    }

    const timeoutSeconds = this.config.timeout;
    if (timeoutSeconds && timeoutSeconds > 0) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new AgentTimeoutError(`Agent session timed out after ${timeoutSeconds}s`)),
          timeoutSeconds * 1000
        );
      });

      try {
        await Promise.race([this.session.prompt(text), timeoutPromise]);
      } catch (error) {
        if (error instanceof AgentTimeoutError) {
          this.core.warning(`[timeout] ${error.message}`);
        }
        throw error;
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    } else {
      await this.session.prompt(text);
    }

    process.stdout.write('\n'); // ensure new line after prompt, usually missing from agent

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
   * Export the session as a JSONL file.
   *
   * Must be called after {@link run} so the session has content.
   *
   * @param outputPath - Path to write the JSONL file to.
   * @returns The JSONL string content.
   */
  exportSessionJsonl(outputPath: string): string {
    return this.session.exportToJsonl(outputPath);
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

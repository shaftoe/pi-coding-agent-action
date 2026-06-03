/**
 * @file Pi coding agent wrapper.
 *
 * Provides the `Agent` class that wraps the Pi SDK, handling model resolution,
 * authentication, agent session creation, and prompt execution. Designed for
 * headless / non-interactive use inside GitHub Actions.
 *
 * Model resolution is intentionally deferred from the constructor to
 * {@link ready} so that extensions (which may register custom providers and
 * models) are loaded before the lookup occurs.
 */

import {
  AuthStorage,
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRegistry,
  SessionManager,
} from '@earendil-works/pi-coding-agent';
import { buildResourceLoaderOptions } from './resource-loader';
import { getPiVersion } from '../version';

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type {
  PromptResult,
  SessionStats,
  Logger,
  PiConfig,
  ResourceLoaderConfig,
  AgentEvents,
} from '../types';
import type { PlatformProvider } from '../platform';

/**
 * Pi coding agent for headless execution inside GitHub Actions.
 *
 * Wraps model resolution, authentication, agent session lifecycle, and prompt
 * execution into a simple interface: construct → {@link ready} → {@link run}.
 */
export class Agent {
  private model!: Model<Api>;
  private authStorage: AuthStorage = AuthStorage.create();
  private modelRegistry: ModelRegistry;
  private session!: AgentSession;
  private thinkingLevel: ThinkingLevel;
  private outputChunks: string[] = [];
  private logger: Logger;
  private platformProvider: PlatformProvider;
  private config: PiConfig;
  private events: AgentEvents;

  /**
   * Create a new Pi agent.
   *
   * Model resolution is deferred to {@link ready} so that extensions loaded
   * during session-service creation can register custom providers/models
   * before the lookup occurs.
   *
   * @param logger            - Logger for debug/info output.
   * @param platformProvider  - The platform provider for custom tool operations.
   * @param config            - The action configuration.
   * @param events            - Optional streaming event callbacks.
   */
  constructor(
    logger: Logger,
    platformProvider: PlatformProvider,
    config: PiConfig,
    events?: AgentEvents
  ) {
    this.logger = logger;
    this.platformProvider = platformProvider;
    this.config = config;
    this.events = events ?? {};
    this.thinkingLevel = (config.thinkingLevel ?? 'off') as ThinkingLevel;
    this.modelRegistry = ModelRegistry.create(this.authStorage);

    if (config.token) {
      this.logger.debug(`[auth] Setting api_key token for ${config.provider} provider`);
      this.authStorage.set(config.provider, {
        type: 'api_key',
        key: config.token,
      });
    }

    if (config.baseUrl) {
      this.logger.debug(`[provider] Overriding base URL for ${config.provider}: ${config.baseUrl}`);
      this.modelRegistry.registerProvider(config.provider, { baseUrl: config.baseUrl });
    }
  }

  /**
   * Initialise the underlying agent session and subscribe to streaming events.
   *
   * Uses the SDK's two-phase session creation:
   *   1. `createAgentSessionServices` — loads extensions (which may register
   *      custom providers/models into the model registry).
   *   2. `createAgentSessionFromServices` — resolves the model against the
   *      now-populated registry and creates the session.
   *
   * Text deltas are collected into an internal buffer that is returned by
   * {@link run}. Thinking deltas are written to `stdout` in real time.
   *
   * @returns The agent instance itself, for chaining.
   * @throws {Error} If the requested model cannot be found in the registry
   *                  (after extensions have been loaded).
   */
  async ready(): Promise<Agent> {
    const loaderConfig: ResourceLoaderConfig = this.config;
    const resourceLoaderOptions = await buildResourceLoaderOptions(
      this.logger,
      this.platformProvider,
      loaderConfig
    );

    // Phase 1: Create services (loads extensions, registers providers).
    const services = await createAgentSessionServices({
      cwd: this.config.cwd ?? process.cwd(),
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoaderOptions,
    });

    // Log any non-fatal diagnostics from service creation.
    for (const diagnostic of services.diagnostics) {
      if (diagnostic.type === 'error') {
        this.logger.error(`[services] ${diagnostic.message}`);
      } else if (diagnostic.type === 'warning') {
        this.logger.warning(`[services] ${diagnostic.message}`);
      }
    }

    // Log extension loading errors so that failures are visible in the
    // action output. The SDK captures these in extensionsResult.errors but
    // does not surface them through services.diagnostics.
    const extensionErrors = services.resourceLoader.getExtensions().errors;
    for (const error of extensionErrors) {
      this.logger.error(`[extension] ${error.path}: ${error.error}`);
    }

    // Resolve the model AFTER extensions have loaded — extensions that call
    // pi.registerProvider() will have populated the model registry by now.
    const foundModel = this.modelRegistry.find(this.config.provider, this.config.model);
    if (foundModel) {
      this.model = foundModel;
    } else {
      throw new Error(
        `Model not found: ${this.config.provider}/${this.config.model}. ` +
          `Please check that the \`provider\` and \`model\` inputs are correct and that the provider is supported. ` +
          `See https://github.com/shaftoe/pi-coding-agent-action#usage for details.`
      );
    }

    // Phase 2: Create the session with the resolved model.
    const loadedTools = this.config.loadedTools;
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(services.cwd),
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      // Pass loadedTools as the SDK's native allowlist (tools option).
      // Unknown tool names are silently ignored by the SDK, so we validate
      // after session creation below.
      ...(loadedTools ? { tools: loadedTools } : {}),
    });
    this.session = session;

    // Enable auto-compaction if requested. This allows Pi to automatically
    // summarize older messages when the context window fills up, enabling
    // longer sessions without hitting context limits.
    if (this.config.autoCompaction) {
      session.setAutoCompactionEnabled(true);
      this.logger.info('[auto-compaction] enabled');
    }

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
        this.logger.info(`[loaded_tools] ❌ ${message}`);
        throw new Error(message);
      }

      const removed = availableTools.filter(name => !loadedTools.includes(name));
      if (removed.length > 0) {
        this.logger.info(
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
          // Route thinking delta through the events interface
          this.events.onThinkingDelta?.(event.assistantMessageEvent.delta);
          break;
        case 'thinking_end':
          // Ensure the output line is terminated before any ::debug:: workflow
          // command fires (e.g. from turn_end extension events). Otherwise
          // ::debug:: lands mid-line and the Actions runner can't parse it.
          this.events.onThinkingComplete?.();
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
    this.events.onPromptComplete?.();

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
   * NOTE: When running from a bundled deployment (e.g. GitHub Action's
   * `dist/index.js`), the SDK's `getPackageDir()` may not find its own
   * `package.json`. The caller (adapter) is responsible for setting
   * `PI_PACKAGE_DIR` before calling this method if needed.
   *
   * @param outputPath - Path to write the HTML file to.
   * @returns The path to the written file.
   */
  async exportSessionHtml(outputPath: string): Promise<string> {
    return this.session.exportToHtml(outputPath);
  }

  /**
   * Export the session as a JSONL file.
   *
   * Uses the Pi SDK's built-in JSONL export. Each line is a JSON object
   * representing a session entry. Must be called after {@link run} so
   * the session has content.
   *
   * @param outputPath - Path to write the JSONL file to.
   * @returns The path to the written file.
   */
  async exportSessionJsonl(outputPath: string): Promise<string> {
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
        version: getPiVersion(),
      };
    } catch (_error) {
      // Session stats are metadata - don't fail the action if unavailable
      this.logger.notice('Failed to get session stats, continuing without stats');
      return undefined;
    }
  }
}

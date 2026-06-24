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
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { buildResourceLoaderOptions } from './resource-loader';
import { getPiVersion } from '../version';

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import type {
  PiAgent,
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
  // fallow-ignore-next-line complexity
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
  // fallow-ignore-next-line complexity
  async ready(): Promise<Agent> {
    const loaderConfig: ResourceLoaderConfig = this.config;
    const resourceLoaderOptions = await buildResourceLoaderOptions(
      this.logger,
      this.platformProvider,
      loaderConfig
    );

    const cwd = this.config.cwd ?? process.cwd();

    const settingsManager = SettingsManager.create(cwd);

    // Phase 1: Create services (loads extensions, registers providers).
    const services = await createAgentSessionServices({
      cwd,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      settingsManager,
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

    // Clamp the requested thinking level to what the resolved model actually
    // supports. This avoids passing an unsupported level (e.g. `xhigh` on a
    // model that only goes to `high`) — or a genuinely invalid value from a
    // misconfigured workflow input — straight to the provider. We degrade
    // gracefully (clamp to the nearest supported level + warn) rather than
    // throwing, since a level that one model doesn't support is not an error.
    const requestedThinkingLevel = this.thinkingLevel;
    const effectiveThinkingLevel = clampThinkingLevel(this.model, requestedThinkingLevel);
    if (effectiveThinkingLevel !== requestedThinkingLevel) {
      const supported = getSupportedThinkingLevels(this.model);
      this.logger.warning(
        `[thinking] Requested level "${requestedThinkingLevel}" is not supported by ` +
          `${this.config.provider}/${this.config.model}; clamping to "${effectiveThinkingLevel}" ` +
          `(supported: ${supported.join(', ')})`
      );
      this.thinkingLevel = effectiveThinkingLevel;
    }

    // Phase 2: Create the session with the resolved model.
    const loadedTools = this.config.loadedTools;
    // Use a file-backed session when HTML/JSONL export is needed — the SDK's
    // exportToHtml() requires a session file and throws "Cannot export
    // in-memory session to HTML" for in-memory sessions. shareSession
    // auto-enables the HTML export (the gist carries its bytes), so it must
    // trigger persistence too — otherwise exportToHtml() throws and sharing
    // is silently skipped.
    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional ||: flags are boolean|undefined and must fall through false; ?? only falls through null/undefined */
    const needsPersistence =
      this.config.exportSessionHtml || this.config.exportSessionJsonl || this.config.shareSession;
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    const sessionManager = needsPersistence
      ? SessionManager.create(services.cwd)
      : SessionManager.inMemory(services.cwd);
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager,
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

    // fallow-ignore-next-line complexity
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
   * @returns The full assistant text response, session statistics, and any
   *          session-level error that ended the run early.
   * @throws {Error} If `text` is falsy.
   */
  async run(text: string | undefined): Promise<PromptResult> {
    if (!text) {
      throw new Error('no text, skipping prompt');
    }

    await this.session.prompt(text);
    this.events.onPromptComplete?.();

    const result = this.outputChunks.join('');
    const sessionStats = this.collectSessionStats();
    const error = this.getSessionError();

    return { result, sessionStats, error };
  }

  /**
   * Public accessor for the session statistics accumulated so far.
   *
   * Delegates to {@link collectSessionStats}. Safe to call after {@link run}
   * rejected — the session persists and may hold partial token usage from
   * a turn that failed mid-flight.
   *
   * @returns Session stats or `undefined` when unavailable.
   */
  getSessionStats(): SessionStats | undefined {
    return this.collectSessionStats();
  }

  /**
   * Check if the session ended with an unrecoverable provider error.
   *
   * The Pi SDK resolves `session.prompt()` normally even when the provider
   * returns an error (e.g., 429 quota exceeded, rate limit, auth failure).
   * The error is captured in the last assistant message's `stopReason` and
   * `errorMessage` fields. This method inspects the session state to detect
   * such errors so the orchestrator can report them to the user.
   *
   * Only the *last* assistant message is checked — if the session recovered
   * from an earlier error (via auto-retry), the last message will have a
   * non-error `stopReason` and this method returns `undefined`.
   *
   * @returns The error message if the session ended with an error, `undefined` otherwise.
   */
  // fallow-ignore-next-line complexity
  private getSessionError(): string | undefined {
    if (!this.session) {
      return undefined;
    }

    try {
      const messages = this.session.state.messages;
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg) {
          continue;
        }
        if (msg.role === 'assistant') {
          if (msg.stopReason === 'error' && msg.errorMessage) {
            return msg.errorMessage;
          }
          // Last assistant message is not an error → session completed normally.
          return undefined;
        }
      }
    } catch {
      // Don't fail the action if we can't introspect session state.
    }
    return undefined;
  }

  /**
   * Export the session as a self-contained HTML file.
   *
   * Uses the Pi SDK's built-in HTML export (same renderer as `/share`).
   * Must be called after {@link run} so the session has content.
   *
   * When running from a bundled deployment (e.g. GitHub Action's
   * `dist/index.js`), the action entry point sets `PI_PACKAGE_DIR` once
   * at startup so the SDK's `getPackageDir()` resolves correctly.
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
   * Collect session statistics including token usage from the underlying SDK.
   *
   * @returns Session stats or undefined if session not ready or stats unavailable.
   * @private Internal helper used by {@link run} and {@link getSessionStats}.
   */
  private collectSessionStats(): SessionStats | undefined {
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

/**
 * Wrap an {@link Agent} instance in the simplified {@link PiAgent} adapter
 * interface expected by the orchestrator.
 *
 * {@link PiAgent#run} is a convenience that calls {@link Agent#ready} (idempotent)
 * before {@link Agent#run}. All frontends (GitHub Action, CLI, …) build their
 * `Agent` with platform-specific {@link AgentEvents} routing and then delegate
 * through this wrapper, so the adapter object is shared instead of duplicated.
 */
export function wrapAgent(agent: Agent): PiAgent {
  return {
    async run(text: string) {
      await agent.ready();
      return agent.run(text);
    },
    getSessionStats() {
      return agent.getSessionStats();
    },
    async exportSessionHtml(outputPath: string) {
      return agent.exportSessionHtml(outputPath);
    },
    async exportSessionJsonl(outputPath: string) {
      return agent.exportSessionJsonl(outputPath);
    },
  };
}

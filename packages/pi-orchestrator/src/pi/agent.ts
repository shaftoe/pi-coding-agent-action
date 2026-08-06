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
  createAgentSessionFromServices,
  createAgentSessionServices,
  CredentialSynchronizationError,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { clampThinkingLevel, getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { buildResourceLoaderOptions } from './resource-loader';
import { getPiVersion } from '../version';

import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Api, AssistantMessageEvent, Model } from '@earendil-works/pi-ai';
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core';
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
 * Derive retry-event payload types from the SDK's `AgentSessionEvent` union so
 * the handler signatures stay a single source of truth — if the SDK ever changes
 * a payload field, the compiler catches the drift here rather than in two places.
 */
type AutoRetryStartEvent = Extract<AgentSessionEvent, { type: 'auto_retry_start' }>;
type AutoRetryEndEvent = Extract<AgentSessionEvent, { type: 'auto_retry_end' }>;
type SummarizationRetryScheduledEvent = Extract<
  AgentSessionEvent,
  { type: 'summarization_retry_scheduled' }
>;
type SummarizationRetryAttemptStartEvent = Extract<
  AgentSessionEvent,
  { type: 'summarization_retry_attempt_start' }
>;

/**
 * Hard ceiling for the post-credential-synchronisation catalog refresh.
 *
 * The recovery refresh runs with `allowNetwork: true`, so a stalled or
 * unreachable provider catalog endpoint could otherwise wedge the action
 * until the overall job timeout. Bounding it fails fast and falls through to
 * the actionable error message instead of hanging.
 */
const MODEL_REFRESH_TIMEOUT_MS = 15_000;

/**
 * Pi coding agent for headless execution inside GitHub Actions.
 *
 * Wraps model resolution, authentication, agent session lifecycle, and prompt
 * execution into a simple interface: construct → {@link ready} → {@link run}.
 */
export class Agent {
  private model!: Model<Api>;
  private modelRuntime!: ModelRuntime;
  private session!: AgentSession;
  private thinkingLevel: ThinkingLevel;
  private outputChunks: string[] = [];
  private logger: Logger;
  private platformProvider: PlatformProvider;
  private config: PiConfig;
  private events: AgentEvents;
  /**
   * Error captured from the most recent `agent_end` event. Set when the
   * last assistant message in the event has `stopReason === 'error'`,
   * cleared when a subsequent loop iteration completes normally (e.g.
   * after a successful auto-retry). Resolved to its final value by the
   * time `agent_settled` fires.
   */
  private lastAgentError: string | undefined;
  /**
   * The session event handler registered during {@link ready}. Stored as
   * a field so that test helpers can wire mock sessions to dispatch events
   * through the same handler.
   * @internal
   */
  private sessionEventHandler?: (event: AgentSessionEvent) => void;

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

    // Create and configure the model runtime (replaces the legacy
    // AuthStorage + ModelRegistry pair). ModelRuntime.create() is async
    // (it refreshes the model catalog), so initialisation happens here in
    // ready() rather than in the constructor.
    this.modelRuntime = await ModelRuntime.create();

    if (this.config.token) {
      this.logger.debug(`[auth] Setting api_key token for ${this.config.provider} provider`);
      await this.applyRuntimeApiKey(this.config.token);
    }

    if (this.config.baseUrl) {
      this.logger.debug(
        `[provider] Overriding base URL for ${this.config.provider}: ${this.config.baseUrl}`
      );
      this.modelRuntime.registerProvider(this.config.provider, { baseUrl: this.config.baseUrl });
    }

    // Phase 1: Create services (loads extensions, registers providers).
    const services = await createAgentSessionServices({
      cwd,
      modelRuntime: this.modelRuntime,
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
    const foundModel = this.modelRuntime.getModel(this.config.provider, this.config.model);
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
          `${this.model.provider}/${this.model.id}; clamping to "${effectiveThinkingLevel}" ` +
          `(supported: ${supported.join(', ')})`
      );
      this.thinkingLevel = effectiveThinkingLevel;
      // Propagate the effective level back to the config so that downstream
      // consumers (e.g. the orchestrator's comment footer, which reads
      // `config.thinkingLevel`) report the level actually in use rather than
      // the originally-requested one.
      this.config.thinkingLevel = effectiveThinkingLevel;
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

    this.sessionEventHandler = (event: AgentSessionEvent) => {
      // Route all retry-related events (auto_retry_*, summarization_retry_*) to
      // a dedicated sub-handler. Checked up-front via a string guard rather
      // than individual `case` labels to keep this dispatcher's cyclomatic
      // complexity low — the SDK may add further `*_retry_*` variants and they
      // all belong to the same retry sub-tree.
      if (event.type.includes('retry')) {
        this.handleRetryEvent(event);
        return;
      }
      switch (event.type) {
        case 'message_update':
          this.handleMessageUpdate(event.assistantMessageEvent);
          break;
        case 'agent_end':
          this.handleAgentEnd(event.messages);
          break;
        case 'agent_settled':
          // The session has fully settled — no further retries, compactions,
          // or queued continuations will fire. Route the prompt-complete
          // callback here for cleaner lifecycle semantics (the agent is
          // truly done, not just one iteration finished).
          this.events.onPromptComplete?.();
          break;
        default:
          break;
      }
    };
    this.session.subscribe(this.sessionEventHandler);

    return this;
  }

  /**
   * Apply the configured runtime API key, recovering from a credential-sync
   * failure with a clear, actionable message.
   *
   * `ModelRuntime.setRuntimeApiKey()` commits the credential to the store and
   * then synchronises the in-memory model/auth snapshot (local composition +
   * availability recompute). If the credential commits but that local sync
   * fails, the SDK throws {@link CredentialSynchronizationError} rather than
   * leaving the runtime half-synchronised — which would otherwise surface as
   * a confusing downstream "Model not found".
   *
   * The key was already saved, so we attempt one explicit, forced catalog
   * refresh to recover (the documented remedy when remote freshness is
   * needed), bounded by {@link MODEL_REFRESH_TIMEOUT_MS} so a stalled catalog
   * endpoint fails fast rather than hanging the action. If that also fails —
   * or times out — we rethrow a message that names the provider and points at
   * the most likely-affected inputs.
   *
   * @param token - The API key to set. Caller guarantees it is non-empty.
   * @private
   */
  private async applyRuntimeApiKey(token: string): Promise<void> {
    try {
      await this.modelRuntime.setRuntimeApiKey(this.config.provider, token);
    } catch (error) {
      if (!(error instanceof CredentialSynchronizationError)) {
        throw error;
      }
      const providerId = error.providerId;
      this.logger.warning(
        `[auth] API key for "${providerId}" was saved, but the model state ` +
          'could not be synchronized — attempting a catalog refresh to recover'
      );
      // Bound the recovery refresh so a stalled catalog endpoint fails fast
      // instead of hanging the action until the job timeout. Guarded for
      // environments where AbortSignal.timeout is unavailable.
      const refreshSignal =
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(MODEL_REFRESH_TIMEOUT_MS)
          : undefined;
      const { aborted, errors } = await this.modelRuntime.refresh({
        providers: [providerId],
        allowNetwork: true,
        force: true,
        ...(refreshSignal ? { signal: refreshSignal } : undefined),
      });
      const refreshError = errors.get(providerId);
      if (aborted || refreshError) {
        throw new Error(
          `Could not synchronize model state for provider "${providerId}" after setting its API key. ` +
            'The key was saved, but the model catalog could not be refreshed ' +
            `(${refreshError ? refreshError.message : 'refresh aborted'}). ` +
            'Check that the `provider`, `model`, and `base_url` inputs are valid for this provider.',
          { cause: error }
        );
      }
    }
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

    // Reset error state for this run. The agent_end event handler will
    // populate this field during the session.
    this.lastAgentError = undefined;

    await this.session.prompt(text);

    // onPromptComplete is now routed through the agent_settled event
    // handler, so it fires when the session has truly settled.

    const result = this.outputChunks.join('');
    const sessionStats = this.collectSessionStats();
    const error = this.lastAgentError;

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
   * Release the underlying SDK session and its provider resources.
   *
   * In particular, the OpenAI Codex transport caches a reusable WebSocket
   * for five minutes. `AgentSession.dispose()` closes that socket and clears
   * its expiry timer so headless callers can exit immediately.
   */
  dispose(): void {
    this.session?.dispose();
  }

  /**
   * Handle `message_update` session events.
   *
   * Routes text deltas to the output buffer and thinking deltas/completion
   * through the {@link AgentEvents} interface.
   *
   * @param event - The assistant message event from the `message_update` payload.
   * @private
   */
  private handleMessageUpdate(event: AssistantMessageEvent): void {
    switch (event.type) {
      case 'text_delta':
        // Sent to the user as comment as final step
        this.outputChunks.push(event.delta);
        break;
      case 'thinking_delta':
        // Route thinking delta through the events interface
        this.events.onThinkingDelta?.(event.delta);
        break;
      case 'thinking_end':
        // Ensure the output line is terminated before any ::debug::
        // workflow command fires (e.g. from turn_end extension
        // events). Otherwise ::debug:: lands mid-line and the Actions
        // runner can't parse it.
        this.events.onThinkingComplete?.();
        break;
      default:
        break;
    }
  }

  /**
   * Handle `agent_end` session events.
   *
   * Captures error state from the agent loop's final assistant message.
   * Each `agent_end` fires at the end of a loop iteration (there may be
   * several if auto-retry/compaction triggers). The last assistant message
   * tells us whether this iteration ended with a provider error; if a later
   * iteration succeeds, it clears the error. Replaces the previous post-run
   * heuristic that reverse-walked `session.state.messages`.
   *
   * @param messages - The messages from this agent loop iteration.
   * @private
   */
  private handleAgentEnd(messages: AgentMessage[]): void {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && (msg as { role?: string }).role === 'assistant') {
        const assistant = msg as {
          stopReason?: string;
          errorMessage?: string;
        };
        this.lastAgentError = assistant.stopReason === 'error' ? assistant.errorMessage : undefined;
        break;
      }
    }
  }

  /**
   * Dispatch retry-related session events (`auto_retry_*`, `summarization_retry_*`)
   * to their dedicated handlers.
   *
   * Extracted from the main {@link sessionEventHandler} switch so the primary
   * dispatcher stays lean and the retry sub-tree is self-contained.
   *
   * @param event - A retry-related `AgentSessionEvent`.
   * @private
   */
  private handleRetryEvent(event: AgentSessionEvent): void {
    switch (event.type) {
      case 'auto_retry_start':
        this.handleAutoRetryStart(event);
        break;
      case 'auto_retry_end':
        this.handleAutoRetryEnd(event);
        break;
      case 'summarization_retry_scheduled':
        this.handleSummarizationRetryScheduled(event);
        break;
      case 'summarization_retry_attempt_start':
        this.handleSummarizationRetryAttemptStart(event);
        break;
      case 'summarization_retry_finished':
        this.handleSummarizationRetryFinished();
        break;
      default:
        break;
    }
  }

  /**
   * Handle `auto_retry_start` session events.
   *
   * Pi auto-retries transient provider failures (network/DNS errors, 5xx,
   * rate limits, early stream endings) per the configured retry policy. Each
   * retry adds latency and token cost, so surface the start so operators can
   * correlate slow/expensive runs. This event arrives on the raw session
   * stream (not the `ExtensionAPI` `pi.on()` surface).
   *
   * @param event - The auto-retry-start payload.
   * @private
   */
  private handleAutoRetryStart(event: AutoRetryStartEvent): void {
    this.logger.info(
      `[auto-retry] 🔄 provider call retrying — attempt ${event.attempt}/${event.maxAttempts} ` +
        `after ${event.delayMs}ms (last error: ${event.errorMessage})`
    );
  }

  /**
   * Handle `auto_retry_end` session events.
   *
   * Fires when the auto-retry loop settles. Log recovery at info and
   * exhaustion at warning — a failed retry loop usually precedes a
   * session-level error that {@link handleAgentEnd} captures, but the
   * warning makes the exhaustion visible in isolation too.
   *
   * @param event - The auto-retry-end payload.
   * @private
   */
  private handleAutoRetryEnd(event: AutoRetryEndEvent): void {
    if (event.success) {
      this.logger.info(`[auto-retry] ✅ recovered on attempt ${event.attempt}`);
    } else {
      const detail = event.finalError ? `: ${event.finalError}` : '';
      this.logger.warning(`[auto-retry] ❌ exhausted after attempt ${event.attempt}${detail}`);
    }
  }

  /**
   * Handle `summarization_retry_scheduled` session events.
   *
   * Fires when an auto-compaction's summary generation itself retries (the
   * summarisation LLM call hit a transient failure). Mirrors `auto_retry_start`
   * but for the compaction/branch-summary sub-flow, so operators have full
   * retry visibility — without this, compaction-summary retries are invisible
   * even though provider-call retries are logged.
   *
   * @param event - The summarization-retry-scheduled payload.
   * @private
   */
  private handleSummarizationRetryScheduled(event: SummarizationRetryScheduledEvent): void {
    this.logger.info(
      `[summarization-retry] 🔄 summary generation retrying — attempt ` +
        `${event.attempt}/${event.maxAttempts} after ${event.delayMs}ms ` +
        `(last error: ${event.errorMessage})`
    );
  }

  /**
   * Handle `summarization_retry_attempt_start` session events.
   *
   * Fires at the start of each summarisation retry attempt. The `source`
   * discriminates whether the summary being retried is a branch summary
   * (tree navigation) or a compaction summary (context threshold/overflow).
   * Logged at debug to avoid noise — the scheduled/finished pair already
   * brackets the retry loop at info level.
   *
   * @param event - The summarization-retry-attempt-start payload.
   * @private
   */
  private handleSummarizationRetryAttemptStart(event: SummarizationRetryAttemptStartEvent): void {
    const reason = event.source === 'compaction' ? `compaction (${event.reason})` : 'branchSummary';
    this.logger.debug(`[summarization-retry] ▶️ starting ${reason} summary attempt`);
  }

  /**
   * Handle `summarization_retry_finished` session events.
   *
   * Fires when the summarisation retry loop settles. The SDK does not carry a
   * success/error field on this event, so we log a neutral marker — not a
   * green checkmark — to avoid implying recovery. Paired with
   * {@link handleSummarizationRetryScheduled} this brackets the loop so
   * operators can see it began and ended.
   *
   * @private
   */
  private handleSummarizationRetryFinished(): void {
    this.logger.info(`[summarization-retry] • summary retry loop finished`);
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
    dispose() {
      agent.dispose();
    },
  };
}

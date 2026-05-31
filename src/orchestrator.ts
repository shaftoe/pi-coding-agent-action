/**
 * @file Action orchestrator with testable business logic.
 *
 * Separates orchestration flow (what happens and in what order) from
 * implementation details (how we talk to GitHub, Core, or Pi). This enables
 * comprehensive unit testing of the action's behavior without mocking
 * the external dependencies themselves.
 */

import { Temporal } from '@js-temporal/polyfill';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  type CommentMetadata,
  type CoreAdapter,
  type GitAdapter,
  type PiAgent,
  type PiAgentFactory,
  type PiConfig,
  type SessionStats,
  type CompactionConfig,
  type RetryConfig,
} from './types';
import type { CreateReactionType, PlatformProvider } from './platform';
import { TIMEOUT_ERROR_CODE } from './pi/agent';

declare const __VERSION__: string;

/**
 * Parse the `loaded_tools` input.
 *
 * - `'all'`, empty, or whitespace-only → `undefined` (use all tools)
 * - Comma-separated list of tool names → `string[]`
 *
 * Whitespace around tool names is trimmed. Empty items after splitting are
 * discarded. Duplicate names are deduplicated.
 */
function parseLoadedTools(input: string): string[] | undefined {
  const trimmed = input?.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') {
    return undefined;
  }
  const tools = trimmed
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  return tools.length > 0 ? [...new Set(tools)] : undefined;
}

/**
 * Orchestrates the GitHub Action execution flow.
 *
 * The orchestrator gathers configuration, retrieves the prompt, manages the
 * reaction lifecycle, executes the Pi agent, and finalizes the result or error.
 */
export class ActionOrchestrator {
  /** Directory where session exports are written. Set by exportSessionHtml. */
  private sessionOutputDir: string | undefined;

  constructor(
    private readonly core: CoreAdapter,
    private readonly git: GitAdapter,
    private readonly piAgentFactory: PiAgentFactory,
    private readonly platformProvider: PlatformProvider
  ) {}

  /**
   * Execute the complete action flow.
   *
   * @throws Rethrows any error from the Pi session after reporting it via core.setFailed.
   *         Finalization errors (posting comment, deleting reaction) are caught and logged
   *         so they never prevent setFailed from running.
   */
  async execute(): Promise<void> {
    this.core.info(`running action v${__VERSION__}`);
    const startTime = this.git.getStartTime() ?? Temporal.Now.instant();
    let config: PiConfig | undefined;
    let reaction: CreateReactionType | undefined;
    let prompt: string | undefined;

    try {
      config = this.gatherConfig();
      prompt = await this.git.getPrompt(config.promptInput);

      if (!prompt) {
        throw new Error('No prompt found - cannot proceed');
      }

      try {
        reaction = await this.git.addReaction();
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        this.core.notice(`failed to add reaction: ${errorMessage}`);
      }

      const pi = this.piAgentFactory(config, this.core, this.platformProvider);
      let result: string;
      let sessionStats: SessionStats | undefined;
      let timedOut = false;

      try {
        const agentResult = await pi.run(prompt);
        result = agentResult.result;
        sessionStats = agentResult.sessionStats;
      } catch (agentError) {
        // Check for timeout errors
        if (agentError instanceof Error && (agentError as Error & { code?: string }).code === TIMEOUT_ERROR_CODE) {
          timedOut = true;
          result = agentError.message;
          sessionStats = undefined;
        } else {
          throw agentError;
        }
      }

      if (config.exportSessionHtml) {
        await this.exportSessionHtml(pi);
        // Also export JSONL alongside HTML for better session reproducibility
        this.exportSessionJsonl(pi);
      } else {
        this.core.debug('[session-html] export disabled by configuration');
      }

      this.core.info('\n');
      this.core.info('════════════════════════════════════════════════════════════════');
      this.core.info('✅ Agent session completed');
      this.core.info('════════════════════════════════════════════════════════════════');

      // Ensure we always post a final comment — when the agent only used tools
      // (e.g. created/updated a PR) the text response may be empty.
      const finalBody = timedOut
        ? `⚠️ **Agent session timed out**\n\n${result}`
        : (result || '✅ Agent session completed');
      await this.finalize(finalBody, config, startTime, reaction, sessionStats, !timedOut, timedOut);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      // Try to post error as comment. Wrap in its own try-catch so that
      // a failure to finalize (e.g. network/API down after a timeout) does
      // NOT prevent setFailed from running. The action must always signal
      // failure to the CI runner, even when we cannot leave a comment.
      try {
        const errorConfig = config ?? {
          provider: '',
          model: '',
          token: '',
          thinkingLevel: '',
          promptInput: '',
        };
        await this.finalize(errorMessage, errorConfig, startTime, reaction, undefined, false, false);
      } catch (finalizeError) {
        const finalizeErrorMessage =
          finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
        this.core.notice(`failed to finalize after error: ${finalizeErrorMessage}`);
      }

      // Mark the action as failed and re-throw the original error
      this.core.setFailed(e as Error);
      throw e;
    }
  }

  /**
   * Gather configuration from core inputs.
   *
   * Validates that all required inputs are present and throws descriptive
   * errors when they are missing, so users see actionable guidance instead
   * of obscure downstream failures like "Model not found: /".
   */
  private gatherConfig(): PiConfig {
    const provider = this.core.getInput('provider');
    const model = this.core.getInput('model');
    const token = this.core.getInput('token');

    if (!provider) {
      throw new Error(
        'Missing required input: `provider`. ' +
          'Set it to your LLM provider (e.g. "anthropic", "openai", "google"). ' +
          'See https://github.com/shaftoe/pi-coding-agent-action#usage for details.'
      );
    }

    if (!model) {
      throw new Error(
        'Missing required input: `model`. ' +
          'Set it to the desired model (e.g. "claude-sonnet-4-5", "gpt-4o"). ' +
          'See https://github.com/shaftoe/pi-coding-agent-action#usage for details.'
      );
    }

    if (!token) {
      this.core.debug(
        '[config] No token provided — relying on provider-side auth (e.g. ADC)'
      );
    }

    const extensionsInput = this.core.getInput('extensions');
    const extensions = extensionsInput
      ? extensionsInput
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)
      : undefined;

    const loadBuiltinExtensionsInput = this.core.getInput('load_builtin_extensions');
    const loadBuiltinExtensions = loadBuiltinExtensionsInput
      ? loadBuiltinExtensionsInput.toLowerCase() === 'true'
      : true; // default to true

    const loadedToolsInput = this.core.getInput('loaded_tools');
    const loadedTools = parseLoadedTools(loadedToolsInput);

    const baseUrl = this.core.getInput('base_url') || undefined;

    const exportSessionHtmlInput = this.core.getInput('export_session_html');
    const exportSessionHtml = exportSessionHtmlInput
      ? exportSessionHtmlInput.toLowerCase() === 'true'
      : true; // default to true

    const diffMaxLinesInput = this.core.getInput('diff_max_lines');
    const parsedLines = diffMaxLinesInput ? parseInt(diffMaxLinesInput, 10) : NaN;
    const diffMaxLines = parsedLines > 0 ? parsedLines : undefined;

    const diffMaxBytesInput = this.core.getInput('diff_max_bytes');
    const parsedBytes = diffMaxBytesInput ? parseInt(diffMaxBytesInput, 10) : NaN;
    const diffMaxBytes = parsedBytes > 0 ? parsedBytes : undefined;

    const diffIgnorePatternsInput = this.core.getInput('diff_ignore_patterns');
    const diffIgnorePatterns = diffIgnorePatternsInput
      ? diffIgnorePatternsInput.split(/\s+/).filter(Boolean)
      : undefined;

    // Parse timeout (0 = no timeout)
    const timeoutInput = this.core.getInput('timeout');
    const parsedTimeout = timeoutInput ? parseInt(timeoutInput, 10) : 0;
    const timeout = parsedTimeout > 0 ? parsedTimeout : undefined;

    // Parse compaction settings
    const compactionEnabledInput = this.core.getInput('compaction_enabled');
    const compactionEnabled = compactionEnabledInput
      ? compactionEnabledInput.toLowerCase() === 'true'
      : true;
    const compaction: CompactionConfig = { enabled: compactionEnabled };

    // Parse retry settings
    const retryEnabledInput = this.core.getInput('retry_enabled');
    const retryEnabled = retryEnabledInput
      ? retryEnabledInput.toLowerCase() === 'true'
      : true;
    const retryMaxRetriesInput = this.core.getInput('retry_max_retries');
    const parsedRetryMaxRetries = retryMaxRetriesInput ? parseInt(retryMaxRetriesInput, 10) : 2;
    const retry: RetryConfig = {
      enabled: retryEnabled,
      maxRetries: Number.isNaN(parsedRetryMaxRetries) || parsedRetryMaxRetries < 0
        ? 2
        : parsedRetryMaxRetries,
    };

    return {
      provider,
      model,
      token,
      thinkingLevel: this.core.getInput('thinking_level') ?? 'off',
      promptInput: this.core.getInput('prompt'),
      ...(extensions?.length ? { extensions } : {}),
      loadBuiltinExtensions,
      ...(loadedTools ? { loadedTools } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      exportSessionHtml,
      ...(diffMaxLines ? { diffMaxLines } : {}),
      ...(diffMaxBytes ? { diffMaxBytes } : {}),
      ...(diffIgnorePatterns?.length ? { diffIgnorePatterns } : {}),
      ...(timeout ? { timeout } : {}),
      compaction,
      retry,
    };
  }

  /**
   * Export session as a self-contained HTML file.
   *
   * Writes the HTML to the runner's temp directory and sets the
   * `session_html_path` action output. Users can upload the file
   * as an artifact using `actions/upload-artifact` in their workflow:
   *
   * ```yaml
   * - uses: actions/upload-artifact@v7
   *   with:
   *     name: pi-session-html
   *     path: ${{ steps.pi.outputs.session_html_path }}
   * ```
   */
  private async exportSessionHtml(pi: PiAgent): Promise<void> {
    this.sessionOutputDir = path.join(
      process.env.RUNNER_TEMP ?? os.tmpdir(),
      `pi-session-html-${process.env.GITHUB_RUN_ID ?? 'local'}`
    );
    const htmlPath = path.join(this.sessionOutputDir, 'session.html');

    try {
      fs.mkdirSync(this.sessionOutputDir, { recursive: true });
      await pi.exportSessionHtml(htmlPath);
      this.core.info(`[session-html] exported session HTML to ${htmlPath}`);
      this.core.setOutput('session_html_path', htmlPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.core.notice(`[session-html] failed to export HTML: ${msg}`);
    }
  }

  /**
   * Export session as JSONL alongside the HTML export.
   *
   * Writes the JSONL to the same directory as the HTML file. JSONL provides
   * a machine-readable format useful for session replay, debugging, and analysis.
   *
   * @param pi - The Pi agent with an active session.
   */
  private exportSessionJsonl(pi: PiAgent): void {
    if (!this.sessionOutputDir) {
      return;
    }
    try {
      const jsonlPath = path.join(this.sessionOutputDir, 'session.jsonl');
      pi.exportSessionJsonl(jsonlPath);
      this.core.info(`[session-jsonl] exported session JSONL to ${jsonlPath}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.core.notice(`[session-jsonl] failed to export JSONL: ${msg}`);
    }
  }

  /**
   * Finalize execution by posting the result/error as a comment and setting action outputs.
   */
  private async finalize(
    body: string,
    config: PiConfig,
    startTime: Temporal.Instant,
    reaction: CreateReactionType | undefined,
    sessionStats: SessionStats | undefined,
    success: boolean,
    timedOut = false,
  ): Promise<void> {
    try {
      if (reaction) {
        await this.git.deleteReaction(reaction);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.core.notice(`failed to delete reaction: ${errorMessage}`);
    }

    this.core.setOutput('response', body);
    this.core.setOutput('success', success);
    this.core.setOutput('timed_out', timedOut);

    if (sessionStats !== undefined) {
      this.core.setOutput('input_tokens', sessionStats.inputTokens);
      this.core.setOutput('output_tokens', sessionStats.outputTokens);
      this.core.setOutput('cost', sessionStats.cost);
    }

    const executionDuration = startTime.until(Temporal.Now.instant());
    this.core.setOutput('duration_seconds', executionDuration.total('seconds'));

    const metadata: CommentMetadata = {
      actionVersion: __VERSION__,
      provider: config.provider,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      executionDuration,
      ...(timedOut ? { timedOut } : {}),
    };

    if (sessionStats !== undefined) {
      metadata.sessionStats = sessionStats;
    }

    await this.git.createFinalComment(body, metadata);
  }
}

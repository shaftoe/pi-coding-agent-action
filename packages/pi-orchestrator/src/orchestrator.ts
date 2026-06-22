/**
 * @file Action orchestrator with testable business logic.
 *
 * Separates orchestration flow (what happens and in what order) from
 * implementation details (how we talk to GitHub, Core, or Pi). This enables
 * comprehensive unit testing of the action's behavior without mocking
 * the external dependencies themselves.
 *
 * Accepts platform-agnostic interfaces ({@link Logger}, {@link OutputSink},
 * {@link PiConfig}) so the same orchestrator can drive any frontend.
 */

import { Temporal } from '@js-temporal/polyfill';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type CommentMetadata,
  type GitAdapter,
  type Logger,
  type OutputSink,
  type PiAgent,
  type PiAgentFactory,
  type PiConfig,
  type SessionStats,
} from './types';
import { formatCost } from './format';
import type { CreateReactionType, PlatformProvider } from './platform';
import { getActionVersion, formatActionVersion } from './version';
import { createSessionGist, DEFAULT_SHARE_VIEWER_URL } from './share/gist';

/**
 * Build the body of the success comment posted at the end of a run.
 *
 * The agent may produce no text response when it only used tools (e.g.
 * created/updated a PR), so we fall back to a fixed completion message.
 */
export function buildSessionSuccessBody(result: string): string {
  return result || '✅ Agent session completed';
}

/**
 * Build the body of the failure comment posted when the Pi SDK resolves
 * a run with a non-empty `error` field (provider quota, rate limit, etc).
 * When the agent produced a partial result, append it before the error
 * notice so the user sees both.
 */
export function buildSessionErrorBody(result: string, error: string): string {
  return result
    ? `${result}\n\n---\n\n❌ Agent session ended with error: ${error}`
    : `❌ Agent session ended with error: ${error}`;
}

/**
 * Orchestrates the Pi agent execution flow.
 *
 * The orchestrator receives a pre-built configuration, retrieves the prompt,
 * manages the reaction lifecycle, executes the Pi agent, and finalizes the
 * result or error. All platform-specific operations are delegated to the
 * injected adapters.
 */
export class ActionOrchestrator {
  constructor(
    private readonly config: PiConfig,
    private readonly logger: Logger,
    private readonly outputSink: OutputSink,
    private readonly git: GitAdapter,
    private readonly piAgentFactory: PiAgentFactory,
    private readonly platformProvider: PlatformProvider
  ) {}

  /**
   * Execute the complete action flow.
   *
   * @throws Rethrows any error from the Pi session after reporting it via outputSink.setFailed.
   *         Finalization errors (posting comment, deleting reaction) are caught and logged
   *         so they never prevent setFailed from running.
   */
  // fallow-ignore-next-line complexity
  async execute(): Promise<void> {
    this.logger.info(`running action v${formatActionVersion()}`);
    const startTime = this.git.getStartTime() ?? Temporal.Now.instant();
    let reaction: CreateReactionType | undefined;
    let prompt: string | undefined;
    // Hoisted so the catch block can recover partial usage from a run that
    // threw after consuming tokens. Stays `undefined` until the factory runs.
    let pi: PiAgent | undefined;

    try {
      prompt = await this.git.getPrompt(this.config.promptInput);
      if (!prompt) {
        throw new Error('No prompt found - cannot proceed');
      }

      reaction = await this.addReactionBestEffort();

      pi = this.piAgentFactory(this.config, this.logger, this.platformProvider);
      const { result, sessionStats, error } = await pi.run(prompt);

      await this.runSessionExports(pi);
      await this.runSessionShare();

      if (error) {
        await this.handleSessionError(error, result, startTime, reaction, sessionStats);
        return;
      }

      this.logSessionBanner('✅ Agent session completed');
      const finalBody = buildSessionSuccessBody(result);
      await this.finalize(finalBody, this.config, startTime, reaction, sessionStats, true);
    } catch (e) {
      await this.handleUncaughtError(e, startTime, reaction, pi);
      throw e;
    }
  }

  /**
   * Add a reaction to the triggering event, logging (not throwing) on failure.
   * Reactions are best-effort: missing permissions on the token shouldn't
   * abort the run.
   */
  private async addReactionBestEffort(): Promise<CreateReactionType | undefined> {
    try {
      return await this.git.addReaction();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.notice(`failed to add reaction: ${errorMessage}`);
      return undefined;
    }
  }

  /**
   * Run the optional session-export calls (HTML and/or JSONL) in parallel,
   * based on `config.exportSessionHtml` / `config.exportSessionJsonl`.
   */
  private async runSessionExports(pi: PiAgent): Promise<void> {
    const exportPromises: Promise<void>[] = [];
    // Sharing rides on the HTML export (the gist carries its bytes), so
    // share_session implicitly enables it regardless of export_session_html.
    const exportHtml = this.config.exportSessionHtml || this.config.shareSession;
    if (exportHtml) {
      exportPromises.push(this.exportSessionOutput(pi, 'html'));
    } else {
      this.logger.debug('[session-html] export disabled by configuration');
    }
    if (this.config.exportSessionJsonl) {
      exportPromises.push(this.exportSessionOutput(pi, 'jsonl'));
    } else {
      this.logger.debug('[session-jsonl] export disabled by configuration');
    }
    await Promise.all(exportPromises);
  }

  /**
   * Handle a session-level error (e.g. provider quota, rate limit). Posts
   * a failure comment, marks the action as failed, and returns. Does NOT
   * re-throw — the caller (`execute`) returns normally after this.
   */
  private async handleSessionError(
    error: string,
    result: string,
    startTime: Temporal.Instant,
    reaction: CreateReactionType | undefined,
    sessionStats: SessionStats | undefined
  ): Promise<void> {
    this.logSessionBanner(`❌ Agent session ended with error: ${error}`);
    const body = buildSessionErrorBody(result, error);
    await this.finalize(body, this.config, startTime, reaction, sessionStats, false);
    this.outputSink.setFailed(new Error(error));
  }

  /**
   * Handle an uncaught error: post the error message as a comment
   * (best-effort), mark the action as failed. The caller still re-throws
   * the original error after this returns.
   *
   * When a `PiAgent` is available (i.e. the failure happened during or after
   * `pi.run()`), partial session usage is recovered so token consumption
   * from a run that threw mid-turn isn't silently lost. The recovered stats
   * flow through {@link finalize}, surfacing in the action outputs, logs, and
   * comment footer just like a successful run.
   */
  // fallow-ignore-next-line complexity
  private async handleUncaughtError(
    e: unknown,
    startTime: Temporal.Instant,
    reaction: CreateReactionType | undefined,
    pi?: PiAgent
  ): Promise<void> {
    const errorMessage = e instanceof Error ? e.message : String(e);

    // Attempt to recover partial session usage even when prompt() rejected,
    // so token consumption from a failed run isn't silently lost.
    let sessionStats: SessionStats | undefined;
    if (pi) {
      try {
        sessionStats = pi.getSessionStats();
      } catch {
        // Stats unavailable — continue without them.
      }
    }

    try {
      await this.finalize(errorMessage, this.config, startTime, reaction, sessionStats, false);
    } catch (finalizeError) {
      const finalizeErrorMessage =
        finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
      this.logger.notice(`failed to finalize after error: ${finalizeErrorMessage}`);
    }

    this.outputSink.setFailed(e instanceof Error ? e : new Error(String(e)));
  }

  /**
   * Log a banner-style message surrounded by visual separators + leading
   * blank line. Used for both success and failure notifications.
   */
  private logSessionBanner(message: string): void {
    const bar = '════'.repeat(16);
    this.logger.info('');
    this.logger.info(bar);
    this.logger.info(message);
    this.logger.info(bar);
  }

  /**
   * Log a token-usage report to the action logs.
   *
   * The usage is also surfaced as action outputs and (when a comment is
   * posted) in the comment footer. Logging it explicitly guarantees
   * visibility for non-interactive runs where no comment is produced
   * (e.g. agent creates/updates a PR via a tool and returns empty text,
   * or there is no issue/PR context to comment on).
   */
  private logTokenUsageReport(sessionStats: SessionStats): void {
    const parts: string[] = [
      `input ${sessionStats.inputTokens.toLocaleString('en-US')}`,
      `output ${sessionStats.outputTokens.toLocaleString('en-US')}`,
      `total ${sessionStats.totalTokens.toLocaleString('en-US')}`,
    ];
    const cost = formatCost(sessionStats.cost, 4);
    if (cost) {
      parts.push(`cost $${cost}`);
    }
    this.logger.info(`📊 Token usage: ${parts.join(' · ')}`);
  }

  /**
   * Share the session as a secret GitHub Gist (pi `/share` equivalent).
   *
   * Uploads the exported session HTML to a gist and surfaces the viewer
   * link in three places: the logs footer (`info`), a GitHub notice
   * annotation (`notice`), and the job summary (`appendSummary`). Also
   * exposes `share_url` / `gist_url` / `gist_id` as action outputs.
   *
   * Runs only when {@link PiConfig.shareSession} is enabled. Reads the
   * HTML file produced by {@link exportSessionOutput}; if the export was
   * disabled or failed (file missing), or no gist token is configured,
   * the share is skipped with a notice — it never fails the run.
   */
  private async runSessionShare(): Promise<void> {
    if (!this.config.shareSession) {
      this.logger.debug('[session-share] sharing disabled by configuration');
      return;
    }

    const tag = 'session-share';
    const token = this.config.shareGistToken;
    if (!token) {
      this.logger.notice(
        `[${tag}] skipped: no gist token provided (set share_gist_token to a GitHub PAT/App token with gist scope)`
      );
      return;
    }

    // Reconstruct the HTML export path (same path exportSessionOutput writes).
    const htmlPath = path.join(this.outputSink.getExportDirectory('html'), 'session.html');
    if (!fs.existsSync(htmlPath)) {
      this.logger.notice(`[${tag}] skipped: session HTML export not found at ${htmlPath}`);
      return;
    }

    let content: string;
    try {
      content = fs.readFileSync(htmlPath, 'utf8');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.notice(`[${tag}] skipped: failed to read session HTML: ${msg}`);
      return;
    }

    const viewerUrl = this.config.shareViewerUrl ?? DEFAULT_SHARE_VIEWER_URL;
    try {
      const gist = await createSessionGist({ token, content }, viewerUrl);
      this.logger.info(`[${tag}] shared session as gist ${gist.id}: ${gist.gistUrl}`);
      this.logger.info(`[${tag}] view session: ${gist.shareUrl}`);
      this.logger.notice(gist.shareUrl);
      this.outputSink.setOutput('share_url', gist.shareUrl);
      this.outputSink.setOutput('gist_url', gist.gistUrl);
      this.outputSink.setOutput('gist_id', gist.id);
      await this.outputSink.appendSummary?.(`🔗 **Session:** ${gist.shareUrl}\n`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.notice(`[${tag}] failed to share session: ${msg}`);
    }
  }

  /**
   * Export session output for a given format (HTML or JSONL).
   *
   * Shared implementation for session exports: creates the export directory
   * via the output sink, calls the appropriate export method on the Pi agent,
   * sets the action output, and logs success/failure.
   */
  private async exportSessionOutput(pi: PiAgent, format: 'html' | 'jsonl'): Promise<void> {
    const tag = `session-${format}`;
    const formatLabel = format.toUpperCase();
    const outputDir = this.outputSink.getExportDirectory(format);
    const outputPath = path.join(outputDir, `session.${format}`);

    try {
      fs.mkdirSync(outputDir, { recursive: true });
      const exportFn = format === 'html' ? pi.exportSessionHtml : pi.exportSessionJsonl;
      await exportFn.call(pi, outputPath);
      this.logger.info(`[${tag}] exported session ${formatLabel} to ${outputPath}`);
      this.outputSink.setOutput(`session_${format}_path`, outputPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.notice(`[${tag}] failed to export ${formatLabel}: ${msg}`);
    }
  }

  /**
   * Finalize execution by posting the result/error as a comment and setting action outputs.
   */
  // fallow-ignore-next-line complexity
  private async finalize(
    body: string,
    config: PiConfig,
    startTime: Temporal.Instant,
    reaction: CreateReactionType | undefined,
    sessionStats: SessionStats | undefined,
    success: boolean
  ): Promise<void> {
    try {
      if (reaction) {
        await this.git.deleteReaction(reaction);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.logger.notice(`failed to delete reaction: ${errorMessage}`);
    }

    this.outputSink.setOutput('response', body);
    this.outputSink.setOutput('success', success);

    if (sessionStats !== undefined) {
      this.outputSink.setOutput('input_tokens', sessionStats.inputTokens);
      this.outputSink.setOutput('output_tokens', sessionStats.outputTokens);
      this.outputSink.setOutput('cost', sessionStats.cost);
      this.logTokenUsageReport(sessionStats);
    }

    const executionDuration = startTime.until(Temporal.Now.instant());
    this.outputSink.setOutput('duration_seconds', executionDuration.total('seconds'));

    const metadata: CommentMetadata = {
      actionVersion: getActionVersion(),
      provider: config.provider,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      executionDuration,
    };

    if (sessionStats !== undefined) {
      metadata.sessionStats = sessionStats;
    }

    await this.git.createFinalComment(body, metadata);
  }
}

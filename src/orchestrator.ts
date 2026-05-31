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
import type { CreateReactionType, PlatformProvider } from './platform';

declare const __VERSION__: string;

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
  async execute(): Promise<void> {
    this.logger.info(`running action v${__VERSION__}`);
    const startTime = this.git.getStartTime() ?? Temporal.Now.instant();
    let reaction: CreateReactionType | undefined;
    let prompt: string | undefined;

    try {
      prompt = await this.git.getPrompt(this.config.promptInput);

      if (!prompt) {
        throw new Error('No prompt found - cannot proceed');
      }

      try {
        reaction = await this.git.addReaction();
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        this.logger.notice(`failed to add reaction: ${errorMessage}`);
      }

      const pi = this.piAgentFactory(this.config, this.logger, this.platformProvider);
      const { result, sessionStats } = await pi.run(prompt);

      const exportPromises: Promise<void>[] = [];
      if (this.config.exportSessionHtml) {
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

      this.logger.info('\n');
      this.logger.info('════════════════════════════════════════════════════════════════');
      this.logger.info('✅ Agent session completed');
      this.logger.info('════════════════════════════════════════════════════════════════');

      // Ensure we always post a final comment — when the agent only used tools
      // (e.g. created/updated a PR) the text response may be empty.
      const finalBody = result || '✅ Agent session completed';
      await this.finalize(finalBody, this.config, startTime, reaction, sessionStats, true);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      // Try to post error as comment. Wrap in its own try-catch so that
      // a failure to finalize (e.g. network/API down after a timeout) does
      // NOT prevent setFailed from running. The action must always signal
      // failure to the CI runner, even when we cannot leave a comment.
      try {
        await this.finalize(errorMessage, this.config, startTime, reaction, undefined, false);
      } catch (finalizeError) {
        const finalizeErrorMessage =
          finalizeError instanceof Error ? finalizeError.message : String(finalizeError);
        this.logger.notice(`failed to finalize after error: ${finalizeErrorMessage}`);
      }

      // Mark the action as failed and re-throw the original error
      this.outputSink.setFailed(e as Error);
      throw e;
    }
  }

  /**
   * Export session output for a given format (HTML or JSONL).
   *
   * Shared implementation for session exports: creates the export directory
   * via the output sink, calls the appropriate export method on the Pi agent,
   * sets the action output, and logs success/failure.
   */
  private async exportSessionOutput(
    pi: PiAgent,
    format: 'html' | 'jsonl'
  ): Promise<void> {
    const tag = `session-${format}`;
    const formatLabel = format.toUpperCase();
    const outputDir = this.outputSink.getExportDirectory(format);
    const outputPath = path.join(outputDir, `session.${format}`);

    try {
      fs.mkdirSync(outputDir, { recursive: true });
      const exportFn =
        format === 'html' ? pi.exportSessionHtml : pi.exportSessionJsonl;
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
    }

    const executionDuration = startTime.until(Temporal.Now.instant());
    this.outputSink.setOutput('duration_seconds', executionDuration.total('seconds'));

    const metadata: CommentMetadata = {
      actionVersion: __VERSION__,
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

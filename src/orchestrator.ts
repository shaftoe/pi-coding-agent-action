/**
 * @file Action orchestrator with testable business logic.
 *
 * Separates orchestration flow (what happens and in what order) from
 * implementation details (how we talk to GitHub, Core, or Pi). This enables
 * comprehensive unit testing of the action's behavior without mocking
 * the external dependencies themselves.
 */

import { Temporal } from '@js-temporal/polyfill';
import {
  type CommentMetadata,
  type CoreAdapter,
  type GitAdapter,
  type PiAgentFactory,
  type PiConfig,
  type SessionStats,
} from './types';
import type { CreateReactionType, PlatformProvider } from './platform';

declare const __VERSION__: string;

/**
 * Orchestrates the GitHub Action execution flow.
 *
 * The orchestrator gathers configuration, retrieves the prompt, manages the
 * reaction lifecycle, executes the Pi agent, and finalizes the result or error.
 */
export class ActionOrchestrator {
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
    const config = this.gatherConfig();
    let reaction: CreateReactionType | undefined;
    let prompt: string | undefined;

    try {
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
      const { result, sessionStats } = await pi.run(prompt);

      await this.finalize(result, config, startTime, reaction, sessionStats);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      // Try to post error as comment. Wrap in its own try-catch so that
      // a failure to finalize (e.g. network/API down after a timeout) does
      // NOT prevent setFailed from running. The action must always signal
      // failure to the CI runner, even when we cannot leave a comment.
      try {
        await this.finalize(errorMessage, config, startTime, reaction, undefined);
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
   */
  private gatherConfig(): PiConfig {
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

    return {
      provider: this.core.getInput('provider'),
      model: this.core.getInput('model'),
      token: this.core.getInput('token'),
      thinkingLevel: this.core.getInput('thinking_level') ?? 'off',
      promptInput: this.core.getInput('prompt'),
      ...(extensions?.length ? { extensions } : {}),
      loadBuiltinExtensions,
    };
  }

  /**
   * Finalize execution by posting the result/error as a comment.
   */
  private async finalize(
    body: string,
    config: PiConfig,
    startTime: Temporal.Instant,
    reaction?: CreateReactionType,
    sessionStats?: SessionStats
  ): Promise<void> {
    try {
      if (reaction) {
        await this.git.deleteReaction(reaction);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      this.core.notice(`failed to delete reaction: ${errorMessage}`);
    }

    const metadata: CommentMetadata = {
      actionVersion: __VERSION__,
      provider: config.provider,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      executionDuration: startTime.until(Temporal.Now.instant()),
    };

    if (sessionStats !== undefined) {
      metadata.sessionStats = sessionStats;
    }

    await this.git.createFinalComment(body, metadata);
  }
}

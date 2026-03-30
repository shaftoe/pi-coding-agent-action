/**
 * @file Action orchestrator with testable business logic.
 *
 * Separates orchestration flow (what happens and in what order) from
 * implementation details (how we talk to GitHub, Core, or Pi). This enables
 * comprehensive unit testing of the action's behavior without mocking
 * the external dependencies themselves.
 */

import * as core from '@actions/core';
import { Temporal } from '@js-temporal/polyfill';
import {
  type CommentMetadata,
  type CoreAdapter,
  type GitHubAdapter,
  type PiAgentFactory,
  type PiConfig,
  type SessionStats,
} from './types';
import type { CreateReactionType } from './github/reactions';
import { getActionVersion, getPiSdkVersion } from './utils/version';

/**
 * Orchestrates the GitHub Action execution flow.
 *
 * The orchestrator gathers configuration, retrieves the prompt, manages the
 * reaction lifecycle, executes the Pi agent, and finalizes the result or error.
 */
export class ActionOrchestrator {
  constructor(
    private readonly core: CoreAdapter,
    private readonly github: GitHubAdapter,
    private readonly piAgentFactory: PiAgentFactory
  ) {}

  /**
   * Execute the complete action flow.
   *
   * @throws Rethrows any error from the Pi session after reporting it via core.setFailed.
   * @throws Rethrows any error from finalize when posting final comment fails.
   */
  async execute(): Promise<void> {
    const startTime = this.github.getStartTime() ?? Temporal.Now.instant();
    const config = this.gatherConfig();
    let reaction: CreateReactionType | undefined;
    let prompt: string | undefined;

    try {
      prompt = await this.github.getPrompt(config.promptInput);

      if (!prompt) {
        throw new Error('No prompt found - cannot proceed');
      }

      try {
        reaction = await this.github.addReaction();
      } catch {
        // Silently ignore reaction errors - don't stop execution
      }

      const pi = this.piAgentFactory(config);
      const result = await pi.prompt(prompt);

      // Get session stats gracefully - don't let errors prevent posting result
      let sessionStats: SessionStats | undefined;
      try {
        sessionStats = pi.getSessionStats();
      } catch (statsError) {
        // Stats collection is non-critical - log and continue
        core.debug(`Failed to retrieve session stats: ${statsError}`);
      }

      await this.finalize(
        result,
        config,
        startTime,
        reaction,
        sessionStats,
        getActionVersion(),
        getPiSdkVersion()
      );
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);

      // Try to post error as comment. If this fails, the action will fail without
      // a user-facing comment (acceptable - we can't communicate).
      await this.finalize(
        errorMessage,
        config,
        startTime,
        reaction,
        undefined,
        getActionVersion(),
        getPiSdkVersion()
      );

      // Mark the action as failed and re-throw the original error
      this.core.setFailed(e as Error);
      throw e;
    }
  }

  /**
   * Gather configuration from core inputs.
   */
  private gatherConfig(): PiConfig {
    return {
      provider: this.core.getInput('provider'),
      model: this.core.getInput('model'),
      token: this.core.getInput('token'),
      thinkingLevel: this.core.getInput('thinking_level') ?? 'off',
      promptInput: this.core.getInput('prompt'),
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
    sessionStats?: SessionStats,
    actionVersion?: string,
    piSdkVersion?: string
  ): Promise<void> {
    try {
      if (reaction) {
        await this.github.deleteReaction(reaction);
      }
    } catch {
      // Silently ignore reaction deletion errors - don't stop execution
    }

    const metadata: CommentMetadata = {
      provider: config.provider,
      model: config.model,
      thinkingLevel: config.thinkingLevel,
      executionDuration: startTime.until(Temporal.Now.instant()),
    };

    if (sessionStats !== undefined) {
      metadata.sessionStats = sessionStats;
    }
    if (actionVersion !== undefined) {
      metadata.actionVersion = actionVersion;
    }
    if (piSdkVersion !== undefined) {
      metadata.piSdkVersion = piSdkVersion;
    }

    await this.github.createFinalComment(body, metadata);
  }
}

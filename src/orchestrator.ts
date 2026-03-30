/**
 * @file Action orchestrator with testable business logic.
 *
 * Separates orchestration flow (what happens and in what order) from
 * implementation details (how we talk to GitHub, Core, or Pi). This enables
 * comprehensive unit testing of the action's behavior without mocking
 * the external dependencies themselves.
 */

import { Temporal } from '@js-temporal/polyfill';
import type {
  CommentMetadata,
  CoreAdapter,
  GitHubAdapter,
  PiAgentFactory,
  PiConfig,
  SessionStats,
} from './types';
import type { CreateReactionType } from './github/reactions';

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
   */
  async execute(): Promise<void> {
    const startTime = this.github.getStartTime() ?? Temporal.Now.instant();
    const config = this.gatherConfig();
    const prompt = await this.github.getPrompt(config.promptInput);
    let reaction: CreateReactionType | undefined;
    let result: string;

    try {
      if (!prompt) {
        throw new Error('No prompt found - cannot proceed');
      }

      try {
        reaction = await this.github.addReaction();
      } catch {
        // Silently ignore reaction errors - don't stop execution
      }

      const pi = this.piAgentFactory(config);
      result = await pi.prompt(prompt);
      const sessionStats = pi.getSessionStats();
      await this.finalize(result, config, startTime, reaction, sessionStats);
    } catch (e) {
      await this.finalize(e instanceof Error ? e.message : String(e), config, startTime, reaction);
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
    sessionStats?: SessionStats
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

    if (sessionStats) {
      metadata.sessionStats = sessionStats;
    }

    await this.github.createFinalComment(body, metadata);
  }
}

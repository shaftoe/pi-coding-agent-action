/**
 * @file Shared type definitions and interfaces for testability.
 *
 * Defines adapter interfaces that abstract external dependencies (GitHub Core, Pi agent)
 * to enable dependency injection and unit testing of orchestration logic.
 */

import type { Temporal } from '@js-temporal/polyfill';
import type { CreateReactionType } from './github/reactions';

/**
 * Adapter interface for @actions/core operations.
 *
 * Provides a testable wrapper around core.getInput() and core.setFailed().
 */
export interface CoreAdapter {
  /** Retrieve an action input by name. */
  getInput(name: string): string;
  /** Mark the workflow run as failed with an error message. */
  setFailed(error: Error): void;
}

/**
 * Adapter interface for GitHub operations.
 *
 * Provides a testable wrapper around the github module functions.
 */
export interface GitHubAdapter {
  /** Add an "eyes" reaction to the triggering comment. */
  addReaction(): Promise<CreateReactionType | undefined>;
  /** Remove a previously added reaction. */
  deleteReaction(reaction: CreateReactionType | undefined): Promise<void>;
  /** Create the final comment with optional metadata. */
  createFinalComment(body: string, metadata: CommentMetadata): Promise<void>;
  /** Get the prompt from input or comment context. */
  getPrompt(inputPrompt?: string): Promise<string | undefined>;
  /** Get the start time from the GitHub event payload. */
  getStartTime(): Temporal.Instant | undefined;
}

/**
 * Adapter interface for the Pi agent.
 *
 * Provides a simplified interface for Pi prompt execution.
 */
export interface PiAgent {
  /** Send a prompt and receive the AI response. */
  prompt(text: string): Promise<string>;
  /** Get session statistics including token usage. */
  getSessionStats(): SessionStats | undefined;
}

/**
 * Session statistics including token usage.
 */
export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
}

/**
 * Factory function for creating Pi agents with the given configuration.
 */
export type PiAgentFactory = (config: PiConfig) => PiAgent;

/**
 * Configuration for the Pi agent.
 */
export interface PiConfig {
  provider: string;
  model: string;
  token: string;
  thinkingLevel: string;
  promptInput: string;
}

/**
 * Metadata to include in the final comment footer.
 */
export interface CommentMetadata {
  /** LLM provider (e.g., "anthropic", "openai") */
  provider?: string;
  /** Model identifier (e.g., "claude-sonnet-4-5") */
  model?: string;
  /** Thinking/reasoning level (e.g., "off", "low", "medium", "high") */
  thinkingLevel?: string;
  /** Total execution time as a Temporal Duration */
  executionDuration?: Temporal.Duration;
  /** Session statistics including token usage */
  sessionStats?: SessionStats;
}

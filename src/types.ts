/**
 * @file Shared type definitions and interfaces for testability.
 *
 * Defines adapter interfaces that abstract external dependencies (GitHub Core, Pi agent)
 * to enable dependency injection and unit testing of orchestration logic.
 */

import type { Temporal } from '@js-temporal/polyfill';
import type { CreateReactionType, PlatformProvider } from './platform';

/**
 * Adapter interface for @actions/core operations.
 *
 * Provides a testable wrapper around core operations including input retrieval,
 * logging, and workflow status management.
 */
export interface CoreAdapter {
  /** Retrieve an action input by name. */
  getInput(name: string): string;
  /** Mark the workflow run as failed with an error message. */
  setFailed(error: Error): void;
  /** Set an action output. */
  setOutput(name: string, value: string | number | boolean): void;
  /** Log a notice message. */
  notice(message: string): void;
  /** Log a debug message (only visible when debug logging is enabled). */
  debug(message: string): void;
  /** Log an info message. */
  info(message: string): void;
  /** Log a warning message. */
  warning(message: string): void;
}

/**
 * Adapter interface for git hosting platform operations.
 *
 * Provides a testable wrapper around the git module functions.
 * Supports GitHub, Codeberg, and self-hosted Forgejo instances.
 */
export interface GitAdapter {
  /** Add an "eyes" reaction to the triggering comment. */
  addReaction(): Promise<CreateReactionType | undefined>;
  /** Remove a previously added reaction. */
  deleteReaction(reaction: CreateReactionType | undefined): Promise<void>;
  /** Create the final comment with optional metadata. */
  createFinalComment(body: string, metadata: CommentMetadata): Promise<void>;
  /** Get the prompt from input or comment context. */
  getPrompt(inputPrompt?: string): Promise<string | undefined>;
  /** Get the start time from the platform event payload. */
  getStartTime(): Temporal.Instant | undefined;
}

/**
 * Adapter interface for the Pi agent.
 *
 * Provides a simplified interface for Pi prompt execution.
 */
export interface PiAgent {
  /** Run the agent with the given text prompt and receive the AI response with session statistics. */
  run(text: string): Promise<PromptResult>;
  /** Export the session as a self-contained HTML file to the given path. */
  exportSessionHtml(outputPath: string): Promise<string>;
  /** Export the session as a JSONL file to the given path. */
  exportSessionJsonl(outputPath: string): string;
}

/**
 * Session statistics including token usage.
 */
export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  /** The version of the Pi agent that generated this result */
  version: string;
}

/**
 * Result of running a Pi agent prompt, including the response text and session statistics.
 */
export interface PromptResult {
  /** The text response from the agent */
  result: string;
  /** Session statistics including token usage, if available */
  sessionStats: SessionStats | undefined;
}

/**
 * Factory function for creating Pi agents with the given configuration.
 *
 * Accepts CoreAdapter for logging within the Pi agent session, and
 * PlatformProvider for platform operations used by custom tools.
 */
export type PiAgentFactory = (
  config: PiConfig,
  core: CoreAdapter,
  provider: PlatformProvider
) => PiAgent;

/**
 * Subset of configuration used by the PR-diff tool.
 */
export interface DiffConfig {
  diffMaxLines?: number;
  diffMaxBytes?: number;
  diffIgnorePatterns?: string[];
}

/**
 * Configuration fields consumed by the resource loader.
 *
 * A purpose-built subset of {@link PiConfig} that carries everything the
 * loader needs — extensions, builtin-extension toggle, and diff limits —
 * without coupling to the full {@link PiConfig} type.
 */
export interface ResourceLoaderConfig extends DiffConfig {
  /** Optional array of extension sources (npm packages, git repos, or local paths). */
  extensions?: string[];
  /** Whether to load built-in GitHub extensions. Defaults to `true`. */
  loadBuiltinExtensions?: boolean;
}

/**
 * Configuration for the Pi agent.
 */
export interface PiConfig extends DiffConfig {
  provider: string;
  model: string;
  token: string;
  thinkingLevel: string;
  promptInput: string;
  extensions?: string[];
  loadBuiltinExtensions?: boolean;
  /**
   * Controls which tools are loaded into the session.
   * - `undefined` (default): load all available tools
   * - `string[]`: load only the listed tools (validated against available tools after extension loading)
   */
  loadedTools?: string[];
  baseUrl?: string;
  exportSessionHtml?: boolean;
  exportSessionJsonl?: boolean;
  autoCompaction?: boolean;
}

/**
 * Metadata to include in the final comment footer.
 */
export interface CommentMetadata {
  /** The version of this action */
  actionVersion?: string;
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

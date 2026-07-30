/**
 * @file Shared type definitions and interfaces for testability.
 *
 * Defines adapter interfaces that abstract external dependencies (GitHub Core, Pi agent)
 * to enable dependency injection and unit testing of orchestration logic.
 */

import type { Temporal } from '@js-temporal/polyfill';
import type { CreateReactionType, PlatformProvider } from './platform';

/**
 * Platform-neutral logging interface.
 *
 * Provides a minimal logging abstraction that can be implemented by any
 * frontend (GitHub Action, CLI, web UI). Decouples library code from
 * `@actions/core` logging functions.
 *
 * Optional `startGroup`/`endGroup` methods allow collapsible log grouping
 * where supported; they are no-ops when not implemented.
 */
export interface Logger {
  /** Log a debug-level message (only visible when debug logging is enabled). */
  debug(message: string): void;
  /** Log an informational message. */
  info(message: string): void;
  /** Log a warning message. */
  warning(message: string): void;
  /** Log a notice-level message (visible but non-blocking). */
  notice(message: string): void;
  /** Log an error message. */
  error(message: string): void;
  /** Start a collapsible log group. No-op if not supported. */
  startGroup?(title: string): void;
  /** End a collapsible log group. No-op if not supported. */
  endGroup?(): void;
}

/**
 * Output and failure handling interface.
 *
 * Abstracts how results are exported (GitHub Action outputs, HTTP responses,
 * CLI exit codes, etc.) and how failure is reported.
 */
export interface OutputSink {
  /** Set a named output (e.g., "response", "success", "duration_seconds"). */
  setOutput(name: string, value: string | number | boolean): void;
  /** Mark the run as failed. */
  setFailed(error: Error): void;
  /** Resolve a temp directory for session exports of the given format. */
  getExportDirectory(format: 'html' | 'jsonl'): string;
  /**
   * Append markdown to the platform's job summary (e.g. GitHub Actions'
   * `$GITHUB_STEP_SUMMARY`). Optional — no-op when not implemented.
   */
  appendSummary?(markdown: string): void | Promise<void>;
}

/**
 * Adapter interface for @actions/core operations.
 *
 * Extends the platform-neutral {@link Logger} interface with GitHub
 * Actions-specific operations (input retrieval, output setting, failure
 * reporting). This interface is only used by the GitHub Action frontend;
 * library code depends on {@link Logger} instead.
 */
export interface CoreAdapter extends Logger {
  /** Retrieve an action input by name. */
  getInput(name: string): string;
  /** Mark the workflow run as failed with an error message. */
  setFailed(error: Error): void;
  /** Set an action output. */
  setOutput(name: string, value: string | number | boolean): void;
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
  /**
   * Return the session statistics accumulated so far.
   *
   * Safe to call even after {@link run} rejected (e.g. the underlying
   * `prompt()` threw mid-turn): the session object persists and may still
   * hold partial token usage. Returns `undefined` when the session was
   * never initialised or stats are unavailable.
   */
  getSessionStats(): SessionStats | undefined;
  /** Export the session as a self-contained HTML file to the given path. */
  exportSessionHtml(outputPath: string): Promise<string>;
  /** Export the session as a JSONL file to the given path. */
  exportSessionJsonl(outputPath: string): Promise<string>;
  /** Release the underlying session and any provider resources it owns. */
  dispose(): void;
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
  /**
   * Session-level error that ended the agent run early (e.g., provider
   * quota exceeded, rate limit, authentication failure).
   *
   * The Pi SDK resolves `session.prompt()` normally even when the provider
   * returns an unrecoverable error — the error is captured in the last
   * assistant message's `stopReason` and `errorMessage` fields. When this
   * field is set, the orchestrator should report the error to the user
   * instead of posting a misleading success comment.
   */
  error: string | undefined;
}

/**
 * Factory function for creating Pi agents with the given configuration.
 *
 * Accepts CoreAdapter for logging within the Pi agent session, and
 * PlatformProvider for platform operations used by custom tools.
 */
export type PiAgentFactory = (
  config: PiConfig,
  logger: Logger,
  provider: PlatformProvider
) => PiAgent;

/**
 * Callbacks for streaming output during agent execution.
 *
 * Abstracts how real-time thinking deltas and prompt-completion signals
 * are delivered, so library code never calls `process.stdout.write`
 * directly. The GitHub Action frontend routes events to stdout;
 * alternative frontends (web UI, GitHub App) can route to SSE/WebSocket.
 */
export interface AgentEvents {
  /** Called for each thinking delta during agent execution. */
  onThinkingDelta?(delta: string): void;
  /** Called when a thinking segment ends. Frontends can use this to flush or
   *  terminate the stdout line before any ::debug:: workflow commands fire. */
  onThinkingComplete?(): void;
  /** Called once after the prompt completes (e.g. to flush newlines). */
  onPromptComplete?(): void;
}

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
  /** Override the default system prompt. */
  systemPrompt?: string;
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;
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
  /**
   * Share the session like pi's `/share` command: upload the exported
   * HTML to a secret GitHub Gist and surface a pi.dev-style viewer link.
   *
   * Uses {@link githubToken} to create the gist. The default Actions
   * `GITHUB_TOKEN` cannot create gists, so `github_token` must be a
   * classic PAT (`gist` scope), fine-grained PAT (Account → Gists:
   * read/write), or GitHub App token when this is enabled. When enabled,
   * {@link exportSessionHtml} is auto-enabled since the gist carries the
   * HTML export's bytes.
   */
  shareSession?: boolean;
  /**
   * GitHub API token (the `github_token` action input). Used for all
   * GitHub REST API operations, including gist creation when
   * {@link shareSession} is enabled.
   */
  githubToken?: string;
  /**
   * Storage backend for session sharing: `'github'` (default) or
   * `'opengist'`. When `'opengist'`, the exported session HTML is uploaded
   * to a self-hosted Opengist instance (via {@link shareGistApiUrl}) instead
   * of GitHub Gists, and the `share_url` points at a self-rendering raw-HTML
   * link rather than the pi.dev viewer (which only reads GitHub gists).
   */
  shareGistProvider?: 'github' | 'opengist';
  /**
   * API URL for the share gist provider. For `'opengist'` this is the
   * instance's create endpoint, e.g. `https://gist.l3x.in/api/gists`
   * (required when {@link shareGistProvider} is `'opengist'`). For GitHub,
   * an optional override (defaults to `https://api.github.com/gists`).
   */
  shareGistApiUrl?: string;
  /**
   * Token used to create the shared gist. For Opengist, an access token
   * (`og_…`) with the `gist:write` scope — required for the opengist provider
   * (there is no {@link githubToken} fallback). For the GitHub provider,
   * falls back to {@link githubToken} when unset, so a single token suffices.
   */
  shareGistToken?: string;
  /** Override the default system prompt. */
  systemPrompt?: string;
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Explicit pull request number for workflow_dispatch support.
   *
   * When provided, the action targets the specified PR instead of deriving
   * the issue/PR number from the triggering event. All context-dependent
   * tools (diff, thread, review, etc.) use this number.
   */
  prNumber?: number;
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

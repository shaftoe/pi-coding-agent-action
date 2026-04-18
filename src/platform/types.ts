/**
 * @file Platform abstraction types for multi-platform support.
 *
 * Defines interfaces that abstract platform-specific operations (context
 * extraction, API client creation) to support GitHub, Codeberg, and
 * self-hosted Forgejo instances.
 *
 * All three platforms use GitHub-compatible REST APIs, so the abstraction
 * focuses on context extraction and API endpoint configuration rather than
 * full API abstraction.
 */

import type { Temporal } from '@js-temporal/polyfill';
import type { IssueOrPRThread, GetIssueOrPRThreadParams } from '../git/context';
import type { CreatePullRequestParams, CreatePullRequestDetails } from '../git/pull-request';
import type { UpdatePullRequestParams, UpdatePullRequestDetails } from '../git/pull-request-update';
import type { CreateReactionType } from '../git/reactions';
import type { CommentMetadata } from '../types';

/**
 * Platform identifiers supported by this action.
 */
export type PlatformType = 'github' | 'codeberg' | 'forgejo';

/**
 * Platform-agnostic context information extracted from the CI/CD environment.
 *
 * Abstracts the event payload, repository info, and other context needed
 * by the action, regardless of which platform (GitHub, Codeberg, Forgejo)
 * triggered the workflow.
 */
export interface PlatformContext {
  /** Repository owner and name */
  repo: { owner: string; repo: string };
  /** Current issue or PR number */
  issue: { number: number };
  /** The event that triggered the workflow */
  eventName: string;
  /** The full event payload */
  payload: Record<string, unknown>;
  /** The server URL (e.g. https://github.com, https://codeberg.org) */
  serverUrl: string;
  /** The current workflow run ID */
  runId: number;
  /** The workspace directory path */
  workspace: string;
}

/**
 * Platform provider interface for multi-platform support.
 *
 * Encapsulates all platform-specific operations needed by the action.
 * Each supported platform (GitHub, Codeberg, Forgejo) provides its own
 * implementation.
 *
 * The provider is responsible for:
 * - Detecting which platform the action is running on
 * - Extracting context from the platform's CI/CD environment
 * - Creating authenticated API clients for the platform
 * - Providing platform-specific implementations of common operations
 */
export interface PlatformProvider {
  /** The detected platform type */
  readonly type: PlatformType;

  /**
   * Get the platform context (repo info, event payload, etc.).
   *
   * Extracts context from the platform's CI/CD environment variables
   * and event payload.
   */
  getContext(): PlatformContext;

  /**
   * Add an "eyes" reaction to the triggering comment.
   *
   * @returns The reaction response, or undefined if no comment is present.
   */
  addReaction(): Promise<CreateReactionType | undefined>;

  /**
   * Remove a previously added reaction.
   *
   * @param reaction - The reaction to remove.
   */
  deleteReaction(reaction: CreateReactionType | undefined): Promise<void>;

  /**
   * Create the final comment with optional metadata footer.
   *
   * @param body - The comment body.
   * @param metadata - Optional metadata to include in the footer.
   */
  createFinalComment(body: string, metadata: CommentMetadata): Promise<void>;

  /**
   * Get the prompt from input or comment context.
   *
   * @param inputPrompt - Optional prompt input override.
   * @returns The prompt string, or undefined if no prompt is available.
   */
  getPrompt(inputPrompt?: string): Promise<string | undefined>;

  /**
   * Get the start time from the platform event payload.
   *
   * @returns The start instant, or undefined if unavailable.
   */
  getStartTime(): Temporal.Instant | undefined;

  /**
   * Create a pull request.
   *
   * @param params - Pull request creation parameters.
   * @returns The result of the PR creation.
   */
  createPullRequest(
    params: CreatePullRequestParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: CreatePullRequestDetails }>;

  /**
   * Update an existing pull request.
   *
   * @param params - Pull request update parameters.
   * @returns The result of the PR update.
   */
  updatePullRequest(
    params: UpdatePullRequestParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: UpdatePullRequestDetails }>;

  /**
   * Fetch the complete thread for an issue or pull request.
   *
   * @param params - Optional parameters to override defaults.
   * @returns The thread data, or undefined if not found.
   */
  getIssueOrPRThread(params?: GetIssueOrPRThreadParams): Promise<IssueOrPRThread | undefined>;
}

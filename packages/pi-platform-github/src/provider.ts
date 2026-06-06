/**
 * @file GitHub/Codeberg/Forgejo platform provider implementation.
 *
 * Provides the default platform implementation that works with GitHub,
 * Codeberg, and self-hosted Forgejo instances. All three platforms use
 * GitHub-compatible REST APIs and the same CI/CD environment variables
 * (GITHUB_* env vars), so a single implementation covers all of them.
 *
 * Platform detection is performed by the pure `detectPlatform(serverUrl)`
 * function, which is invoked at the call site (e.g. in `pi-action/run.ts`).
 * Library code does not read environment variables directly.
 */

import { addReaction, deleteReaction } from './reactions';
import { createFinalComment } from './comments';
import { getPrompt, getStartTimeFromContext } from './context';
import { createPullRequest } from './tools/pull-request';
import { updatePullRequest } from './tools/pull-request-update';
import { getIssueOrPRThread } from './tools/thread';
import { fetchPRDiff } from './tools/pr-diff';
import { createReview } from './tools/review';
import { getCIStatus } from './tools/get-ci-status';
import { getWorkflowRunLogs } from './tools/get-workflow-run-logs';
import type { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@alexanderfortin/pi-orchestrator';
import type {
  PlatformProvider,
  PlatformType,
  PlatformContext,
} from '@alexanderfortin/pi-orchestrator';
import type { GitHubModuleDeps } from './types';
import type { CommentMetadata } from '@alexanderfortin/pi-orchestrator';
import type { GitHubReactionType } from './reactions';
import type { IssueOrPRThread, GetIssueOrPRThreadParams } from './types';
import type { CreatePullRequestParams, CreatePullRequestDetails } from './types';
import type { UpdatePullRequestParams, UpdatePullRequestDetails } from './types';
import type { CreateReviewParams, CreateReviewDetails } from './tools/review';
import type { GetCIStatusParams, GetCIStatusDetails } from './tools/get-ci-status';
import type {
  GetWorkflowRunLogsParams,
  GetWorkflowRunLogsDetails,
} from './tools/get-workflow-run-logs';

/**
 * Detect the current platform based on a server URL.
 *
 * Pure function — no environment access. Callers (typically the action/
 * CLI entry point) are responsible for reading the URL from the
 * appropriate source (e.g. `github.context.serverUrl`) and passing it in.
 *
 * @param serverUrl - The platform server URL (e.g. 'https://github.com').
 * @returns The detected platform type.
 */
// fallow-ignore-next-line complexity
export function detectPlatform(serverUrl: string): PlatformType {
  if (!serverUrl) {
    throw new Error('detectPlatform requires a server URL, got an empty string.');
  }

  // Check for known Forgejo/Gitea indicators
  if (serverUrl.includes('codeberg')) {
    return 'codeberg';
  }
  if (serverUrl.includes('forgejo') || serverUrl.includes('gitea')) {
    return 'forgejo';
  }

  // github.com and GitHub Enterprise (github.*.com patterns)
  if (serverUrl.includes('github.com')) {
    return 'github';
  }

  // Unknown server URL - cannot determine the platform
  throw new Error(
    `Unsupported platform server URL: ${serverUrl}. ` +
      `Expected one of: github.com, codeberg.org, or a URL containing 'forgejo'/'gitea'.`
  );
}

/**
 * Dependencies required to create a GitHub-compatible platform provider.
 *
 * Accepting these as explicit parameters decouples the provider from the
 * `@actions/github` singleton, enabling use in alternative frontends
 * (GitHub App, CLI, web UI).
 */
export interface GitHubPlatformDeps {
  /** Pre-authenticated Octokit instance (core + rest endpoint methods). */
  octokit: import('./types').OctokitInstance;
  /** Platform context extracted from the CI/CD environment or webhook. */
  context: PlatformContext;
  /** Logger for debug/info/warning output. */
  logger: Logger;
  /**
   * Trigger command string (e.g. '/pi ') for stripping invocation prefixes.
   * When omitted, defaults to '/pi '.
   */
  trigger?: string;
  /**
   * Explicit platform type. Required — library code does not read
   * environment variables. Use `detectPlatform(context.serverUrl)` at
   * the call site to derive it from the server URL.
   */
  platformType: PlatformType;
  /**
   * Branch name template for generating branch names in pull-request creation.
   * When omitted, uses the default template.
   */
  branchNameTemplate?: string;
}

/**
 * Create a GitHub-compatible platform provider.
 *
 * This implementation works with GitHub, Codeberg, and self-hosted Forgejo
 * instances since all three use the same CI/CD environment variables and
 * GitHub-compatible REST APIs.
 *
 * @param deps - Explicit dependencies (Octokit + context + logger).
 * @returns A PlatformProvider instance.
 */
export function createGitHubPlatformProvider(deps: GitHubPlatformDeps): PlatformProvider {
  const type = deps.platformType;

  // Use the provided deps directly — no fallbacks
  const resolvedContext = deps.context;
  const logger = deps.logger;
  const octokit = deps.octokit;

  // Resolve the trigger
  const trigger = deps?.trigger;

  // Build the deps bag that will be threaded through all sub-functions
  const moduleDeps: GitHubModuleDeps = {
    octokit,
    context: resolvedContext,
    logger,
    ...(trigger !== undefined ? { trigger } : {}),
    ...(deps.branchNameTemplate !== undefined
      ? { branchNameTemplate: deps.branchNameTemplate }
      : {}),
  };

  return {
    type,

    getContext(): PlatformContext {
      return resolvedContext;
    },

    async addReaction(): Promise<GitHubReactionType | undefined> {
      return addReaction(moduleDeps);
    },

    async deleteReaction(reaction: GitHubReactionType | undefined): Promise<void> {
      await deleteReaction(moduleDeps, reaction);
    },

    async createFinalComment(body: string, metadata: CommentMetadata): Promise<void> {
      await createFinalComment(moduleDeps, body, metadata);
    },

    async getPrompt(inputPrompt?: string): Promise<string | undefined> {
      return getPrompt(moduleDeps, inputPrompt);
    },

    getStartTime(): Temporal.Instant | undefined {
      return getStartTimeFromContext(moduleDeps);
    },

    async createPullRequest(
      params: CreatePullRequestParams
    ): Promise<{ content: { type: 'text'; text: string }[]; details: CreatePullRequestDetails }> {
      return createPullRequest(moduleDeps, params);
    },

    async updatePullRequest(
      params: UpdatePullRequestParams
    ): Promise<{ content: { type: 'text'; text: string }[]; details: UpdatePullRequestDetails }> {
      return updatePullRequest(moduleDeps, params);
    },

    async getIssueOrPRThread(
      params?: GetIssueOrPRThreadParams
    ): Promise<IssueOrPRThread | undefined> {
      return getIssueOrPRThread(moduleDeps, params);
    },

    async getPRDiff(
      owner: string,
      repo: string,
      pullNumber: number,
      ignoreFiles?: string[]
    ): Promise<string> {
      return fetchPRDiff(moduleDeps, owner, repo, pullNumber, ignoreFiles);
    },

    async createReview(
      params: CreateReviewParams
    ): Promise<{ content: { type: 'text'; text: string }[]; details: CreateReviewDetails }> {
      return createReview(moduleDeps, params);
    },

    async getCIStatus(
      params: GetCIStatusParams
    ): Promise<{ content: { type: 'text'; text: string }[]; details: GetCIStatusDetails }> {
      return getCIStatus(moduleDeps, params);
    },

    async getWorkflowRunLogs(
      params: GetWorkflowRunLogsParams
    ): Promise<{ content: { type: 'text'; text: string }[]; details: GetWorkflowRunLogsDetails }> {
      return getWorkflowRunLogs(moduleDeps, params);
    },
  };
}

/**
 * @file GitHub/Codeberg/Forgejo platform provider implementation.
 *
 * Provides the default platform implementation that works with GitHub,
 * Codeberg, and self-hosted Forgejo instances. All three platforms use
 * GitHub-compatible REST APIs and the same CI/CD environment variables
 * (GITHUB_* env vars), so a single implementation covers all of them.
 *
 * Platform detection is based on the GITHUB_SERVER_URL environment variable:
 * - https://github.com → 'github'
 * - https://codeberg.org → 'codeberg'
 * - Anything else → throws an error (unsupported platform)
 */

import * as github from '@actions/github';
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
import type { Logger } from '../../types';
import type { PlatformProvider, PlatformType, PlatformContext } from '../types';
import type { GitHubModuleDeps } from './types';
import type { CommentMetadata } from '../../types';
import type { CreateReactionType } from './reactions';
import type { IssueOrPRThread, GetIssueOrPRThreadParams } from './types';
import type { CreatePullRequestParams, CreatePullRequestDetails } from './tools/pull-request';
import type { UpdatePullRequestParams, UpdatePullRequestDetails } from './tools/pull-request-update';
import type { CreateReviewParams, CreateReviewDetails } from './tools/review';
import type { GetCIStatusParams, GetCIStatusDetails } from './tools/get-ci-status';
import type { GetWorkflowRunLogsParams, GetWorkflowRunLogsDetails } from './tools/get-workflow-run-logs';

/**
 * Detect the current platform based on the server URL.
 *
 * @returns The detected platform type.
 */
export function detectPlatform(): PlatformType {
  const serverUrl = process.env.GITHUB_SERVER_URL;
  if (!serverUrl) {
    throw new Error('GITHUB_SERVER_URL environment variable is not set. Cannot detect platform.');
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
  /** Pre-authenticated Octokit instance. */
  octokit: ReturnType<typeof import('@actions/github').getOctokit>;
  /** Platform context extracted from the CI/CD environment or webhook. */
  context: PlatformContext;
  /** Logger for debug/info/warning output. */
  logger: Logger;
}

/**
 * Create a GitHub-compatible platform provider.
 *
 * This implementation works with GitHub, Codeberg, and self-hosted Forgejo
 * instances since all three use the same CI/CD environment variables and
 * GitHub-compatible REST APIs.
 *
 * @param deps - Optional explicit dependencies (Octokit + context).
 *               When provided, the provider is fully decoupled from
 *               `@actions/github` globals. When omitted, falls back to
 *               the `@actions/github` singleton for backward compatibility.
 * @returns A PlatformProvider instance.
 */
export function createGitHubPlatformProvider(deps?: GitHubPlatformDeps): PlatformProvider {
  const type = detectPlatform();

  // Build the resolved context
  const resolvedContext: PlatformContext = deps?.context ?? {
    repo: github.context.repo,
    issue: github.context.issue,
    eventName: github.context.eventName,
    payload: github.context.payload,
    serverUrl: github.context.serverUrl || 'https://github.com',
    runId: github.context.runId,
    workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
  };

  // Resolve the logger
  let logger: Logger;
  if (deps?.logger) {
    logger = deps.logger;
  } else {
    // No deps provided — use a silent logger as fallback.
    // In production, deps.logger is always provided.
    logger = {
      debug: (/* msg */) => {},  // eslint-disable-line @typescript-eslint/no-empty-function
      info: (/* msg */) => {},   // eslint-disable-line @typescript-eslint/no-empty-function
      warning: (/* msg */) => {},// eslint-disable-line @typescript-eslint/no-empty-function
      notice: (/* msg */) => {}, // eslint-disable-line @typescript-eslint/no-empty-function
      error: (/* msg */) => {},  // eslint-disable-line @typescript-eslint/no-empty-function
    };
  }

  // Resolve octokit
  let octokit: GitHubPlatformDeps['octokit'];
  if (deps?.octokit) {
    octokit = deps.octokit;
  } else {
    // No deps provided — create from @actions/github singleton (backward compat)
    if (typeof github.getOctokit === 'function') {
      octokit = github.getOctokit(github.context as any);
    } else {
      throw new Error(
        'No Octokit provided and @actions/github.getOctokit is not available. ' +
        'Provide deps.octokit when calling createGitHubPlatformProvider().'
      );
    }
  }

  // Build the deps bag that will be threaded through all sub-functions
  const moduleDeps: GitHubModuleDeps = {
    octokit,
    context: resolvedContext,
    logger,
  };

  return {
    type,

    getContext(): PlatformContext {
      return resolvedContext;
    },

    async addReaction(): Promise<CreateReactionType | undefined> {
      return addReaction(moduleDeps);
    },

    async deleteReaction(reaction: CreateReactionType | undefined): Promise<void> {
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

    async getPRDiff(owner: string, repo: string, pullNumber: number, ignoreFiles?: string[]): Promise<string> {
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

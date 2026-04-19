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

import { context } from '@actions/github';
import { addReaction, deleteReaction } from './reactions';
import { createFinalComment } from './comments';
import { getPrompt, getStartTimeFromContext, getIssueOrPRThread } from './context';
import { createPullRequest } from './pull-request';
import { updatePullRequest } from './pull-request-update';
import type { Temporal } from '@js-temporal/polyfill';
import type { PlatformProvider, PlatformType, PlatformContext } from '../types';
import type { CommentMetadata } from '../../types';
import type { CreateReactionType } from './reactions';
import type { IssueOrPRThread, GetIssueOrPRThreadParams } from './context';
import type { CreatePullRequestParams, CreatePullRequestDetails } from './pull-request';
import type { UpdatePullRequestParams, UpdatePullRequestDetails } from './pull-request-update';

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
 * Create a GitHub-compatible platform provider.
 *
 * This implementation works with GitHub, Codeberg, and self-hosted Forgejo
 * instances since all three use the same CI/CD environment variables and
 * GitHub-compatible REST APIs.
 *
 * @returns A PlatformProvider instance.
 */
export function createGitHubPlatformProvider(): PlatformProvider {
  const type = detectPlatform();

  return {
    type,

    getContext(): PlatformContext {
      return {
        repo: context.repo,
        issue: context.issue,
        eventName: context.eventName,
        payload: context.payload as Record<string, unknown>,
        serverUrl: context.serverUrl || 'https://github.com',
        runId: context.runId,
        workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
      };
    },

    async addReaction(): Promise<CreateReactionType | undefined> {
      return addReaction();
    },

    async deleteReaction(reaction: CreateReactionType | undefined): Promise<void> {
      await deleteReaction(reaction);
    },

    async createFinalComment(body: string, metadata: CommentMetadata): Promise<void> {
      await createFinalComment(body, metadata);
    },

    async getPrompt(inputPrompt?: string): Promise<string | undefined> {
      return getPrompt(inputPrompt);
    },

    getStartTime(): Temporal.Instant | undefined {
      return getStartTimeFromContext();
    },

    async createPullRequest(
      params: CreatePullRequestParams
    ): Promise<{ content: { type: 'text'; text: string }[]; details: CreatePullRequestDetails }> {
      return createPullRequest(params);
    },

    async updatePullRequest(
      params: UpdatePullRequestParams
    ): Promise<{ content: { type: 'text'; text: string }[]; details: UpdatePullRequestDetails }> {
      return updatePullRequest(params);
    },

    async getIssueOrPRThread(
      params?: GetIssueOrPRThreadParams
    ): Promise<IssueOrPRThread | undefined> {
      return getIssueOrPRThread(params);
    },
  };
}

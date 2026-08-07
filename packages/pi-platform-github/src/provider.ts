/**
 * @file GitHub/Codeberg/Forgejo platform provider implementation.
 *
 * Provides the default platform implementation that works with GitHub,
 * Codeberg, and self-hosted Forgejo instances. All three platforms use
 * GitHub-compatible REST APIs and the same CI/CD environment variables
 * (GITHUB_* env vars), so a single implementation covers all of them.
 *
 * The platform is selected explicitly via the `platform` input (action) /
 * `--platform` flag (CLI), resolved by the pure {@link parsePlatformType}
 * function. There is no hostname-based auto-detection — it was unreliable
 * for distinguishing self-hosted Forgejo from self-hosted GitHub Enterprise.
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
import { resolvePlatformContext } from './context-utils';
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
 * Resolve a user-supplied platform string into a {@link PlatformType}.
 *
 * The platform is an **explicit input** (action `platform` input / CLI
 * `--platform` flag) rather than being auto-detected from the server URL.
 * Hostname-based detection was removed because it could not reliably tell
 * self-hosted Forgejo (e.g. `forge.example.com`) from self-hosted GitHub
 * Enterprise, and the API-URL heuristic was fragile.
 *
 * Resolution rules (case-insensitive, whitespace-trimmed):
 * - Empty / unset → `'github'` (the default — the most common platform).
 * - `'github'` → `'github'`
 * - `'codeberg'` → `'codeberg'`
 * - `'forgejo'` or `'gitea'` → `'forgejo'` (Gitea is API-compatible with
 *   Forgejo and shares the same job-level action-run URL format).
 * - Any other value → `'github'`. When `onUnknown` is provided it is
 *   invoked with the raw input so the caller (action/CLI) can surface a
 *   warning before the silent fallback.
 *
 * Pure function — no environment access.
 *
 * @param raw - The raw platform input string (may be undefined/empty).
 * @param onUnknown - Optional callback invoked with the raw input when it
 *   does not match a known platform, so frontends can warn the user.
 * @returns The resolved platform type.
 */
export function parsePlatformType(
  raw: string | undefined,
  onUnknown?: (raw: string) => void
): PlatformType {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized === '' || normalized === 'github') {
    return 'github';
  }
  if (normalized === 'forgejo' || normalized === 'gitea') {
    return 'forgejo';
  }
  if (normalized === 'codeberg') {
    return 'codeberg';
  }
  // Unrecognized input — surface it (if the caller wants to warn) and
  // fall back to the GitHub default so a typo never hard-fails the run.
  if (onUnknown) {
    onUnknown(raw ?? '');
  }
  return 'github';
}

/**
 * Resolve a REST API base URL from a server URL.
 *
 * - `https://github.com` (exact): Octokit's default `https://api.github.com`
 * - `*.github.com` (subdomain, e.g. `github.example.com`): also default
 * - Self-hosted GHE with custom hostname (e.g. `github.company.internal`):
 *   these don't match github.com or a known Forgejo/Gitea indicator, so
 *   they fall through to the GHES default: the REST API is at
 *   `{serverUrl}/api/v3`.
 * - Codeberg, Forgejo, Gitea: `{serverUrl}/api/v1`
 *
 * Returning `undefined` lets the SDK use its built-in `api.github.com`.
 *
 * When `platformType` is explicitly `'forgejo'` or `'codeberg'`, the
 * `/api/v1` suffix is used **regardless of hostname**. This lets callers
 * that resolve the platform via an explicit input (CLI `--platform` flag)
 * override the hostname-based heuristic, which cannot distinguish a
 * self-hosted Forgejo instance (e.g. `forge.l3x.in`) from self-hosted GHE.
 * When `platformType` is omitted or `'github'`, the hostname matching below
 * is used as before.
 *
 * @param serverUrl - The platform web server URL.
 * @param platformType - Optional resolved platform type. When forgejo/
 *   codeberg, forces `/api/v1` suffix regardless of hostname.
 */
export function apiBaseUrlFromServerUrl(
  serverUrl: string,
  platformType?: PlatformType
): string | undefined {
  if (!serverUrl) {
    throw new Error('apiBaseUrlFromServerUrl requires a server URL, got an empty string.');
  }
  const url = serverUrl.replace(/\/$/, '');

  // Explicit platform input overrides hostname matching. This is the
  // reliable path for self-hosted Forgejo whose hostname has no
  // forgejo/codeberg/gitea indicator (e.g. forge.l3x.in).
  if (platformType === 'forgejo' || platformType === 'codeberg') {
    return `${url}/api/v1`;
  }

  // Exact github.com → Octokit's default.
  if (url === 'https://github.com') {
    return undefined;
  }

  // Standard github.com subdomains (api.github.com, gist.github.com,
  // *.github.com). These are real github.com hosts whose API is the
  // default api.github.com. Scoped to endsWith so that a self-hosted GHE
  // host like `github.company.internal` (where `github` is an interior
  // segment, not a github.com subdomain) does NOT match here and correctly
  // falls through to the /api/v3 GHE default below.
  if (url.endsWith('.github.com')) {
    return undefined;
  }

  // Note: we intentionally do NOT use a broad `url.includes('github.com')`
  // check here. That would false-positive on self-hosted GHE hosts whose
  // names merely contain the literal `github.com` substring (e.g.
  // `github.mycompany.com`). The exact-match and endsWith checks above
  // already cover every legitimate github.com host; anything else falls
  // through to the /api/v3 GHE default below.

  // Codeberg, Forgejo, Gitea → /api/v1
  if (url.includes('codeberg') || url.includes('forgejo') || url.includes('gitea')) {
    return `${url}/api/v1`;
  }

  // Self-hosted GitHub Enterprise → /api/v3
  // This is the standard path for GHES REST API.
  // Users of other platforms should pass --server-url to get correct
  // API base URL derivation.
  return `${url}/api/v3`;
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
   * Explicit platform type, resolved from the `platform` input / `--platform`
   * flag via {@link parsePlatformType}. Required — library code does not read
   * environment variables. Defaults to `'github'` at the call site when the
   * input is unset.
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

  const resolvedContext = resolvePlatformContext(deps.context);
  const logger = deps.logger;
  const octokit = deps.octokit;

  if (resolvedContext !== deps.context) {
    logger.debug(
      `[createGitHubPlatformProvider] Recovered missing context from event payload: ${resolvedContext.repo.owner}/${resolvedContext.repo.repo}#${resolvedContext.issue.number}`
    );
  }

  // Resolve the trigger
  const trigger = deps?.trigger;

  // Build the deps bag that will be threaded through all sub-functions
  const moduleDeps: GitHubModuleDeps = {
    octokit,
    context: resolvedContext,
    logger,
    platformType: type,
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

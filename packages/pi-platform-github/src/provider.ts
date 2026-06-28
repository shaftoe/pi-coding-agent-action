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
 * Substring patterns that identify a recognized git host. Matches the
 * branches of {@link detectPlatform}.
 *
 * Exported so frontends can warn when a user points at a
 * host that doesn't match any known pattern — `detectPlatform` silently
 * falls back to `'github'` for unrecognized hosts, so callers that want
 * to surface the fallback must check this predicate themselves.
 */
const KNOWN_HOST_PATTERNS = ['codeberg', 'forgejo', 'gitea', 'github.com', '.github.'] as const;

/**
 * Return `true` iff `serverUrl` matches a host pattern recognized by
 * {@link detectPlatform}. Pure — no environment access.
 */
export function isKnownServerUrl(serverUrl: string): boolean {
  if (!serverUrl) {
    return false;
  }
  return KNOWN_HOST_PATTERNS.some(pattern => serverUrl.includes(pattern));
}

/**
 * Detect the current platform based on a server URL.
 *
 * Pure function — no environment access. Callers (typically the action/
 * CLI entry point) are responsible for reading the URL from the
 * appropriate source (e.g. `github.context.serverUrl`) and passing it in.
 *
 * @param serverUrl - The platform server URL (e.g. 'https://github.com').
 * @param apiUrl - Optional REST API base URL advertised by the runner
 *   (e.g. `GITHUB_API_URL`). When provided, a URL ending in `/api/v1`
 *   reliably identifies Forgejo/Gitea/Codeberg even when the server hostname
 *   does not contain "forgejo"/"gitea"/"codeberg" (e.g. `forge.example.com`).
 *   GitHub Enterprise uses `/api/v3` and GitHub.com uses `api.github.com`,
 *   so this disambiguates self-hosted Forgejo from self-hosted GHE.
 * @returns The detected platform type.
 */
// fallow-ignore-next-line complexity
export function detectPlatform(serverUrl: string, apiUrl?: string): PlatformType {
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

  // github.com, GitHub Enterprise (any hostname), and self-hosted GHE.
  // Self-hosted GitHub Enterprise instances use custom hostnames like
  // github.company.internal or gh.internal.corp. We catch these with a
  // broad match before falling through to the unknown-default below.
  if (
    serverUrl.includes('github.com') ||
    serverUrl.includes('.github.') ||
    serverUrl === 'https://github.com' ||
    serverUrl === 'http://github.com'
  ) {
    return 'github';
  }

  // API-URL based detection for Forgejo/Gitea/Codeberg instances whose
  // hostname does not contain "forgejo"/"gitea"/"codeberg" (e.g.
  // `forge.example.com`, `git.company.internal`). Forgejo's REST API lives
  // at `{server}/api/v1`, whereas GitHub Enterprise uses `/api/v3` and
  // GitHub.com uses `api.github.com`. This is the most reliable signal
  // available in the runner environment.
  if (apiUrl) {
    const normalizedApi = apiUrl.replace(/\/+$/, '');
    if (normalizedApi.endsWith('/api/v1')) {
      return normalizedApi.includes('codeberg') || serverUrl.includes('codeberg')
        ? 'codeberg'
        : 'forgejo';
    }
  }

  // Unknown server URL — default to 'github' for self-hosted GitHub
  // Enterprise and other GitHub-compatible hosts.
  //
  // Rationale: the vast majority of unrecognised hosts are corporate GHE
  // or GHE-like proxies. Falling back to 'github' gives them correct
  // platform semantics (GitHub-compatible REST API). Codeberg and Forgejo
  // are already caught by the explicit checks above.
  //
  // Frontends that want to surface the silent fallback can call
  // {@link isKnownServerUrl} to detect this branch.
  return 'github';
}

/**
 * Resolve a REST API base URL from a server URL.
 *
 * - `https://github.com` (exact): Octokit's default `https://api.github.com`
 * - `*.github.com` (subdomain, e.g. `github.example.com`): also default
 * - Self-hosted GHE with custom hostname (e.g. `github.company.internal`):
 *   {@link detectPlatform} (co-located in this module) defaults to `'github'`
 *   for unrecognized hosts, so these are treated as GHES-specific: the REST
 *   API is at `{serverUrl}/api/v3`.
 * - Codeberg, Forgejo, Gitea: `{serverUrl}/api/v1`
 *
 * Returning `undefined` lets the SDK use its built-in `api.github.com`.
 *
 * Natural pair of {@link detectPlatform}: both are pure functions of
 * `serverUrl` with overlapping host pattern-matching, answering
 * complementary questions (platform *type* vs *API URL*). Kept co-located
 * to avoid drift when a new host is added.
 */
export function apiBaseUrlFromServerUrl(serverUrl: string): string | undefined {
  if (!serverUrl) {
    throw new Error('apiBaseUrlFromServerUrl requires a server URL, got an empty string.');
  }
  const url = serverUrl.replace(/\/$/, '');

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

/**
 * @file Fork management for fork-based pull requests.
 *
 * Pull requests created by the agent are opened **from a fork** of the target
 * repository: the branch is pushed to the token owner's fork and the PR head
 * is `forkOwner:branch`. This module implements the fork half of that flow:
 *
 *  - resolving the token's authenticated user,
 *  - get-or-create of that user's fork of the target repository,
 *  - a bounded readiness wait for freshly created forks (GitHub creates them
 *    asynchronously — the repo object exists before its branches do),
 *  - deriving an authenticated push URL for the fork from the workspace's
 *    `origin` remote, preserving any embedded credentials and host-scoped
 *    `http.<url>.*` config set up by `actions/checkout`.
 */

import { simpleGit } from 'simple-git';
import type { GitHubModuleDeps } from '../types';
import { createLogger } from './types';

/**
 * The fork repository to open a pull request from.
 */
export interface ForkInfo {
  /** Owner of the fork (the token's authenticated login). */
  readonly owner: string;
  /**
   * Repository name of the fork. Usually identical to the parent repository
   * name, but may carry a suffix when the login already owns an unrelated
   * repository with the same name (e.g. Forgejo appends `-1`).
   */
  readonly repo: string;
  /** `true` when the fork was created by this call, `false` when reused. */
  readonly created: boolean;
}

/**
 * Extract the HTTP status code from an Octokit-style error object.
 *
 * Local variant of the helper in `tools/pull-request.ts` — kept private here
 * to avoid a circular import between the git layer and the tool layer.
 */
function errorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

/** Extract an Error message from an unknown throwable. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve the login of the user (or bot) the current token authenticates as.
 *
 * @param deps - Module dependencies.
 * @returns The authenticated login (e.g. `octocat` or `my-app[bot]`).
 * @throws {Error} With an actionable message when the token cannot be
 *         introspected — fork-based PR creation requires a token that can.
 */
export async function getAuthenticatedLogin(deps: GitHubModuleDeps): Promise<string> {
  const log = createLogger(deps, '🍴');
  log.debug('Resolving the authenticated user for the fork…');
  try {
    const result = await deps.octokit.rest.users.getAuthenticated();
    const login = result.data.login;
    if (!login) {
      throw new Error('the API response did not include a login');
    }
    log.debug(`Authenticated as "${login}"`);
    return login;
  } catch (error) {
    throw new Error(
      `Failed to resolve the authenticated user (HTTP ${errorStatus(error) ?? 'unknown'}): ` +
        `${errorMessage(error)}. Fork-based pull requests require a token that can ` +
        `create forks (e.g. a personal access token) — the default GITHUB_TOKEN ` +
        `authenticates as a bot user that cannot own forks.`
    );
  }
}

/**
 * Check whether the current token can push to the target repository.
 *
 * Deliberately conservative: when the API call fails (older Forgejo/Gitea
 * instances, network errors, scope gaps) or the `permissions` field is
 * absent, returns `false` so callers fall back to the fork flow.
 *
 * @param deps - Module dependencies.
 * @returns `true` when the token can push to the repository.
 */
export async function canPushToRepository(deps: GitHubModuleDeps): Promise<boolean> {
  const log = createLogger(deps, '🍴');
  const { owner, repo } = deps.context.repo;
  try {
    const response = await deps.octokit.rest.repos.get({ owner, repo });
    const canPush = response.data.permissions?.push === true;
    log.debug(
      canPush
        ? `The token can push to "${owner}/${repo}" — no fork is needed.`
        : `The token cannot push to "${owner}/${repo}" — a fork is needed to open a pull request.`
    );
    return canPush;
  } catch (error) {
    log.debug(
      `Could not determine push permission for "${owner}/${repo}" ` +
        `(${errorMessage(error)}) — assuming push is not possible; a fork will be used.`
    );
    return false;
  }
}

/**
 * Get or create the token owner's fork of the target repository.
 *
 * When `{login}/{repo}` already exists and is a fork of the target repository
 * it is reused as-is (the agent keeps its fork between runs). Otherwise a
 * fork is created via `repos.createFork`. The platform decides the fork's
 * actual name — on name collisions Forgejo/Gitea create a suffixed fork
 * (e.g. `repo-1`) — so the returned name is authoritative.
 *
 * @param deps - Module dependencies.
 * @param login - The token's authenticated login (the prospective fork owner).
 * @returns The fork to push to. `created` is `true` when it was just created.
 * @throws {Error} With an actionable message when the fork cannot be checked
 *         or created.
 */
// fallow-ignore-next-line complexity
export async function ensureFork(deps: GitHubModuleDeps, login: string): Promise<ForkInfo> {
  const log = createLogger(deps, '🍴');
  const { owner, repo } = deps.context.repo;
  const target = `${owner}/${repo}`;

  // 1. Reuse an existing fork of this repository.
  try {
    const existing = await deps.octokit.rest.repos.get({ owner: login, repo });
    const data = existing.data as {
      name?: string;
      fork?: boolean;
      parent?: { full_name?: string } | null;
    };
    if (data.fork && data.parent?.full_name === target && data.name) {
      log.debug(`Reusing existing fork "${login}/${data.name}" of "${target}"`);
      return { owner: login, repo: data.name, created: false };
    }
    // The repository exists under the login's account but is not a fork of
    // the target (a name collision). Fall through and let the platform's
    // create-fork endpoint decide: GitHub fails with 422, Forgejo creates a
    // suffixed fork.
    log.debug(
      `"${login}/${repo}" exists but is not a fork of "${target}" — attempting to create a fork anyway`
    );
  } catch (error) {
    const status = errorStatus(error);
    if (status !== 404) {
      throw new Error(
        `Failed to check for an existing fork at "${login}/${repo}" ` +
          `(HTTP ${status ?? 'unknown'}): ${errorMessage(error)}.`
      );
    }
    // 404 — no fork yet, create one below.
  }

  // 2. Create the fork.
  log.debug(`Creating fork of "${target}" for "${login}"…`);
  try {
    const created = await deps.octokit.rest.repos.createFork({ owner, repo });
    const forkRepo = created.data.name ?? repo;
    log.info(`Created fork "${login}/${forkRepo}" of "${target}"`);
    return { owner: login, repo: forkRepo, created: true };
  } catch (error) {
    const status = errorStatus(error);
    throw new Error(
      `Failed to create a fork of "${target}" for "${login}" ` +
        `(HTTP ${status ?? 'unknown'}): ${errorMessage(error)}. Fork-based pull ` +
        `requests require a token that can create forks — e.g. a personal access ` +
        `token with repository access. The default GITHUB_TOKEN authenticates as ` +
        `a bot user that cannot own repositories.`
    );
  }
}

/** Default polling budget for {@link waitForForkReady}. */
const DEFAULT_READINESS_ATTEMPTS = 10;
/** Default delay between {@link waitForForkReady} polls, in milliseconds. */
const DEFAULT_READINESS_DELAY_MS = 1000;

/**
 * Options for {@link waitForForkReady}. All fields are injectable so tests
 * can drive retry loops without real timers.
 */
export interface WaitForForkReadyOptions {
  /** Maximum number of polls (default 10). */
  attempts?: number;
  /** Delay between polls in milliseconds (default 1000). */
  delayMs?: number;
  /** Sleep implementation — injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wait until a freshly created fork is ready to accept pushes.
 *
 * GitHub creates forks asynchronously: the repository object (and the 202
 * response of `repos.createFork`) exists before the default branch does, so
 * an immediate push can race a half-created fork. This polls
 * `repos.getBranch` on the fork until the default branch is visible.
 *
 * Best-effort: when the branch never appears within the attempt budget,
 * `false` is returned and the caller logs a warning and proceeds anyway
 * (the push then surfaces the real error, if any).
 *
 * @param deps - Module dependencies.
 * @param fork - The fork to wait for.
 * @param defaultBranch - The branch expected to exist in the fork (the
 *        parent repository's default branch).
 * @param options - Polling budget and injectable sleep.
 * @returns `true` when the branch became visible, `false` on timeout.
 */
export async function waitForForkReady(
  deps: GitHubModuleDeps,
  fork: ForkInfo,
  defaultBranch: string,
  options?: WaitForForkReadyOptions
): Promise<boolean> {
  const log = createLogger(deps, '🍴');
  const attempts = options?.attempts ?? DEFAULT_READINESS_ATTEMPTS;
  const delayMs = options?.delayMs ?? DEFAULT_READINESS_DELAY_MS;
  const sleep = options?.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await deps.octokit.rest.repos.getBranch({
        owner: fork.owner,
        repo: fork.repo,
        branch: defaultBranch,
      });
      if (attempt > 1) {
        log.debug(`Fork "${fork.owner}/${fork.repo}" is ready (default branch visible).`);
      }
      return true;
    } catch (error) {
      const status = errorStatus(error);
      if (status !== 404) {
        // Real error (403, 5xx, …) — don't spin the full budget on it, but
        // also don't hard-fail: the subsequent push may still succeed.
        log.warning(
          `Readiness check for fork "${fork.owner}/${fork.repo}" failed with ` +
            `HTTP ${status ?? 'unknown'}: ${errorMessage(error)} — proceeding.`
        );
        return false;
      }
      if (attempt < attempts) {
        log.debug(
          `Fork "${fork.owner}/${fork.repo}" not ready yet (attempt ${attempt}/${attempts}) — retrying…`
        );
        await sleep(delayMs);
      }
    }
  }
  return false;
}

/**
 * Derive the fork's remote URL from the `origin` remote URL.
 *
 * Replaces the trailing `{owner}/{repo}` path segments of `origin` with the
 * fork's owner/repo while preserving everything else — scheme, embedded
 * credentials, host, port, `.git` suffix, and any URL-prefix path (e.g.
 * Forgejo instances served under a subpath). This keeps the derived URL
 * authenticated and runner-reachable, because it inherits whatever
 * credentials `actions/checkout` configured for `origin`:
 *
 * - Embedded credentials: `https://x-access-token:***@host/owner/repo.git`
 * - Host-scoped extraheader: `http.<server-url>.extraheader` applies to any
 *   repository on the same host, so the fork URL needs no credentials.
 *
 * Handles the common remote URL forms:
 * - HTTPS:  `https://github.com/owner/repo(.git)`
 * - HTTPS with credentials: `https://user:token@host/owner/repo.git`
 * - SCP-like SSH: `git@github.com:owner/repo.git`
 * - SSH URL: `ssh://git@host/owner/repo.git`
 *
 * @param originUrl - The workspace's `origin` remote URL.
 * @param fork - The fork repository (owner + name).
 * @param fallbackServerUrl - Server URL used when `originUrl` has no
 *        recognizable `{owner}/{repo}` suffix (e.g. a bare local path).
 * @returns The fork's remote URL.
 * @internal Exported for testing purposes.
 */
export function buildForkRemoteUrl(
  originUrl: string,
  fork: { owner: string; repo: string },
  fallbackServerUrl?: string
): string {
  const trimmed = originUrl.trim();
  const hasGitSuffix = /\.git$/i.test(trimmed);
  const base = hasGitSuffix ? trimmed.slice(0, -4) : trimmed;

  // Match "<prefix><:|/><owner>/<repo>" at the end of the URL. The prefix is
  // greedy, so the separator immediately before the final two path segments
  // is used — this is correct for both `/`-separated URLs and the `:`
  // separator of SCP-like SSH URLs, and ignores ports (`host:3000`) because
  // they are followed by more than two path segments.
  const match = base.match(/^(.*)([:/])([^/:]+)\/([^/:]+)$/);
  if (match) {
    const [, prefix, separator] = match;
    return `${prefix}${separator}${fork.owner}/${fork.repo}${hasGitSuffix ? '.git' : ''}`;
  }

  // Unrecognized origin URL shape — fall back to a canonical HTTPS URL.
  const server = (fallbackServerUrl ?? 'https://github.com').replace(/\/$/, '');
  return `${server}/${fork.owner}/${fork.repo}.git`;
}

/**
 * Resolve the fork's push URL for the workspace checkout.
 *
 * Reads the workspace's `origin` remote URL and rewrites its owner/repo
 * segments to point at the fork (see {@link buildForkRemoteUrl}). When no
 * `origin` remote is configured, falls back to a canonical HTTPS URL built
 * from the platform's server URL.
 *
 * @param workspace - The workspace (checkout) directory.
 * @param fork - The fork repository (owner + name).
 * @param fallbackServerUrl - Server URL used when `origin` cannot be read.
 * @returns The fork's remote URL.
 */
export async function resolveForkRemoteUrl(
  workspace: string,
  fork: { owner: string; repo: string },
  fallbackServerUrl?: string
): Promise<string> {
  let originUrl: string | undefined;
  try {
    originUrl =
      (await simpleGit(workspace).raw(['remote', 'get-url', 'origin'])).trim() || undefined;
  } catch {
    // No `origin` remote configured (or not a git worktree) — use the fallback.
  }
  return buildForkRemoteUrl(originUrl ?? '', fork, fallbackServerUrl);
}

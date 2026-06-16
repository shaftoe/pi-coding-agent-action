/**
 * @file Bridge — git discovery + forge provider construction.
 *
 * The local counterpart to the CI action's provider wiring. From the
 * developer's working directory it discovers the git remote, resolves a forge
 * token, and builds the same {@link PlatformProvider} + Octokit the CI action
 * uses — but against a *synthetic* {@link PlatformContext} whose CI-only
 * fields are sentinel/empty so the provider's CI methods (reactions, final
 * comment, prompt, start time) no-op. Only the read methods (`getIssueOrPRThread`,
 * `getPRDiff`) are meaningful locally.
 *
 * Two helpers from private `pi-cli` are intentionally *inlined* here rather
 * than imported (pi-cli is `"private": true`): {@link buildPlatformContext}
 * (frontend-specific assembly, ~10 lines) and the Octokit construction
 * (`createCliOctokit`'s ~6-line body). `apiBaseUrlFromServerUrl` and
 * `detectPlatform`, by contrast, *are* imported — they were co-located into
 * `pi-platform-github` as a natural pair (constitution §3.4 / Q9).
 */

import { execFileSync } from 'node:child_process';
import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import simpleGit from 'simple-git';
import {
  apiBaseUrlFromServerUrl,
  createGitHubPlatformProvider,
  detectPlatform,
  isKnownServerUrl,
} from '@alexanderfortin/pi-platform-github';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';
import type { Logger, PlatformContext, PlatformProvider } from '@alexanderfortin/pi-orchestrator';
import { parseRemoteUrl } from './detect.js';
import type { ParsedRemote } from './detect.js';

/**
 * Octokit class with the REST endpoint methods plugin applied.
 *
 * Exported so the imported {@link OctokitInstance} type (derived from the same
 * plugin call in `pi-platform-github`) stays structurally aligned.
 */
export const OctokitWithRest = Octokit.plugin(restEndpointMethods);

/** Sentinel event name — any non-CI value makes the provider's CI methods no-op. */
const BRIDGE_EVENT_NAME = 'pi-action-bridge';

/** Result of {@link Bridge.discover}: what git + the remote told us. */
export interface BridgeDiscovery {
  /** Parsed remote (server URL + owner/repo). */
  parsed: ParsedRemote;
  /** Detected platform type (always defined once `parsed` is). */
  platformType: ReturnType<typeof detectPlatform>;
  /** Whether the host matches a known forge pattern (surfaces GitLab etc.). */
  isKnownHost: boolean;
}

/**
 * Best-effort token discovery via `gh auth token` (reads a stored token; never
 * prompts or logs in). Extracted so {@link resolveToken} can inject a stub in
 * tests — the real subprocess call is a side effect that depends on host
 * `gh` state.
 */
function ghAuthToken(): string | undefined {
  try {
    const stdout = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const trimmed = stdout.trim();
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a forge token, in the order the constitution mandates (§2.3 / Q2):
 * `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token` (best-effort, if `gh` is on
 * PATH and the env vars are absent) → `undefined`.
 *
 * `gh` is consulted read-only via `gh auth token`. Never invokes
 * `gh auth login` or any prompt.
 *
 * @param env - Process env to read (defaults to `process.env`).
 * @param ghFallback - Injected `gh` discovery (defaults to {@link ghAuthToken});
 *   tests pass `() => undefined` to isolate the env-var path.
 */
export function resolveToken(
  env: NodeJS.ProcessEnv = process.env,
  ghFallback: () => string | undefined = ghAuthToken
): string | undefined {
  // `||` (not `??`) is intentional: an empty-string token is meaningless and
  // should fall through to GH_TOKEN / gh, which nullish-coalescing would not do.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const fromEnv = env['GITHUB_TOKEN'] || env['GH_TOKEN'];
  if (fromEnv) {
    return fromEnv;
  }
  return ghFallback();
}

/**
 * Build a no-op {@link Logger}. The provider requires a Logger, but the
 * extension surfaces user-relevant state via `ctx.ui.notify` in the
 * `session_start` gate — provider-internal debug/info logging has no TUI
 * destination in Phase 1. (A debug-aware logger can be wired later when
 * verbose mode is needed.)
 */
export function createLogger(): Logger {
  const noop = (): void => {
    /* no-op: see createLogger docstring */
  };
  return {
    debug: noop,
    info: noop,
    warning: noop,
    notice: noop,
    error: noop,
  };
}

/** Construct an Octokit instance whose type aligns with the provider's expectation. */
export function createOctokit(token: string, serverUrl: string): OctokitInstance {
  const baseUrl = apiBaseUrlFromServerUrl(serverUrl);
  return new OctokitWithRest({
    auth: token,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });
}

/**
 * Assemble a synthetic {@link PlatformContext} for local use (inlined per Q9 —
 * mirrors `pi-cli`'s `buildPlatformContext`, kept here because it's
 * frontend-specific assembly with no platform logic worth sharing).
 *
 * The sentinel values (`issue.number: 0`, `payload: {}`, a non-CI
 * `eventName`) make the provider's CI-only methods no-op, exactly as they do
 * for `pi-cli`.
 */
export function buildPlatformContext(args: {
  parsed: ParsedRemote;
  workspace: string;
}): PlatformContext {
  return {
    repo: { owner: args.parsed.owner, repo: args.parsed.repo },
    issue: { number: 0 },
    eventName: BRIDGE_EVENT_NAME,
    payload: {},
    serverUrl: args.parsed.serverUrl,
    workspace: args.workspace,
  };
}

/**
 * Bridge — holds the constructed provider + context for the current repo.
 *
 * Use {@link Bridge.create} to discover + build in one call; it returns
 * `undefined` when the cwd isn't a supported forge repo (not a git repo,
 * unparseable remote, unknown host, or no token).
 */
export class Bridge {
  private constructor(
    readonly provider: PlatformProvider,
    readonly octokit: OctokitInstance,
    readonly context: PlatformContext,
    readonly discovery: BridgeDiscovery
  ) {}

  /**
   * Get the current git branch name, or `undefined` (detached HEAD / not a
   * repo / git error). Honors §2.2 — resolved on every call, no caching.
   */
  async getCurrentBranch(): Promise<string | undefined> {
    try {
      const git = simpleGit(this.context.workspace);
      const branch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
      if (!branch || branch === 'HEAD') {
        return undefined; // detached HEAD
      }
      return branch;
    } catch {
      return undefined;
    }
  }

  /**
   * Get the local git committer name (`git config user.name`), for the
   * passive account-mismatch check (§2.1 step 10, Q3). Returns `undefined`
   * on error or if unset.
   */
  async getLocalGitIdentity(): Promise<string | undefined> {
    try {
      const git = simpleGit(this.context.workspace);
      const name = (await git.raw(['config', 'user.name'])).trim();
      return name || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve the open PR linked to the current branch, if any.
   *
   * Used by the read-only tools (`get_thread`, `get_pr_diff`) as the default
   * when the agent calls them without an explicit number — so the agent can
   * say "show me the thread" and get the current PR. Honors §2.2 (resolved
   * dynamically via git + API on every request, no caching).
   *
   * **Limitation:** matches PRs whose head is `owner:branch` (same-owner
   * branches). Fork PRs (head on a different owner) are not matched by the
   * `pulls.list` `head` filter — pass an explicit `issue_number`/`pull_number`
   * for those.
   */
  async resolveCurrentPR(): Promise<number | undefined> {
    const branch = await this.getCurrentBranch();
    if (!branch) {
      return undefined;
    }
    try {
      const { data } = await this.octokit.rest.pulls.list({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        head: `${this.context.repo.owner}:${branch}`,
        state: 'open',
      });
      return data[0]?.number;
    } catch {
      return undefined;
    }
  }

  /**
   * Discover the git remote at `cwd` without constructing anything that needs
   * a token. Returns `undefined` if `cwd` isn't a git repo, has no `origin`
   * remote, or the remote URL can't be parsed (local path, `git://`, etc.).
   */
  static async discover(cwd: string): Promise<BridgeDiscovery | undefined> {
    let remoteUrl: string;
    try {
      const git = simpleGit(cwd);
      remoteUrl = (await git.raw(['remote', 'get-url', 'origin'])).trim();
    } catch {
      return undefined;
    }
    const parsed = parseRemoteUrl(remoteUrl);
    if (!parsed) {
      return undefined;
    }
    const platformType = detectPlatform(parsed.serverUrl);
    const isKnownHost = isKnownServerUrl(parsed.serverUrl);
    return { parsed, platformType, isKnownHost };
  }

  /**
   * Discover + build. Returns the {@link Bridge} when `cwd` is a known forge
   * repo AND a token is resolvable; otherwise `undefined`. The optional
   * callbacks let the caller (the session_start gate) report *why* it went
   * inert — e.g. an info line for "unsupported host" vs "no token".
   */
  static async create(args: {
    cwd: string;
    logger?: Logger;
    /** Called (not awaited) when the host isn't a known forge (e.g. GitLab). */
    onUnknownHost?: (serverUrl: string) => void;
    /** Called (not awaited) when no token could be resolved. */
    onNoToken?: () => void;
  }): Promise<Bridge | undefined> {
    const logger = args.logger ?? createLogger();
    const discovery = await Bridge.discover(args.cwd);
    if (!discovery) {
      return undefined; // not a git repo / unparseable remote — silent inert
    }
    if (!discovery.isKnownHost) {
      args.onUnknownHost?.(discovery.parsed.serverUrl);
      return undefined;
    }
    const token = resolveToken();
    if (!token) {
      args.onNoToken?.();
      return undefined;
    }
    const octokit = createOctokit(token, discovery.parsed.serverUrl);
    const context = buildPlatformContext({ parsed: discovery.parsed, workspace: args.cwd });
    const provider = createGitHubPlatformProvider({
      octokit,
      context,
      logger,
      platformType: discovery.platformType,
    });
    return new Bridge(provider, octokit, context, discovery);
  }
}

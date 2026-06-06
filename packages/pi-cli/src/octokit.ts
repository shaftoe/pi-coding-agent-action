/**
 * @file Octokit construction for the CLI.
 *
 * Builds an Octokit instance from `@octokit/core` + the REST endpoint
 * methods plugin, matching the structural shape that
 * `pi-platform-github`'s `GitHubPlatformDeps.octokit` expects.
 *
 * This bypasses `@actions/github.getOctokit()` so the CLI doesn't pull in
 * the GitHub-Actions-only package and its runner-side defaults (proxy
 * agent, etc.).
 */

import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

/**
 * Build the Octokit class with the REST endpoint methods plugin applied.
 *
 * Exported as a constant so the type can be derived via `InstanceType<>`
 * in `pi-platform-github` (see `packages/pi-platform-github/src/types.ts`).
 */
const OctokitWithRest = Octokit.plugin(restEndpointMethods);

/**
 * Resolve a REST API base URL from a server URL.
 *
 * - `github.com` (and any `*.github.com` enterprise host) → Octokit's
 *   default `https://api.github.com`, so we return `undefined` and let
 *   Octokit resolve it.
 * - Codeberg, Forgejo, Gitea → `{serverUrl}/api/v1` (the standard
 *   endpoint path for these GitHub-compatible platforms).
 *
 * Returning `undefined` for the default case lets the SDK use its built-in
 * default, which is important for GitHub Enterprise users who configure
 * Octokit's `baseUrl` via other means.
 */
export function apiBaseUrlFromServerUrl(serverUrl: string): string | undefined {
  if (serverUrl.includes('github.com')) {
    return undefined;
  }
  return `${serverUrl.replace(/\/$/, '')}/api/v1`;
}

/**
 * Construct an Octokit instance for CLI use.
 *
 * @param token - GitHub API token (PAT or `GITHUB_TOKEN`).
 * @param serverUrl - Web URL of the git host (e.g. `https://github.com`).
 *                    Used to derive the API base URL for non-github.com hosts.
 */
export function createCliOctokit(token: string, serverUrl: string): OctokitInstance {
  const baseUrl = apiBaseUrlFromServerUrl(serverUrl);
  return new OctokitWithRest({
    auth: token,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });
}

/** Re-export of the Octokit instance type for callers that need it. */
export type OctokitInstance = InstanceType<typeof OctokitWithRest>;

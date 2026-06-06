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
 *
 * The OctokitInstance type is imported from `@alexanderfortin/pi-platform-github`
 * (the canonical source — see §5 of the issue review) to prevent the two
 * packages' type definitions from silently drifting.
 */

import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';

/**
 * Build the Octokit class with the REST endpoint methods plugin applied.
 *
 * Exported as a constant so `pi-platform-github`'s `OctokitInstance` type
 * (which is derived from the same plugin call) is structurally aligned.
 */
export const OctokitWithRest = Octokit.plugin(restEndpointMethods);

/**
 * Resolve a REST API base URL from a server URL.
 *
 * - `https://github.com` (exact): Octokit's default `https://api.github.com`
 * - `*.github.com` (subdomain, e.g. `github.example.com`): also default
 * - Self-hosted GHE with custom hostname (e.g. `github.company.internal`):
 *   the `detectPlatform()` function in pi-platform-github now defaults to
 *   `'github'` for unrecognized hosts, so we treat these as GHES-specific:
 *   the REST API is at `{serverUrl}/api/v3`.
 * - Codeberg, Forgejo, Gitea: `{serverUrl}/api/v1`
 *
 * Returning `undefined` lets the SDK use its built-in `api.github.com`.
 */
export function apiBaseUrlFromServerUrl(serverUrl: string): string | undefined {
  const url = serverUrl.replace(/\/$/, '');

  // Exact github.com → Octokit's default.
  if (url === 'https://github.com') {
    return undefined;
  }

  // Standard github.com subdomains (api.github.com, *.github.com).
  if (url.includes('.github.')) {
    return undefined;
  }

  // GitHub.com (fallback for bare 'github.com' without protocol and
  // edge cases like GitHub AE which uses github.com).
  if (url.includes('github.com')) {
    return undefined;
  }

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

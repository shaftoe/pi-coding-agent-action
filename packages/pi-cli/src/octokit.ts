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
import type { PlatformType } from '@alexanderfortin/pi-orchestrator';
import { apiBaseUrlFromServerUrl } from '@alexanderfortin/pi-platform-github';

/**
 * Build the Octokit class with the REST endpoint methods plugin applied.
 *
 * Exported as a constant so `pi-platform-github`'s `OctokitInstance` type
 * (which is derived from the same plugin call) is structurally aligned.
 */
export const OctokitWithRest = Octokit.plugin(restEndpointMethods);

/**
 * Construct an Octokit instance for CLI use.
 *
 * @param token - GitHub API token (PAT or `GITHUB_TOKEN`).
 * @param serverUrl - Web URL of the git host (e.g. `https://github.com`).
 *                    Used to derive the API base URL for non-github.com hosts.
 * @param platformType - Resolved platform type (from `--platform` flag). When
 *                       forgejo/codeberg, forces `/api/v1` regardless of
 *                       hostname so self-hosted Forgejo (e.g. `forge.l3x.in`)
 *                       gets the correct API URL.
 */
export function createCliOctokit(
  token: string,
  serverUrl: string,
  platformType?: PlatformType
): OctokitInstance {
  const baseUrl = apiBaseUrlFromServerUrl(serverUrl, platformType);
  return new OctokitWithRest({
    auth: token,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });
}

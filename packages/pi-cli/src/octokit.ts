/**
 * @file Octokit construction for the CLI.
 *
 * Thin wrapper around the canonical {@link createOctokit} factory exported by
 * `pi-platform-github`, guaranteeing the REST endpoint typings always match
 * this workspace's `@octokit/plugin-rest-endpoint-methods` version.
 *
 * This bypasses `@actions/github.getOctokit()` so the CLI doesn't pull in
 * the GitHub-Actions-only package and its runner-side defaults (proxy
 * agent, etc.).
 */

import { createOctokit } from '@alexanderfortin/pi-platform-github';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github';
import type { PlatformType } from '@alexanderfortin/pi-orchestrator';
import { apiBaseUrlFromServerUrl } from '@alexanderfortin/pi-platform-github';

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
  return createOctokit(token, baseUrl);
}

/**
 * @file Octokit construction for the GitHub platform module.
 *
 * Provides the single canonical Octokit factory used by all frontends
 * (GitHub Action, CLI, bridge). Constructing the instance here — rather
 * than via `@actions/github.getOctokit()` — guarantees the REST endpoint
 * typings always match this package's `@octokit/plugin-rest-endpoint-methods`
 * version, and keeps the GitHub-Actions-only package out of the library.
 */

import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

/**
 * Octokit class with the REST endpoint methods plugin applied. The
 * `OctokitInstance` type in `./types.ts` is derived from this exact call,
 * so instances produced by {@link createOctokit} are always assignable to it.
 */
export const OctokitWithRest = Octokit.plugin(restEndpointMethods);

/** The minimal Octokit shape this library requires (see `types.ts`). */
export type OctokitInstance = InstanceType<typeof OctokitWithRest>;

/**
 * Construct an authenticated Octokit instance.
 *
 * @param token - GitHub API token (PAT, `GITHUB_TOKEN`, or installation token).
 * @param baseUrl - Optional REST API base URL (e.g. for GHES or Forgejo's
 *                  `/api/v1`). When omitted, Octokit defaults to github.com.
 */
export function createOctokit(token: string, baseUrl?: string): OctokitInstance {
  return new OctokitWithRest({
    auth: token,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });
}

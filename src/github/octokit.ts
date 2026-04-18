/**
 * @file Shared Octokit client singleton.
 *
 * Provides a lazily-initialised REST API client that is shared across all
 * modules. The client is configured with the correct base URL for the
 * detected platform (GitHub, Codeberg, or Forgejo).
 *
 * Uses `@octokit/rest` directly instead of `@actions/github`'s `getOctokit()`
 * to support custom API base URLs required by Codeberg and Forgejo.
 */

import { Octokit } from '@octokit/rest';
import { detectPlatform } from '../platform';
import { getCoreAdapter } from './index';

/** Cached Octokit instance (created once on first call to {@link getOctokit}). */
let _octokit: Octokit | undefined;

/**
 * Get the shared Octokit client instance.
 *
 * On the first call the client is created using the platform-detected
 * base URL and the `github_token` action input. Subsequent calls return
 * the cached instance.
 *
 * The base URL is automatically configured based on the detected platform:
 * - GitHub → `https://api.github.com`
 * - Codeberg → `https://codeberg.org/api/v1`
 * - Forgejo → `{server_url}/api/v1`
 *
 * @returns An authenticated {@link Octokit} client.
 */
export function getOctokit(): Octokit {
  if (!_octokit) {
    const platform = detectPlatform();
    const token = getCoreAdapter().getInput('github_token') ?? process.env.GITHUB_TOKEN ?? '';

    _octokit = new Octokit({
      baseUrl: platform.apiBaseUrl,
      auth: token,
    });
  }
  return _octokit;
}

/**
 * Reset the cached Octokit instance.
 *
 * Used in tests to ensure clean isolation between test cases.
 *
 * @internal Exported for testing purposes only.
 */
export function resetOctokit(): void {
  _octokit = undefined;
}

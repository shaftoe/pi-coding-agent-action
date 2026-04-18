/**
 * @file Platform detection from environment variables.
 *
 * Detects which Git hosting platform (GitHub, Codeberg, or Forgejo)
 * the action is running on by inspecting the `GITHUB_SERVER_URL`
 * environment variable.
 *
 * All three platforms (GitHub Actions, Codeberg's Forgejo Actions, and
 * self-hosted Forgejo) set the `GITHUB_*` family of environment variables
 * for compatibility, so the same context-reading code works everywhere.
 */

import type { PlatformConfig, PlatformType } from './types';

/**
 * Detect the current Git hosting platform from environment variables.
 *
 * Uses `GITHUB_SERVER_URL` to determine the platform:
 * - `"https://github.com"` → GitHub
 * - URLs containing `"codeberg.org"` → Codeberg
 * - Anything else → Forgejo (self-hosted)
 *
 * The API base URL is derived from `GITHUB_API_URL` when set (all three
 * CI platforms set this), otherwise computed from the server URL.
 *
 * @returns The resolved platform configuration.
 */
export function detectPlatform(): PlatformConfig {
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com';

  let type: PlatformType;
  if (serverUrl === 'https://github.com') {
    type = 'github';
  } else if (serverUrl.includes('codeberg.org')) {
    type = 'codeberg';
  } else {
    type = 'forgejo';
  }

  // GITHUB_API_URL is set by all three CI platforms (GitHub Actions, Forgejo Actions).
  // Fall back to deriving from server URL for standalone usage.
  const apiBaseUrl =
    process.env.GITHUB_API_URL ??
    (type === 'github' ? 'https://api.github.com' : `${serverUrl}/api/v1`);

  return { type, serverUrl, apiBaseUrl };
}

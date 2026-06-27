/**
 * @file Server URL resolution for the GitHub Action entry point.
 *
 * Self-hosted runners (e.g. a Forgejo instance behind Docker networking) may
 * advertise a `GITHUB_SERVER_URL` that is only reachable from inside the host
 * network — `http://localhost:3000` or a Docker alias. URLs derived from that
 * value (commit/PR/action-run permalinks) and platform detection then point at
 * the wrong host. The `server_url` action input lets users override the
 * advertised value with the externally-reachable URL.
 *
 * The override is purely about *user-facing* URLs and platform detection — the
 * API client (Octokit) keeps using the runner-advertised `GITHUB_API_URL`,
 * which must remain reachable from inside the runner so API calls succeed.
 */

/**
 * Default server URL used when neither the input nor the runner-advertised
 * value is available. Matches `@actions/github`'s own fallback.
 */
export const DEFAULT_SERVER_URL = 'https://github.com';

/**
 * Resolve the effective forge server URL.
 *
 * Precedence (highest first):
 *   1. `serverUrlInput` — the `server_url` action input; an explicit override
 *      for self-hosted setups where the runner-advertised `GITHUB_SERVER_URL`
 *      points at an internally-reachable address.
 *   2. `contextServerUrl` — the value the runner advertises via the
 *      `GITHUB_SERVER_URL` environment variable (surfaced by `@actions/github`'s
 *      `context.serverUrl`). Setting that env var on the step is therefore an
 *      alternative way to override the URL without using the action input.
 *   3. {@link DEFAULT_SERVER_URL} — the canonical GitHub URL.
 *
 * Pure so it can be unit-tested independently of `@actions/core` /
 * `@actions/github`, which carry import-time side effects in `run.ts`.
 *
 * @param serverUrlInput - Raw value of the `server_url` action input (`core.getInput`
 *   already trims, but this is re-trimmed defensively).
 * @param contextServerUrl - The runner-advertised server URL
 *   (`github.context.serverUrl`), or `undefined`.
 * @returns The resolved, non-empty server URL.
 */
export function resolveServerUrl(
  serverUrlInput: string | undefined,
  contextServerUrl: string | undefined
): string {
  const override = serverUrlInput?.trim();
  if (override) {
    return override;
  }
  // Treat an empty/whitespace-only advertised URL as missing — a blank value
  // is never a usable server URL, so fall back to the default.
  const context = contextServerUrl?.trim();
  if (context) {
    return context;
  }
  return DEFAULT_SERVER_URL;
}

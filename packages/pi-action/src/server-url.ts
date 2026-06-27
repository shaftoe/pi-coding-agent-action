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
 * Strip every trailing slash from a URL.
 *
 * A root-less origin such as `https://git.example.com` is the canonical form
 * all URL builders expect, so normalizing at the source keeps downstream
 * template-literal permalink builders (commit/PR/action-run URLs) from
 * producing double-slash links when a user passes a trailing slash.
 */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Resolve the effective forge server URL.
 *
 * Precedence (highest first):
 *   1. `serverUrlInput` — the `server_url` action input; the single explicit
 *      override for self-hosted setups where the runner-advertised
 *      `GITHUB_SERVER_URL` points at an internally-reachable address.
 *   2. `contextServerUrl` — the value the runner advertises via the
 *      `GITHUB_SERVER_URL` environment variable (surfaced by `@actions/github`'s
 *      `context.serverUrl`), e.g. `https://github.com` on github.com or the
 *      GitHub Enterprise / Forgejo host on a properly configured runner.
 *   3. {@link DEFAULT_SERVER_URL} — the canonical GitHub URL.
 *
 * The `server_url` action input is the only supported override mechanism — to
 * avoid two confusing ways of doing the same thing, users should not also set
 * `GITHUB_SERVER_URL` on the step.
 *
 * Pure so it can be unit-tested independently of `@actions/core` /
 * `@actions/github`, which carry import-time side effects in `run.ts`.
 *
 * @param serverUrlInput - Raw value of the `server_url` action input (`core.getInput`
 *   already trims, but this is re-trimmed defensively).
 * @param contextServerUrl - The runner-advertised server URL
 *   (`github.context.serverUrl`), or `undefined`.
 * @returns The resolved, non-empty, trailing-slash-normalized server URL.
 */
export function resolveServerUrl(
  serverUrlInput: string | undefined,
  contextServerUrl: string | undefined
): string {
  const override = serverUrlInput?.trim();
  if (override) {
    return stripTrailingSlashes(override);
  }
  // Treat an empty/whitespace-only advertised URL as missing — a blank value
  // is never a usable server URL, so fall back to the default.
  const context = contextServerUrl?.trim();
  if (context) {
    return stripTrailingSlashes(context);
  }
  return DEFAULT_SERVER_URL;
}

/**
 * @file GitHub API token resolution.
 *
 * Canonical home for env-based token resolution shared by every consumer of
 * the GitHub/Codeberg/Forgejo REST API that talks to the platform directly
 * (e.g. {@link createGitHubPlatformProvider}'s callers in `pi-cli` and the
 * `pi-action-bridge` extension). The provider itself takes a
 * pre-authenticated Octokit, so resolving the token from the environment is
 * the caller's job — this is that helper.
 *
 * Env-var-only by design: no `--token` flags, no `gh auth token` fallback, no
 * keychain reads.
 */

/**
 * Resolve the GitHub API token from the environment.
 *
 * Resolution order (first non-empty match wins):
 *   1. `GITHUB_TOKEN`
 *   2. `GH_TOKEN`
 *
 * @param env - environment to read from (defaults to `process.env`).
 * @throws when neither is set. The message names both env vars so the error
 *   is actionable regardless of which the user prefers.
 */
export function resolveGitHubToken(env: NodeJS.ProcessEnv = process.env): string {
  const gh = env.GITHUB_TOKEN;
  if (gh && gh.trim() !== '') {
    return gh;
  }
  const ghShort = env.GH_TOKEN;
  if (ghShort && ghShort.trim() !== '') {
    return ghShort;
  }
  throw new Error(
    'Missing GitHub token. Set GITHUB_TOKEN (or GH_TOKEN) in your environment and retry.'
  );
}

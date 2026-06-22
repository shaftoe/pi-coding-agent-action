/**
 * @file Pure git-remote URL parsing.
 *
 * Converts a remote URL (SSH scp-like, `ssh://`, `https://`, `http://`,
 * `git://`) into a {@link ParsedRemote}. Supports GitHub, GitHub Enterprise,
 * Codeberg, Forgejo and Gitea hosts — the host is captured generically, and
 * the forge-specific REST base URL is derived later by
 * `apiBaseUrlFromServerUrl` (reused from `pi-platform-github`).
 *
 * Zero I/O — fully unit-testable.
 */
export interface ParsedRemote {
  /** Web URL of the forge host, e.g. `https://github.com`. */
  serverUrl: string;
  owner: string;
  repo: string;
}

/**
 * SSH scp-like form: `git@github.com:owner/repo.git` (also `user@host:...`).
 * Exactly two path segments after the colon (`owner/repo`).
 */
const SSH_SCP = /^[\w.+-]+@([\w.-]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/**
 * URL form: `ssh://`, `https://`, `http://`, `git://`, optional
 * `user@`, optional `:port`, then `owner/repo(.git)?`.
 */
const URL_FORM =
  /^(?:ssh|https?|git):\/\/(?:[^\s/@]+@)?([\w.-]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/**
 * Parse a remote URL into `{ serverUrl, owner, repo }`.
 *
 * `serverUrl` is reconstructed as `https://<host>` (the canonical web URL that
 * `apiBaseUrlFromServerUrl` expects). The `.git` suffix and a trailing slash
 * are stripped from the repo name.
 *
 * @returns `undefined` when the URL cannot be recognised.
 */
export function parseRemoteUrl(url: string): ParsedRemote | undefined {
  const trimmed = url.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = trimmed.match(SSH_SCP) ?? trimmed.match(URL_FORM);
  if (!match) {
    return undefined;
  }

  const host = match[1];
  const owner = match[2];
  const repo = match[3];
  if (!host || !owner || !repo) {
    return undefined;
  }

  return { serverUrl: `https://${host}`, owner, repo };
}

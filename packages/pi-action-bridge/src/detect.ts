/**
 * @file Platform detection from a git remote URL.
 *
 * Pure helpers that normalize a git remote URL (SSH or HTTPS form) into the
 * pieces the bridge needs: the forge {@link serverUrl} (for `detectPlatform`
 * and `apiBaseUrlFromServerUrl`), and the {@link owner}/{@link repo} (for the
 * synthetic {@link PlatformContext}).
 *
 * These are pure so they can be unit-tested without a real git repo. Git
 * discovery (actually reading the remote) lives in {@link ../bridge.ts}.
 */

import { detectPlatform } from '@alexanderfortin/pi-platform-github';
import type { PlatformType } from '@alexanderfortin/pi-orchestrator';

/** A parsed git remote: server URL + repo coordinates. */
export interface ParsedRemote {
  /** Normalized web origin, e.g. `https://github.com` (no trailing slash, no path). */
  serverUrl: string;
  /** Repository owner/user/org. */
  owner: string;
  /** Repository name, without a trailing `.git`. */
  repo: string;
}

/**
 * Parse a git remote URL (SSH `git@host:owner/repo.git`, HTTPS
 * `https://host/owner/repo.git`, or `https://host:port/owner/repo.git`)
 * into its {@link ParsedRemote} components.
 *
 * Returns `undefined` for anything that isn't a recognizable SSH or HTTPS
 * remote (e.g. a git:// protocol or a local path). Callers should treat that
 * as "not a forge remote" and go inert.
 *
 * @param remoteUrl - Raw remote URL from `git remote get-url origin`.
 */
// fallow-ignore-next-line complexity
export function parseRemoteUrl(remoteUrl: string): ParsedRemote | undefined {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  // SSH form: git@host:owner/repo.git  (or user@host:path)
  // The path uses a colon separator, not a slash.
  const sshMatch = /^([\w.-]+)@([\w.-]+):(.+)$/.exec(trimmed);
  if (sshMatch) {
    const host = sshMatch[2];
    const path = sshMatch[3];
    if (!host || !path) {
      return undefined;
    }
    const parsed = parseRepoPath(path);
    if (!parsed) {
      return undefined;
    }
    return { serverUrl: `https://${host}`, ...parsed };
  }

  // HTTPS form: https://host/owner/repo.git (optionally with userinfo
  // user:token@ and/or a :port). Strip everything but host + path.
  const httpsMatch = /^https?:\/\/(?:[^/@]+@)?([\w.-]+(?::\d+)?)(\/.+)$/.exec(trimmed);
  if (httpsMatch) {
    const hostAndPort = httpsMatch[1];
    const path = httpsMatch[2];
    if (!hostAndPort || !path) {
      return undefined;
    }
    const parsed = parseRepoPath(path);
    if (!parsed) {
      return undefined;
    }
    return { serverUrl: `https://${hostAndPort}`, ...parsed };
  }

  return undefined;
}

/**
 * Parse the `owner/repo.git` tail of a remote URL into owner + repo,
 * stripping a trailing `.git`. Rejects paths that aren't exactly two segments
 * (e.g. a bare host, or a nested subpath we don't model).
 */
function parseRepoPath(path: string): { owner: string; repo: string } | undefined {
  // Drop a leading slash (HTTPS path) and a trailing .git.
  const cleaned = path.replace(/^\/+/, '').replace(/\.git$/, '');
  const segments = cleaned.split('/');
  // Expect exactly owner/repo. Subpath-hosted repos (more than two segments)
  // are rare and not modeled here — return undefined so the bridge goes inert
  // rather than guessing.
  if (segments.length !== 2) {
    return undefined;
  }
  const owner = segments[0];
  const repo = segments[1];
  if (!owner || !repo) {
    return undefined;
  }
  return { owner, repo };
}

/**
 * Detect the forge platform from a git remote URL.
 *
 * Normalizes the remote (delegating to {@link parseRemoteUrl}) and then to
 * the shared {@link detectPlatform} in `pi-platform-github`. Returns
 * `undefined` when the remote isn't a recognizable SSH/HTTPS URL — callers
 * treat that as "not a forge remote" and stay inert.
 *
 * @param remoteUrl - Raw remote URL from `git remote get-url origin`.
 */
export function detectPlatformFromRemote(remoteUrl: string): PlatformType | undefined {
  const parsed = parseRemoteUrl(remoteUrl);
  if (!parsed) {
    return undefined;
  }
  return detectPlatform(parsed.serverUrl);
}

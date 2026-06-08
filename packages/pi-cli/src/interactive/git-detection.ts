/**
 * @file Git remote detection for auto-resolving --repo.
 *
 * When the user omits `--repo`, we attempt to detect it from the git
 * remote URL in the current working directory. Supports HTTPS and SSH
 * remote formats.
 */

import { execSync } from 'node:child_process';
import type { RepoRef } from '../context';

/**
 * Regex patterns for parsing git remote URLs.
 *
 * HTTPS: https://github.com/owner/repo.git
 * SSH:   git@github.com:owner/repo.git
 */
const HTTPS_REMOTE = /https?:\/\/[^/]+\/([^/]+)\/([^/.]+?)(?:\.git)?$/;
const SSH_REMOTE = /[^@]+@[^:]+:([^/]+)\/([^/.]+?)(?:\.git)?$/;

/**
 * Detect the repository from the git remote in the given directory.
 *
 * Reads the `origin` remote URL and parses it into an owner/repo pair.
 * Returns `undefined` if:
 * - The directory is not a git repository
 * - There is no `origin` remote
 * - The remote URL format is unrecognized
 *
 * @param cwd - Working directory to check.
 * @returns The detected RepoRef, or undefined.
 */
export function detectRepoFromGitRemote(cwd: string): RepoRef | undefined {
  try {
    const output = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    // Try HTTPS format
    const httpsMatch = HTTPS_REMOTE.exec(output);
    if (httpsMatch?.[1] && httpsMatch[2]) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    // Try SSH format
    const sshMatch = SSH_REMOTE.exec(output);
    if (sshMatch?.[1] && sshMatch[2]) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    return undefined;
  } catch {
    // Not a git repo, no origin remote, or git not installed
    return undefined;
  }
}

/**
 * Detect the HEAD SHA from the git repository.
 *
 * @param cwd - Working directory to check.
 * @returns The current HEAD SHA, or undefined.
 */
export function detectHeadSha(cwd: string): string | undefined {
  try {
    return execSync('git rev-parse HEAD', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Detect the git user name from the local config.
 *
 * @param cwd - Working directory to check.
 * @returns The configured user name, or undefined.
 */
export function detectGitUser(cwd: string): string | undefined {
  try {
    return (
      execSync('git config user.name', {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

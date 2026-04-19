/**
 * @file GitHub-specific file map building on top of the platform-agnostic scanner.
 *
 * Provides `buildFileMap` which fetches a Git tree via the GitHub REST API
 * and returns a reference file map suitable for use with the shared
 * `scanForChanges` function from `src/git/file-scanner`.
 *
 * Re-exports the shared scanner functions with GitHub-specific defaults
 * (workspace root, platform ignore patterns) applied.
 */

import * as github from '@actions/github';
import { getOctokit } from '../octokit';
import { GITHUB_IGNORE_PATTERNS } from '../constants';
import { createLogger } from './types';
import type { Logger } from '../../../git/types';
import {
  scanForChanges as sharedScanForChanges,
  scanDirectory,
} from '../../../git/file-scanner';
import type { ChangeScanResult, ScanDirectoryParams } from '../../../git/file-scanner';

// Re-export shared types and scanDirectory for direct use within the GitHub module
export type { ChangeScanResult, ScanDirectoryParams };
export { scanDirectory };

/**
 * Fetch blob content from GitHub.
 *
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param sha - Blob SHA.
 * @returns The decoded UTF-8 content, or null if fetching fails.
 */
async function fetchBlobContent(
  owner: string,
  repo: string,
  sha: string,
  log: Logger
): Promise<string | null> {
  try {
    const octokit = getOctokit();
    const blob = await octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: sha,
    });
    const content = Buffer.from(blob.data.content, 'base64').toString('utf-8');
    log.debug(`Fetched blob content: ${sha}`);
    return content;
  } catch (_e) {
    log.debug(`Failed to fetch blob content: ${sha}`);
    return null;
  }
}

/**
 * Build a map of files from a Git tree via the GitHub REST API.
 *
 * Fetches the tree and optionally fetches blob contents for comparison.
 * This is the GitHub-specific counterpart to the platform-agnostic scanner.
 *
 * @param treeSha - SHA of the tree to fetch.
 * @param fetchContents - Whether to fetch blob contents (default: true).
 * @param log - Logger instance for debug output.
 * @returns Map of path -> { sha, content }.
 */
export async function buildFileMap(
  treeSha: string,
  fetchContents = true,
  log: Logger = createLogger()
): Promise<Map<string, { sha: string; content: string | null }>> {
  const octokit = getOctokit();
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  log.debug(`fetching tree: ${treeSha}`);

  const tree = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: 'true',
  });

  log.debug(`tree contains ${tree.data.tree.length} items`);

  const fileMap = new Map<string, { sha: string; content: string | null }>();

  for (const item of tree.data.tree) {
    if (item.type === 'blob' && item.sha) {
      let content: string | null = null;
      if (fetchContents) {
        content = await fetchBlobContent(owner, repo, item.sha, log);
      }
      fileMap.set(item.path, { sha: item.sha, content });
    }
  }

  log.debug(`built file map with ${fileMap.size} files`);

  return fileMap;
}

/**
 * Scan the local workspace for file changes compared to a reference file map.
 *
 * This is a GitHub-aware wrapper around the shared `scanForChanges` that
 * supplies the GitHub workspace root and platform-specific ignore patterns.
 *
 * @param referenceFiles - Map of reference file paths to their SHA and content.
 * @param log - Logger instance for debug output.
 * @returns An object containing changed files and deleted files.
 */
export async function scanForChanges(
  referenceFiles: Map<string, { sha: string; content: string | null }>,
  log: Logger = createLogger()
): Promise<ChangeScanResult> {
  return sharedScanForChanges(referenceFiles, log, {
    repoRoot: process.env.GITHUB_WORKSPACE,
    ignorePatterns: GITHUB_IGNORE_PATTERNS,
  });
}

/**
 * @file Shared Git utilities for pull request operations.
 *
 * Contains common logic used by both create and update pull request flows:
 * - File change scanning and detection
 * - Blob and tree creation via Git Data API
 * - Commit creation and branch updates
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import ignore from 'ignore';
import { getOctokit } from './octokit.js';
import {
  FILE_MODE_DIRECTORY,
  FILE_MODE_EXECUTABLE,
  FILE_MODE_REGULAR,
  MAX_FILE_SIZE_BYTES,
  IGNORE_PATTERNS,
} from './constants.js';

const octokit = getOctokit();

/**
 * Git file mode types
 */
export type FileMode =
  | typeof FILE_MODE_REGULAR
  | typeof FILE_MODE_EXECUTABLE
  | typeof FILE_MODE_DIRECTORY;

/**
 * Create a logger with a custom emoji prefix.
 */
export function createLogger(emoji = '🔀') {
  return {
    debug: (msg: string): void => core.debug(`${emoji} ${msg}`),
    info: (msg: string): void => core.info(`${emoji} ${msg}`),
  };
}

/**
 * Fetch blob content from GitHub.
 *
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param sha - Blob SHA.
 * @returns The decoded UTF-8 content, or null if fetching fails.
 */
async function fetchBlobContent(owner: string, repo: string, sha: string): Promise<string | null> {
  try {
    const blob = await octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: sha,
    });
    return Buffer.from(blob.data.content, 'base64').toString('utf-8');
  } catch (_e) {
    // Could not fetch blob content
    return null;
  }
}

/**
 * Build a map of files from a Git tree.
 *
 * Fetches the tree and optionally fetches blob contents for comparison.
 *
 * @param treeSha - SHA of the tree to fetch.
 * @param fetchContents - Whether to fetch blob contents (default: true).
 * @returns Map of path -> { sha, content }.
 */
export async function buildFileMap(
  treeSha: string,
  fetchContents = true
): Promise<Map<string, { sha: string; content: string | null }>> {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  const tree = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: 'true',
  });

  const fileMap = new Map<string, { sha: string; content: string | null }>();

  for (const item of tree.data.tree) {
    if (item.type === 'blob' && item.sha) {
      let content: string | null = null;
      if (fetchContents) {
        content = await fetchBlobContent(owner, repo, item.sha);
      }
      fileMap.set(item.path, { sha: item.sha, content });
    }
  }

  return fileMap;
}

/**
 * Result of scanning for changes in the repository.
 */
export interface ChangeScanResult {
  /** Files that are new or modified */
  changedFiles: {
    path: string;
    content: string;
    mode: FileMode;
  }[];
  /** Files that exist in the reference but were deleted locally */
  deletedFiles: string[];
}

/**
 * Recursively scan the local repository for files that are new or modified
 * compared to a reference set of files. Also tracks files that have been deleted.
 *
 * Respects `.gitignore` and the additional {@link IGNORE_PATTERNS}. Skips
 * binary files and files larger than {@link MAX_FILE_SIZE_BYTES}.
 *
 * @param referenceFiles - Map of reference file paths to their SHA and content,
 *                         used for change detection.
 * @param log - Logger instance for debug output.
 * @returns An object containing changed files and deleted files.
 */
export async function scanForChanges(
  referenceFiles: Map<string, { sha: string; content: string | null }>,
  log = createLogger()
): Promise<ChangeScanResult> {
  log.debug(`Scanning local files for changes...`);

  const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const ig = ignore();
  try {
    const gitignoreContent = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf-8');
    ig.add(gitignoreContent);
  } catch (_e) {
    // No .gitignore file, that's fine
  }
  // Add additional patterns to always ignore
  ig.add(IGNORE_PATTERNS);

  const changedFiles: {
    path: string;
    content: string;
    mode: FileMode;
  }[] = [];

  // Track all files we encounter locally to detect deletions
  const localFilesEncountered = new Set<string>();

  async function scanDirectory(dir: string, relativePath = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativeFilePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (ig.ignores(relativeFilePath)) {
        log.debug(`Ignored: ${relativeFilePath}`);
        continue;
      }

      if (entry.isDirectory()) {
        await scanDirectory(fullPath, relativePath);
      } else if (entry.isFile()) {
        // Skip files that are too large (>1MB to be safe)
        const stats = await fs.stat(fullPath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          log.debug(`Skipping large file (>1MB): ${relativeFilePath}`);
          continue;
        }

        // Try to read file content, skip if binary
        let localContent: string;
        try {
          localContent = await fs.readFile(fullPath, 'utf-8');
        } catch (_e) {
          log.debug(`Skipping file (likely binary): ${relativeFilePath}`);
          continue;
        }

        const refFile = referenceFiles.get(relativeFilePath);

        // Check if file is new or modified
        let isChanged = false;
        if (!refFile) {
          // New file
          isChanged = true;
          log.debug(`New file: ${relativeFilePath}`);
        } else if (refFile.content !== null && refFile.content !== localContent) {
          // Modified file
          isChanged = true;
          log.debug(`Modified file: ${relativeFilePath}`);
        }

        if (isChanged) {
          changedFiles.push({
            path: relativeFilePath,
            content: localContent,
            mode: FILE_MODE_REGULAR,
          });
        }

        // Track that we found this file locally
        localFilesEncountered.add(relativeFilePath);
      }
    }
  }

  await scanDirectory(repoRoot, '');

  // Detect deleted files by comparing reference files with what we found locally
  const deletedFiles: string[] = [];
  for (const refFilePath of referenceFiles.keys()) {
    if (!localFilesEncountered.has(refFilePath)) {
      // This file exists in the reference but wasn't found locally - it was deleted
      deletedFiles.push(refFilePath);
      log.debug(`Deleted file: ${refFilePath}`);
    }
  }

  log.debug(
    `Found ${changedFiles.length} changed file(s) and ${deletedFiles.length} deleted file(s)`
  );
  return { changedFiles, deletedFiles };
}

/**
 * Upload changed files as Git blobs and create a tree that references them.
 * Handles both new/modified files and deleted files.
 *
 * @param changedFiles - Array of changed file descriptors.
 * @param deletedFiles - Array of file paths that were deleted.
 * @param parentSha - SHA of the parent commit to use as the tree's parent.
 * @param log - Logger instance for debug output.
 * @returns The SHA of the newly created tree.
 */
export async function createBlobsAndTree(
  changedFiles: {
    path: string;
    content: string;
    mode: FileMode;
  }[],
  deletedFiles: string[],
  parentSha: string,
  log = createLogger()
): Promise<string> {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  log.debug(`Creating blobs for changed files...`);

  // Create blobs for all changed files and map their paths to SHAs
  const blobShaMap = new Map<string, string>();
  for (const file of changedFiles) {
    const blob = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: Buffer.from(file.content).toString('base64'),
      encoding: 'base64',
    });
    blobShaMap.set(file.path, blob.data.sha);
    log.debug(`Created blob for ${file.path}: ${blob.data.sha}`);
  }
  log.debug(`Created ${blobShaMap.size} blob(s)`);

  // Create tree with all the blob references and deletions
  log.debug(`Creating tree with changes...`);
  const treeEntries = Array.from(blobShaMap.entries()).map(([path, sha]) => ({
    path,
    mode: FILE_MODE_REGULAR,
    type: 'blob' as const,
    sha,
  }));

  // Add deleted files with sha: null to remove them from the tree
  for (const deletedPath of deletedFiles) {
    treeEntries.push({
      path: deletedPath,
      mode: FILE_MODE_REGULAR,
      type: 'blob' as const,
      sha: null as unknown as string, // Setting sha to null deletes the file - type assertion for TypeScript
    });
    log.debug(`Marked for deletion: ${deletedPath}`);
  }

  const tree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: parentSha,
    tree: treeEntries,
  });
  log.debug(`Created tree: ${tree.data.sha}`);

  return tree.data.sha;
}

/**
 * Create a commit on the given tree and point the branch reference at it.
 *
 * @param treeSha - SHA of the tree containing the changed files.
 * @param parentSha - SHA of the parent commit.
 * @param branchName - Name of the branch to update.
 * @param message - Commit message.
 * @param log - Logger instance for debug output.
 * @returns The SHA of the new commit.
 */
export async function createCommitAndUpdateBranch(
  treeSha: string,
  parentSha: string,
  branchName: string,
  message: string,
  log = createLogger()
): Promise<string> {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  // Create a single commit with the new tree
  log.debug(`Creating commit...`);
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: treeSha,
    parents: [parentSha],
  });
  log.debug(`Created commit: ${commit.data.sha}`);

  // Update the branch reference to point to the new commit
  log.debug(`Updating branch reference...`);
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: commit.data.sha,
  });
  log.debug(`Branch updated successfully`);

  return commit.data.sha;
}

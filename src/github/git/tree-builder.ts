/**
 * @file Blob and tree creation operations.
 *
 * Uploads changed files as Git blobs and creates trees that reference them.
 */

import * as github from '@actions/github';
import { getOctokit } from '../octokit.js';
import { FILE_MODE_REGULAR } from '../constants.js';
import { createLogger, FileMode } from './types.js';

const octokit = getOctokit();

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

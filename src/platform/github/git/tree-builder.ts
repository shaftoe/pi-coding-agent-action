/**
 * @file Blob and tree creation operations.
 *
 * Uploads changed files as Git blobs and creates trees that reference them.
 */

import * as github from '@actions/github';
import { getOctokit } from '../octokit';
import { FILE_MODE_REGULAR } from '../constants';
import { createLogger, FileMode, TreeEntry } from './types';

/**
 * Parameters for blob and tree creation operation.
 */
export interface CreateBlobsAndTreeParams {
  /** Array of changed file descriptors. */
  changedFiles: {
    path: string;
    content: string;
    mode: FileMode;
  }[];
  /** Array of file paths that were deleted. */
  deletedFiles: string[];
  /** SHA of the parent commit to use as the tree's parent. */
  parentSha: string;
  /** Logger instance for debug output. */
  log: ReturnType<typeof createLogger>;
}

/**
 * Upload changed files as Git blobs and create a tree that references them.
 * Handles both new/modified files and deleted files.
 *
 * @param params - Parameters controlling the blob and tree creation operation.
 * @returns The SHA of the newly created tree.
 */
export async function createBlobsAndTree(params: CreateBlobsAndTreeParams): Promise<string> {
  const { changedFiles, deletedFiles, parentSha, log = createLogger() } = params;
  const owner = github.context.repo.owner;
  const octokit = getOctokit();
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
  const treeEntries: TreeEntry[] = Array.from(blobShaMap.entries()).map(([path, sha]) => ({
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
      sha: null, // Setting sha to null deletes the file
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

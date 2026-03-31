/**
 * @file Commit and branch update operations.
 *
 * Creates commits on trees and updates branch references.
 */

import * as github from '@actions/github';
import { getOctokit } from '../octokit.js';
import { createLogger } from './types.js';

const octokit = getOctokit();

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

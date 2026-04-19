/**
 * @file Commit and branch update operations.
 *
 * Creates commits on trees and updates branch references.
 */

import * as github from '@actions/github';
import { getOctokit } from '../octokit';
import { createLogger } from './types';

/**
 * Parameters for commit creation and branch update operation.
 */
export interface CreateCommitAndUpdateBranchParams {
  /** SHA of the tree containing the changed files. */
  treeSha: string;
  /** SHA of the parent commit. */
  parentSha: string;
  /** Name of the branch to update. */
  branchName: string;
  /** Commit message. */
  message: string;
  /** Logger instance for debug output. */
  log?: ReturnType<typeof createLogger>;
}

/**
 * Create a commit on the given tree and point the branch reference at it.
 *
 * @param params - Parameters controlling the commit creation and branch update operation.
 * @returns The SHA of the new commit.
 */
export async function createCommitAndUpdateBranch(
  params: CreateCommitAndUpdateBranchParams
): Promise<string> {
  const { treeSha, parentSha, branchName, message, log = createLogger() } = params;
  const octokit = getOctokit();
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

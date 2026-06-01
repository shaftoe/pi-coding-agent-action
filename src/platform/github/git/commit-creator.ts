/**
 * @file Commit and branch update operations.
 *
 * Creates commits on trees and updates branch references.
 */

import { createLogger } from './types';
import type { GitHubModuleDeps } from '../types';
import type { Logger } from '../../../git/types';

/**
 * Append a Co-authored-by trailer to the commit message.
 *
 * Uses the current GitHub Actions actor (the user who triggered the workflow)
 * to generate a standard `Co-authored-by` trailer. If the actor is not
 * available (e.g. running outside of GitHub Actions), the original message
 * is returned unchanged.
 *
 * @param deps - Module dependencies.
 * @param message - The original commit message.
 * @returns The commit message with a Co-authored-by trailer appended.
 */
export function appendCoAuthoredBy(deps: GitHubModuleDeps, message: string): string {
  const actor = (deps.context.payload as { actor?: string }).actor;
  if (!actor) {
    return message;
  }
  return `${message}\n\nCo-authored-by: ${actor} <${actor}@users.noreply.github.com>`;
}

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
  log?: Logger;
}

/**
 * Create a commit on the given tree and point the branch reference at it.
 *
 * @param deps - Module dependencies.
 * @param params - Parameters controlling the commit creation and branch update operation.
 * @returns The SHA of the new commit.
 */
export async function createCommitAndUpdateBranch(
  deps: GitHubModuleDeps,
  params: CreateCommitAndUpdateBranchParams
): Promise<string> {
  const { treeSha, parentSha, branchName, message, log = createLogger(deps) } = params;
  const owner = deps.context.repo.owner;
  const repo = deps.context.repo.repo;

  // Create a single commit with the new tree
  log.debug(`Creating commit...`);
  const commitMessage = appendCoAuthoredBy(deps, message);
  const commit = await deps.octokit.rest.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: treeSha,
    parents: [parentSha],
  });
  log.debug(`Created commit: ${commit.data.sha}`);

  // Update the branch reference to point to the new commit
  log.debug(`Updating branch reference...`);
  await deps.octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: commit.data.sha,
  });
  log.debug(`Branch updated successfully`);

  return commit.data.sha;
}

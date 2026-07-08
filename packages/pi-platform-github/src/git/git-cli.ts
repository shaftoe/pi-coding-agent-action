/**
 * @file Git CLI helpers backed by `simple-git`.
 *
 * Replaces the broken Git Data API write endpoints (`git.createRef`,
 * `git.createBlob`, `git.createTree`, `git.createCommit`, `git.updateRef`)
 * which return 404/405 on Forgejo/Gitea. The `git` CLI works uniformly
 * across GitHub, Forgejo, Gitea, and Codeberg and reuses the credentials
 * already configured by `actions/checkout`.
 *
 * All write operations (branch creation, commit, push) go through these
 * helpers. Read operations (`git.getTree`, `git.getBlob`, `repos.getBranch`)
 * still use the REST API since they work on all platforms.
 */

import { simpleGit, type SimpleGit } from 'simple-git';
import type { GitHubModuleDeps } from '../types';

/**
 * Default git identity used when the CI environment doesn't pre-configure
 * `user.name`/`user.email` (common on Forgejo/Gitea runners).
 */
const DEFAULT_GIT_NAME = 'pi-coding-agent';
const DEFAULT_GIT_EMAIL = 'pi-coding-agent@users.noreply.github.com';

/**
 * Append a `Co-authored-by` trailer to the commit message.
 *
 * Uses the current GitHub Actions actor (the user who triggered the workflow)
 * to generate a standard `Co-authored-by` trailer. If the actor is not
 * available (e.g. running outside of GitHub Actions), the original message
 * is returned unchanged.
 *
 * @param deps - Module dependencies.
 * @param message - The original commit message.
 * @returns The commit message with a `Co-authored-by` trailer appended.
 */
export function appendCoAuthoredBy(deps: GitHubModuleDeps, message: string): string {
  const actor = deps.context.actor;
  if (!actor) {
    return message;
  }
  return `${message}\n\nCo-authored-by: ${actor} <${actor}@users.noreply.github.com>`;
}

/**
 * Ensure git `user.name` and `user.email` are configured.
 *
 * Forgejo runners don't pre-configure git identity. If the identity is
 * missing, set a **local** one (scoped to the repo) so we don't touch the
 * user's global config.
 */
export async function ensureGitIdentity(
  git: SimpleGit,
  actor?: string,
  log?: { debug: (msg: string) => void }
): Promise<void> {
  const name = actor ?? DEFAULT_GIT_NAME;
  const email = actor ? `${actor}@users.noreply.github.com` : DEFAULT_GIT_EMAIL;

  // Check if identity is already configured (global or local)
  let currentName: string | undefined;
  let currentEmail: string | undefined;
  try {
    const nameResult = await git.getConfig('user.name');
    currentName = nameResult.value ?? undefined;
    const emailResult = await git.getConfig('user.email');
    currentEmail = emailResult.value ?? undefined;
  } catch {
    // Not configured — will set below
  }

  if (!currentName?.trim()) {
    await git.addConfig('user.name', name, false, 'local');
    log?.debug(`Configured git user.name: ${name}`);
  }
  if (!currentEmail?.trim()) {
    await git.addConfig('user.email', email, false, 'local');
    log?.debug(`Configured git user.email: ${email}`);
  }
}

/**
 * Check if the working tree at the given path has uncommitted or untracked
 * changes.
 *
 * Convenience wrapper that creates a `simple-git` instance internally.
 *
 * @param cwd - Working-tree directory.
 * @returns `true` when there are staged, unstaged, or untracked changes.
 */
export async function workspaceHasChanges(cwd: string): Promise<boolean> {
  return hasLocalChanges(simpleGit(cwd));
}

/**
 * Check if the working tree has uncommitted or untracked changes.
 *
 * @param git - A `simple-git` instance.
 * @returns `true` when there are staged, unstaged, or untracked changes.
 */
export async function hasLocalChanges(git: SimpleGit): Promise<boolean> {
  const status = await git.status();
  return !status.isClean();
}

/**
 * Checkout an existing remote branch locally, preserving working-tree changes.
 *
 * Used by `update_pull_request` when the workspace is checked out at a
 * different ref (e.g. the base branch) but we need to commit to the PR's
 * head branch. Working-tree changes are stashed before the checkout and
 * restored afterwards.
 *
 * @throws when `git stash pop` fails (branch has diverged in the same files).
 */
export async function checkoutExistingBranch(
  git: SimpleGit,
  branchName: string,
  log: { debug: (msg: string) => void; warning: (msg: string) => void }
): Promise<void> {
  const hasChanges = await hasLocalChanges(git);

  if (hasChanges) {
    log.debug(`Stashing working-tree changes before checkout…`);
    await git.stash(['push', '--include-untracked', '-m', 'pi-agent-changes']);
  }

  // Fetch the branch from origin so we have the latest tip
  await git.fetch('origin', branchName);

  // Create or reset the local branch to match the remote
  try {
    await git.checkoutBranch(branchName, `origin/${branchName}`);
  } catch {
    // Branch already exists locally — reset to remote tip
    await git.checkout(branchName);
    await git.raw(['reset', '--hard', `origin/${branchName}`]);
  }

  if (hasChanges) {
    log.debug(`Restoring stashed changes…`);
    try {
      await git.stash(['pop']);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warning(`Failed to restore stashed changes: ${message}`);
      throw new Error(
        `Could not cleanly apply working-tree changes onto branch "${branchName}". ` +
          `This usually means the branch has diverged from the base in files the agent modified. ` +
          `Original error: ${message}`
      );
    }
  }
}

/**
 * Options for {@link commitAndPushBranch}.
 */
export interface CommitAndPushOptions {
  /** Working-tree directory (the workspace root). */
  cwd: string;
  /** Target branch name. */
  branchName: string;
  /** Commit message (may include `Co-authored-by` trailers). */
  message: string;
  /**
   * `true` for `create_pull_request` (creates a **new** branch from the
   * current HEAD); `false` for `update_pull_request` (checks out an
   * existing remote branch).
   */
  isNewBranch: boolean;
  /** CI actor, used for git identity when none is configured. */
  actor?: string | undefined;
  /** Logger for debug/warning output. */
  log: { debug: (msg: string) => void; warning: (msg: string) => void };
}

/**
 * Stage all working-tree changes, commit, and push to a remote branch.
 *
 * For **new branches** (`isNewBranch: true`): creates a local branch from
 * the current HEAD (`git checkout -b`), commits, and pushes with
 * `--set-upstream`.
 *
 * For **existing branches** (`isNewBranch: false`): checks out the remote
 * branch (preserving working-tree changes via stash), commits, and pushes.
 *
 * @returns The SHA of the created commit.
 */
export async function commitAndPushBranch(options: CommitAndPushOptions): Promise<string> {
  const { cwd, branchName, message, isNewBranch, actor, log } = options;

  const git = simpleGit(cwd);

  // Ensure git identity is configured (Forgejo runners have none)
  await ensureGitIdentity(git, actor, log);

  if (isNewBranch) {
    log.debug(`Creating new branch "${branchName}" from current HEAD…`);
    await git.checkoutLocalBranch(branchName);
  } else {
    log.debug(`Checking out existing branch "${branchName}"…`);
    await checkoutExistingBranch(git, branchName, log);
  }

  // Stage all changes (including deletions)
  log.debug(`Staging changes…`);
  await git.add('-A');

  // Commit
  log.debug(`Committing…`);
  await git.commit(message);

  // Push
  log.debug(`Pushing to origin/${branchName}…`);
  if (isNewBranch) {
    await git.push('origin', branchName, { '--set-upstream': null });
  } else {
    await git.push('origin', branchName);
  }

  // Get the commit SHA
  const sha = (await git.revparse('HEAD')).trim();
  log.debug(`Committed ${sha} and pushed to ${branchName}`);

  return sha;
}

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
import ignore from 'ignore';
import type { GitHubModuleDeps } from '../types';
import { GITHUB_IGNORE_PATTERNS } from '../constants';

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
 * Result of {@link getWorkspaceChangePaths}: changed/deleted paths from
 * `git status --porcelain`, filtered by platform ignore patterns.
 */
export interface WorkspaceChangePaths {
  /** New or modified file paths to stage with `git add`. */
  changed: string[];
  /** Deleted file paths to stage for removal. */
  deleted: string[];
}

/**
 * Get changed file paths from `git status --porcelain -uall`, filtered by the
 * platform ignore patterns (e.g. the pi workflow YAML file).
 *
 * The `-uall` (`--untracked-files=all`) flag ensures that entirely-new
 * directories are expanded to their individual files instead of collapsing
 * to a single `?? dir/` entry. This keeps the reported file count accurate
 * and applies ignore patterns on a per-file basis.
 *
 * This replaces the old `buildFileMap` + `scanForChanges` round-trip over
 * the Git Data API (which returns 404/405 on Forgejo/Gitea). `.gitignore`
 * is respected automatically by `git status`; additional platform-level
 * patterns are applied via {@link GITHUB_IGNORE_PATTERNS}.
 *
 * @param cwd - Working-tree directory.
 * @returns Filtered changed and deleted paths.
 */
export async function getWorkspaceChangePaths(cwd: string): Promise<WorkspaceChangePaths> {
  const git = simpleGit(cwd);
  const output = await git.raw(['status', '--porcelain', '-uall']);

  const ig = ignore().add([...GITHUB_IGNORE_PATTERNS]);
  const changed: string[] = [];
  const deleted: string[] = [];

  if (!output.trim()) {
    return { changed, deleted };
  }

  for (const line of output.split('\n')) {
    if (!line) {
      continue;
    }
    // Porcelain format: "XY path" where X = index status, Y = working tree status
    const x = line[0]!;
    const y = line[1]!;
    let filePath = line.substring(3);

    // Handle renames: "R  old_path -> new_path"
    const arrowIndex = filePath.indexOf(' -> ');
    if (arrowIndex !== -1) {
      filePath = filePath.substring(arrowIndex + 4);
    }

    // Remove surrounding quotes (git quotes paths with special chars)
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }

    // Skip if ignored by platform patterns (e.g. pi workflow file)
    if (ig.ignores(filePath)) {
      continue;
    }

    // 'D' in either status position means deleted
    if (x === 'D' || y === 'D') {
      deleted.push(filePath);
    } else {
      changed.push(filePath);
    }
  }

  return { changed, deleted };
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
    // Branch already exists locally — reset to remote tip.
    // Destructive but safe: this is an ephemeral CI checkout, and we just
    // fetched the authoritative remote tip. Any local-only commits would
    // be from a previous, failed run and should be discarded.
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
  /**
   * Specific file paths to stage. Must be non-empty — derived from
   * {@link getWorkspaceChangePaths} (changed + deleted) so that platform
   * ignore patterns are respected and stray files can't leak into the
   * commit. An empty array throws to enforce this invariant.
   */
  paths: string[];
  /** Logger for debug/warning output. */
  log: { debug: (msg: string) => void; warning: (msg: string) => void };
}

/**
 * Stage the specified file paths, commit, and push to a remote branch.
 *
 * For **new branches** (`isNewBranch: true`): creates a local branch from
 * the current HEAD (`git checkout -b`), commits, and pushes with
 * `--set-upstream`.
 *
 * For **existing branches** (`isNewBranch: false`): checks out the remote
 * branch (preserving working-tree changes via stash), commits, and pushes.
 *
 * @throws when `paths` is empty — callers must always pass filtered paths
 *   from {@link getWorkspaceChangePaths} to respect platform ignore patterns.
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

  // Stage only the specified paths. This enforces the invariant that
  // platform ignore patterns (GITHUB_IGNORE_PATTERNS) are always respected
  // — `git add -A` would bypass them and could leak stray files (e.g.
  // pi-workflow edits) into the commit.
  if (options.paths.length === 0) {
    throw new Error(
      'commitAndPushBranch requires at least one path to stage. ' +
        'Callers must pass filtered paths from getWorkspaceChangePaths().'
    );
  }
  log.debug(`Staging ${options.paths.length} path(s)…`);
  await git.add(options.paths);

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

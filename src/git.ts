import * as core from '@actions/core';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import * as fs from 'fs';
import type { GitAuthor } from './types.js';

// ── Configuration ─────────────────────────────────────────────
const GIT_DIR = process.cwd();
const GIT_AUTHOR: GitAuthor = {
  name: 'pi-agent[bot]',
  email: 'pi-agent[bot]@users.noreply.github.com',
};
let authToken = '';

/**
 * Configures git with the GitHub token for authentication.
 * @param token - The GitHub personal access token
 */
export async function configureGit(token: string): Promise<void> {
  authToken = token;
  process.env.GITHUB_TOKEN = token;
  core.info('Git configured');
}

// ── Auth Helper ───────────────────────────────────────────────
function createOnAuth() {
  return async () => ({
    username: 'oauth2',
    password: authToken,
  });
}

// ── Status Operations ─────────────────────────────────────────
/**
 * Gets the current HEAD commit SHA.
 * @returns The HEAD commit SHA, or null if not available
 */
async function getHeadCommit(): Promise<string | null> {
  try {
    const HEAD = await git.resolveRef({ fs, dir: GIT_DIR, ref: 'HEAD' });
    return HEAD;
  } catch {
    return null;
  }
}

/**
 * Gets the current branch name.
 * @returns The current branch name, or null if not available
 */
export async function getCurrentBranch(): Promise<string | null> {
  try {
    const branch = await git.currentBranch({ fs, dir: GIT_DIR });
    return branch ?? null;
  } catch {
    return null;
  }
}

/**
 * Checks if the current branch has uncommitted changes.
 * @returns True if the branch is dirty, false otherwise
 */
export async function branchIsDirty(): Promise<boolean> {
  try {
    const status = await git.statusMatrix({ fs, dir: GIT_DIR, ref: 'HEAD' });
    return status.some(([, head, worktree, stage]) => head !== worktree || worktree !== stage);
  } catch {
    return false;
  }
}

// ── Remote Operations ───────────────────────────────────────
/**
 * Adds a git remote if it doesn't already exist.
 * @param name - The remote name
 * @param url - The remote URL
 */
async function addRemote(name: string, url: string): Promise<void> {
  const remotes = await git.listRemotes({ fs, dir: GIT_DIR });
  const remoteExists = remotes.some(r => r.remote === name);

  if (!remoteExists) {
    await git.addRemote({ fs, dir: GIT_DIR, remote: name, url });
    core.info(`Added remote ${name}`);
  }
}

/**
 * Fetches a branch from a remote repository.
 * @param remoteUrl - The URL of the remote repository
 * @param remote - The remote name
 * @param branch - The branch name to fetch
 * @param depth - Optional fetch depth (default: all history)
 */
export async function fetchBranch(
  remoteUrl: string,
  remote: string,
  branch: string,
  depth?: number
): Promise<void> {
  core.info(`Fetching ${remote}/${branch} from ${remoteUrl}`);

  await addRemote(remote, remoteUrl);

  await git.fetch({
    fs,
    http,
    dir: GIT_DIR,
    remote,
    ref: branch,
    depth,
    singleBranch: true,
    onAuth: createOnAuth(),
    onProgress: progress => {
      if (progress.phase && progress.loaded) {
        core.debug(`${progress.phase}: ${progress.loaded}/${progress.total}`);
      }
    },
  });

  core.info(`Fetched ${remote}/${branch}`);
}

// ── Checkout Operations ─────────────────────────────────────
/**
 * Checks out a branch, optionally creating it.
 * @param branch - The branch name
 * @param createNew - Whether to create a new branch (default: false)
 */
export async function checkoutBranch(branch: string, createNew = false): Promise<void> {
  core.info(`Checking out ${branch}${createNew ? ' (new branch)' : ''}`);

  if (createNew) {
    const currentHead = await getHeadCommit();
    if (!currentHead) {
      throw new Error('Cannot create branch: no HEAD commit found');
    }
    await git.branch({
      fs,
      dir: GIT_DIR,
      ref: branch,
      object: currentHead,
      checkout: true,
    });
  } else {
    await git.checkout({
      fs,
      dir: GIT_DIR,
      ref: branch,
    });
  }

  core.info(`Checked out ${branch}`);
}

// ── Stage and Commit ─────────────────────────────────────
/**
 * Stages all changes in the working directory.
 */
async function stageAll(): Promise<void> {
  core.info('Staging all changes');
  const status = await git.statusMatrix({ fs, dir: GIT_DIR, ref: 'HEAD' });

  for (const [filepath, head, workdir, _stage] of status) {
    // File is modified
    if (head !== workdir) {
      const workdirNum = workdir as number;
      if (workdirNum === 2) {
        // Deleted
        await git.remove({
          fs,
          dir: GIT_DIR,
          filepath: filepath,
        });
      } else if (workdirNum === 1 || workdirNum === 3) {
        // Modified or added
        await git.add({
          fs,
          dir: GIT_DIR,
          filepath: filepath,
        });
      }
    }
  }
}

/**
 * Commits staged changes with the given message.
 * @param message - The commit message
 * @param author - The author information
 * @returns The commit SHA
 */
async function commitChanges(
  message: string,
  author: { name: string; email: string }
): Promise<string> {
  core.info(`Committing: ${message}`);

  const result = await git.commit({
    fs,
    dir: GIT_DIR,
    message,
    author,
    committer: GIT_AUTHOR,
  });

  core.info(`Committed: ${result}`);
  return result;
}

// ── Push Operations ───────────────────────────────────────
/**
 * Pushes a branch to a remote.
 * @param remote - The remote name
 * @param branch - The branch name
 * @param force - Whether to force push (default: false)
 */
async function pushBranch(remote: string, branch: string, force = false): Promise<void> {
  core.info(`Pushing ${branch} to ${remote}${force ? ' (force)' : ''}`);

  await git.push({
    fs,
    http,
    dir: GIT_DIR,
    remote,
    ref: branch,
    force,
    onAuth: createOnAuth(),
  });

  core.info(`Pushed ${branch} to ${remote}`);
}

/**
 * Commits all changes with a summary and pushes to a remote.
 * @param summary - The commit message
 * @param author - The author information
 * @param remote - The remote name
 * @param branch - The branch name
 */
export async function commitAndPush(
  summary: string,
  author: { name: string; email: string },
  remote: string,
  branch: string
): Promise<void> {
  await stageAll();
  await commitChanges(summary, author);
  await pushBranch(remote, branch);
}

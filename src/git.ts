import * as core from '@actions/core';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';
import type { GitAuthor } from './types.js';

// ── Configuration ─────────────────────────────────────────────
const GIT_DIR = process.cwd();
const GIT_AUTHOR: GitAuthor = {
  name: 'pi-agent[bot]',
  email: 'pi-agent[bot]@users.noreply.github.com',
};
let authToken = '';

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
export async function getHeadCommit(): Promise<string | null> {
  try {
    const HEAD = await git.resolveRef({ fs, dir: GIT_DIR, ref: 'HEAD' });
    return HEAD;
  } catch {
    return null;
  }
}

export async function branchIsDirty(): Promise<boolean> {
  try {
    const status = await git.statusMatrix({ fs, dir: GIT_DIR, ref: 'HEAD' });
    return status.some(([, head, worktree, stage]) => head !== worktree || worktree !== stage);
  } catch {
    return false;
  }
}

// ── Remote Operations ───────────────────────────────────────
export async function addRemote(name: string, url: string): Promise<void> {
  const remotes = await git.listRemotes({ fs, dir: GIT_DIR });
  const remoteExists = remotes.some(r => r.remote === name);

  if (!remoteExists) {
    await git.addRemote({ fs, dir: GIT_DIR, remote: name, url });
    core.info(`Added remote ${name}`);
  }
}

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
export async function stageAll(): Promise<void> {
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

export async function commitChanges(
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
export async function pushBranch(remote: string, branch: string, force = false): Promise<void> {
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

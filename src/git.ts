import * as core from '@actions/core';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import * as fs from 'fs';
import * as github from '@actions/github';
import { generateBranchName } from './utils.js';
import { DEFAULT_FETCH_DEPTH } from './constants.js';
import type { GitAuthor, PRNode } from './types.js';

// ── GitService Class ─────────────────────────────────────────
/**
 * Git operations service with embedded authentication.
 * Encapsulates git operations and authentication token for better testability.
 */
export class GitService {
  private readonly dir: string;
  private readonly author: GitAuthor;
  private readonly token: string;

  constructor(token: string, dir: string = process.cwd()) {
    this.token = token;
    this.dir = dir;
    this.author = {
      name: 'pi-agent[bot]',
      email: 'pi-agent[bot]@users.noreply.github.com',
    };
    process.env.GITHUB_TOKEN = token;
    core.info('Git service initialized');
  }

  // ── Auth Helper ───────────────────────────────────────────────
  private createOnAuth() {
    return async () => ({
      username: 'oauth2',
      password: this.token,
    });
  }

  // ── Status Operations ─────────────────────────────────────────
  /**
   * Gets the current HEAD commit SHA.
   * @returns The HEAD commit SHA, or null if not available
   */
  private async getHeadCommit(): Promise<string | null> {
    try {
      const HEAD = await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' });
      return HEAD;
    } catch {
      return null;
    }
  }

  /**
   * Gets the current branch name.
   * @returns The current branch name, or null if not available
   */
  async getCurrentBranch(): Promise<string | null> {
    try {
      const branch = await git.currentBranch({ fs, dir: this.dir });
      return branch ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Checks if the current branch has uncommitted changes.
   * @returns True if branch is dirty, false otherwise
   */
  async branchIsDirty(): Promise<boolean> {
    try {
      const status = await git.statusMatrix({ fs, dir: this.dir, ref: 'HEAD' });
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
  private async addRemote(name: string, url: string): Promise<void> {
    const remotes = await git.listRemotes({ fs, dir: this.dir });
    const remoteExists = remotes.some(r => r.remote === name);

    if (!remoteExists) {
      await git.addRemote({ fs, dir: this.dir, remote: name, url });
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
  async fetchBranch(
    remoteUrl: string,
    remote: string,
    branch: string,
    depth?: number
  ): Promise<void> {
    core.info(`Fetching ${remote}/${branch} from ${remoteUrl}`);

    await this.addRemote(remote, remoteUrl);

    await git.fetch({
      fs,
      http,
      dir: this.dir,
      remote,
      ref: branch,
      depth,
      singleBranch: true,
      onAuth: this.createOnAuth(),
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
  async checkoutBranch(branch: string, createNew = false): Promise<void> {
    core.info(`Checking out ${branch}${createNew ? ' (new branch)' : ''}`);

    if (createNew) {
      const currentHead = await this.getHeadCommit();
      if (!currentHead) {
        throw new Error('Cannot create branch: no HEAD commit found');
      }
      await git.branch({
        fs,
        dir: this.dir,
        ref: branch,
        object: currentHead,
        checkout: true,
      });
    } else {
      await git.checkout({
        fs,
        dir: this.dir,
        ref: branch,
      });
    }

    core.info(`Checked out ${branch}`);
  }

  /**
   * Checks out a PR branch, handling both local PRs and fork PRs.
   * @param pr - The PR data
   * @param issueNumber - The PR number
   * @returns The remote and branch name
   */
  async checkoutPRBranch(
    pr: PRNode,
    issueNumber: number
  ): Promise<{ remote: 'origin' | 'fork'; branchName: string }> {
    const isLocalPR = pr.headRepository.nameWithOwner === pr.baseRepository.nameWithOwner;
    core.info(`Processing PR #${issueNumber} (local: ${isLocalPR})`);

    const depth = Math.max(pr.commits.totalCount, DEFAULT_FETCH_DEPTH);

    if (isLocalPR) {
      const originUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}.git`;
      await this.fetchBranch(originUrl, 'origin', pr.headRefName, depth);
      await this.checkoutBranch(pr.headRefName);
      return { remote: 'origin', branchName: pr.headRefName };
    } else {
      const localBranch = generateBranchName('pr', issueNumber);
      const forkUrl = `https://github.com/${pr.headRepository.nameWithOwner}.git`;
      await this.fetchBranch(forkUrl, 'fork', pr.headRefName, depth);
      await this.checkoutBranch(localBranch, true);
      return { remote: 'fork', branchName: pr.headRefName };
    }
  }

  // ── Stage and Commit ─────────────────────────────────────
  /**
   * Stages all changes in the working directory.
   */
  private async stageAll(): Promise<void> {
    core.info('Staging all changes');
    const status = await git.statusMatrix({ fs, dir: this.dir, ref: 'HEAD' });

    for (const [filepath, head, workdir, _stage] of status) {
      // File is modified
      if (head !== workdir) {
        // workdir status codes: 0 (absent), 1 (present), 2 (modified), 3 (deleted)
        // Note: type-safe check for git status codes
        const workdirStatus = workdir as 0 | 1 | 2 | 3;
        if (workdirStatus === 2) {
          // Modified - need to remove old version
          await git.remove({
            fs,
            dir: this.dir,
            filepath: filepath,
          });
        } else if (workdirStatus === 1 || workdirStatus === 3) {
          // Present or deleted in worktree - stage change
          await git.add({
            fs,
            dir: this.dir,
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
  private async commitChanges(
    message: string,
    author: { name: string; email: string }
  ): Promise<string> {
    core.info(`Committing: ${message}`);

    const result = await git.commit({
      fs,
      dir: this.dir,
      message,
      author,
      committer: this.author,
    });

    core.info(`Committed: ${result}`);
    return result;
  }

  // ── Push Operations ───────────────────────────────────────
  /**
   * Pushes a branch to a remote and sets up tracking.
   * @param remote - The remote name
   * @param branch - The branch name
   * @param force - Whether to force push (default: false)
   */
  private async pushBranch(remote: string, branch: string, force = false): Promise<void> {
    core.info(`Pushing ${branch} to ${remote}${force ? ' (force)' : ''}`);

    // Ensure the remote exists with a proper URL
    const remotes = await git.listRemotes({ fs, dir: this.dir });
    const remoteEntry = remotes.find(r => r.remote === remote);

    if (!remoteEntry) {
      // If the remote doesn't exist in isomorphic-git's config, add it
      // using the default GitHub repository URL
      const remoteUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}.git`;
      core.info(`Remote '${remote}' not found in git config, adding: ${remoteUrl}`);
      await this.addRemote(remote, remoteUrl);
    }

    // Try to push using the branch name refspec first
    const refspec = `refs/heads/${branch}:refs/heads/${branch}`;
    core.debug(`Attempting push with refspec: ${refspec}`);

    try {
      await git.push({
        fs,
        http,
        dir: this.dir,
        remote,
        ref: refspec,
        force,
        onAuth: this.createOnAuth(),
      });
      core.info(`Pushed ${branch} to ${remote}`);
    } catch (err) {
      // If the branch refspec fails, try pushing using the HEAD commit SHA
      core.warning(`Push with branch refspec failed, trying with HEAD commit SHA: ${err}`);
      const headCommit = await this.getHeadCommit();
      if (!headCommit) {
        throw new Error('Cannot push: no HEAD commit found');
      }

      const shaRefspec = `${headCommit}:refs/heads/${branch}`;
      core.debug(`Attempting push with SHA refspec: ${shaRefspec}`);

      await git.push({
        fs,
        http,
        dir: this.dir,
        remote,
        ref: shaRefspec,
        force,
        onAuth: this.createOnAuth(),
      });

      core.info(`Pushed ${branch} to ${remote} using HEAD commit`);
    }
  }

  /**
   * Commits all changes with a summary and pushes to a remote.
   * @param summary - The commit message
   * @param author - The author information
   * @param remote - The remote name
   * @param branch - The branch name
   */
  async commitAndPush(
    summary: string,
    author: { name: string; email: string },
    remote: string,
    branch: string
  ): Promise<void> {
    await this.stageAll();
    await this.commitChanges(summary, author);
    await this.pushBranch(remote, branch);
  }
}

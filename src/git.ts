import * as core from '@actions/core';
import * as github from '@actions/github';
import * as isoGit from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'node:fs';
import type { GitAuthor } from './types.js';
import { DEFAULT_COMMITTER_NAME, DEFAULT_COMMITTER_EMAIL } from './constants.js';

// ── Constants ────────────────────────────────────────────────
/**
 * Default committer for git commits made by the pi agent.
 */
const DEFAULT_COMMITTER: GitAuthor = {
  name: DEFAULT_COMMITTER_NAME,
  email: DEFAULT_COMMITTER_EMAIL,
};

// ── GitService Class ─────────────────────────────────────────
/**
 * Simplified Git operations service using isomorphic-git.
 * Assumes the repository is already checked out by actions/checkout.
 */
export class GitService {
  private readonly dir: string;
  private readonly token: string;

  constructor(token: string, dir: string = process.cwd()) {
    this.token = token;
    this.dir = dir;
    core.info('Git service initialized');
  }

  // ── Status Operations ─────────────────────────────────────
  /**
   * Checks if the working directory has uncommitted changes.
   * @returns true if there are uncommitted changes, false otherwise
   * @throws Error if unable to check git status
   */
  async branchIsDirty(): Promise<boolean> {
    const statusMatrix = await isoGit.statusMatrix({
      fs,
      dir: this.dir,
    });

    // Check if any file has uncommitted changes
    // statusMatrix returns [filepath, head, workdir, stage]
    // If workdir (index 2) differs from head (index 1), or stage (index 3) differs, there are changes
    for (const row of statusMatrix) {
      if (row[1] !== row[2] || row[2] !== row[3]) {
        return true;
      }
    }
    return false;
  }

  // ── Credential Configuration ───────────────────────────────
  /**
   * Validates and logs git credential configuration.
   *
   * Note: This is a no-op for isomorphic-git which handles credentials via
   * onAuth callbacks during push. The method is kept for potential future
   * enhancements and to validate repository context availability.
   */
  async configureCredentials(): Promise<void> {
    // Check if GitHub context is available (may not be in test environments)
    try {
      const repo = github.context?.repo;
      if (repo) {
        const { owner, repo: repoName } = repo;
        core.debug(`Git context validated for ${owner}/${repoName}`);
      } else {
        core.debug('Git context validation skipped (no github context)');
      }
    } catch (error) {
      // Only silence errors related to missing context - rethrow others
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('context') && !errorMsg.includes('undefined')) {
        throw error;
      }
      core.debug(`Git context validation skipped: ${errorMsg}`);
    }
    // Credentials are provided via onAuth callback during push operations
  }

  // ── Checkout Operations ───────────────────────────────────
  /**
   * Creates and checks out a new branch from the current state.
   */
  async checkoutBranch(branch: string): Promise<void> {
    core.info(`Creating and checking out branch ${branch}`);

    // Get current HEAD
    const currentHead = await isoGit.resolveRef({
      fs,
      dir: this.dir,
      ref: 'HEAD',
    });

    // Create new branch at current HEAD
    await isoGit.branch({
      fs,
      dir: this.dir,
      ref: branch,
      object: currentHead,
    });

    // Check out the new branch
    await isoGit.checkout({
      fs,
      dir: this.dir,
      ref: branch,
    });

    core.info(`Checked out ${branch}`);
  }

  // ── Commit and Push ───────────────────────────────────────
  /**
   * Stages all changes, commits, and pushes to origin.
   */
  async commitAndPush(
    summary: string,
    author: { name: string; email: string },
    branch: string
  ): Promise<void> {
    const { owner, repo } = github.context.repo;
    core.info(`GitHub context: owner="${owner}", repo="${repo}"`);

    if (!owner || !repo) {
      throw new Error(
        `Invalid repository context: owner="${owner}", repo="${repo}". Cannot construct push URL.`
      );
    }

    const authUrl = `https://github.com/${owner}/${repo}.git`;
    core.info(`Pushing to URL: ${authUrl}`);

    core.info('Staging all changes');

    // Get status matrix to find all files
    const statusMatrix = await isoGit.statusMatrix({
      fs,
      dir: this.dir,
    });

    // Stage all modified/added/deleted files
    for (const row of statusMatrix) {
      const [filepath, , workdir] = row;

      if (workdir === 2) {
        // File deleted
        await isoGit.remove({
          fs,
          dir: this.dir,
          filepath,
        });
      } else {
        // File added or modified
        await isoGit.add({
          fs,
          dir: this.dir,
          filepath,
        });
      }
    }

    core.info(`Committing: ${summary}`);
    await isoGit.commit({
      fs,
      dir: this.dir,
      message: summary,
      author,
      committer: DEFAULT_COMMITTER,
    });

    core.info(`Pushing ${branch} to origin`);

    // Push with embedded auth token
    await isoGit.push({
      fs,
      http,
      dir: this.dir,
      url: authUrl,
      ref: `refs/heads/${branch}`,
      onAuth: () => ({
        username: 'oauth2',
        password: this.token,
      }),
      onProgress: progress => {
        if (progress.phase) {
          core.debug(`Git push: ${progress.phase} ${progress.loaded || 0}/${progress.total || 0}`);
        }
      },
    });

    core.info('Push complete');
  }

  // ── Helper Methods ─────────────────────────────────────────
}

import * as core from '@actions/core';
import * as github from '@actions/github';
import * as isoGit from 'isomorphic-git';
import fs from 'node:fs';
import type { GitAuthor } from './types.js';

// ── GitService Class ─────────────────────────────────────────
/**
 * Simplified Git operations service using isomorphic-git.
 * Assumes the repository is already checked out by actions/checkout.
 */
export class GitService {
  private readonly dir: string;
  private readonly committer: GitAuthor;
  private readonly token: string;
  private readonly fs: typeof fs;

  constructor(token: string, dir: string = process.cwd()) {
    this.token = token;
    this.dir = dir;
    this.committer = {
      name: 'pi-agent[bot]',
      email: 'pi-agent[bot]@users.noreply.github.com',
    };
    this.fs = fs;
    core.info('Git service initialized');
  }

  // ── Status Operations ─────────────────────────────────────
  /**
   * Checks if the working directory has uncommitted changes.
   */
  async branchIsDirty(): Promise<boolean> {
    try {
      const statusMatrix = await isoGit.statusMatrix({
        fs: this.fs,
        dir: this.dir,
      });

      // Check if any file has uncommitted changes
      for (const row of statusMatrix) {
        // statusMatrix returns [filepath, head, workdir, stage]
        // If workdir (index 2) differs from head (index 1), there are uncommitted changes
        if (row[1] !== row[2] || row[2] !== row[3]) {
          return true;
        }
      }
      return false;
    } catch (error) {
      core.warning(`Failed to check git status: ${error}`);
      return false;
    }
  }

  // ── Credential Configuration ───────────────────────────────
  /**
   * Configures git credentials for the current repository.
   * This is done before running pi agent so it can detect push permissions.
   *
   * Note: isomorphic-git handles credentials via onAuth callbacks during push,
   * so this method is kept for compatibility but does minimal configuration.
   */
  async configureCredentials(): Promise<void> {
    const { owner, repo } = github.context.repo;
    core.info(`Git credentials configured for ${owner}/${repo}`);
    // isomorphic-git doesn't need credential helper configuration
    // Credentials are provided via onAuth callback during push
  }

  // ── Checkout Operations ───────────────────────────────────
  /**
   * Creates and checks out a new branch from the current state.
   */
  async checkoutBranch(branch: string): Promise<void> {
    core.info(`Creating and checking out branch ${branch}`);

    try {
      // Get current HEAD
      const currentHead = await isoGit.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: 'HEAD',
      });

      // Create new branch at current HEAD
      await isoGit.branch({
        fs: this.fs,
        dir: this.dir,
        ref: branch,
        object: currentHead,
      });

      // Check out the new branch
      await isoGit.checkout({
        fs: this.fs,
        dir: this.dir,
        ref: branch,
      });

      core.info(`Checked out ${branch}`);
    } catch (error) {
      core.error(`Failed to checkout branch ${branch}: ${error}`);
      throw error;
    }
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
    const authUrl = `https://github.com/${owner}/${repo}.git`;

    core.info('Staging all changes');

    // Get status matrix to find all files
    const statusMatrix = await isoGit.statusMatrix({
      fs: this.fs,
      dir: this.dir,
    });

    // Stage all modified/added/deleted files
    for (const row of statusMatrix) {
      const [filepath, , workdir] = row;

      if (workdir === 2) {
        // File deleted
        await isoGit.remove({
          fs: this.fs,
          dir: this.dir,
          filepath,
        });
      } else {
        // File added or modified
        await isoGit.add({
          fs: this.fs,
          dir: this.dir,
          filepath,
        });
      }
    }

    core.info(`Committing: ${summary}`);
    await isoGit.commit({
      fs: this.fs,
      dir: this.dir,
      message: summary,
      author,
      committer: this.committer,
    });

    core.info(`Pushing ${branch} to origin`);

    // Push with embedded auth token
    await isoGit
      .push({
        fs: this.fs,
        http: (await this.getHttpClient()) as any,
        dir: this.dir,
        url: authUrl,
        ref: `refs/heads/${branch}`,
        onAuth: () => ({
          username: this.token,
          password: 'x-oauth-basic',
        }),
        onProgress: progress => {
          if (progress.phase) {
            core.debug(
              `Git push: ${progress.phase} ${progress.loaded || 0}/${progress.total || 0}`
            );
          }
        },
      })
      .catch((err: Error) => {
        core.error(`Push failed: ${err.message}`);
        throw err;
      });

    core.info('Push complete');
  }

  // ── Helper Methods ─────────────────────────────────────────

  /**
   * Gets the appropriate HTTP client for isomorphic-git.
   * Uses node-fetch for making HTTP requests.
   */
  private async getHttpClient() {
    // Import node-fetch dynamically
    const nodeFetch = (await import('node-fetch')).default;

    return {
      async request(options: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string | Buffer | null | AsyncIterable<Uint8Array>;
      }) {
        const response = await nodeFetch(options.url, {
          method: options.method ?? 'GET',
          headers: options.headers ?? {},
          body: options.body as any,
        });

        const headers: Record<string, string> = {};
        response.headers.forEach((value: string, key: string) => {
          headers[key] = value;
        });

        return {
          url: options.url,
          method: options.method ?? 'GET',
          headers,
          body: response.body,
          statusCode: response.status,
          statusMessage: response.statusText,
        };
      },
    };
  }
}

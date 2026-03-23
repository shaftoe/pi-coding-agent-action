import * as core from '@actions/core';
import * as github from '@actions/github';
import { HttpClient } from '@actions/http-client';
import * as isoGit from 'isomorphic-git';
import fs from 'node:fs';
import type { GitAuthor } from './types.js';

// ── Constants ────────────────────────────────────────────────
/**
 * Default committer for git commits made by the pi agent.
 */
const DEFAULT_COMMITTER: GitAuthor = {
  name: 'pi-agent[bot]',
  email: 'pi-agent[bot]@users.noreply.github.com',
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
    try {
      const { owner, repo } = github.context.repo;
      core.debug(`Git context validated for ${owner}/${repo}`);
    } catch {
      // Context may not be available in test environments
      core.debug('Git context validation skipped (no github context)');
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
    const authUrl = `https://github.com/${owner}/${repo}.git`;

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
      http: await this.getHttpClient(),
      dir: this.dir,
      url: authUrl,
      ref: `refs/heads/${branch}`,
      onAuth: () => ({
        username: this.token,
        password: 'x-oauth-basic',
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

  /**
   * Gets the appropriate HTTP client for isomorphic-git.
   * Uses @actions/http-client for making HTTP requests.
   */
  private async getHttpClient() {
    const httpClient = new HttpClient();

    return {
      async request(options: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        body?: string | Buffer | null | AsyncIterable<Uint8Array>;
      }) {
        // Convert body to format expected by @actions/http-client
        let body: string | ReadableStream | null = null;
        if (typeof options.body === 'string') {
          body = options.body;
        } else if (Buffer.isBuffer(options.body)) {
          body = options.body.toString('utf-8');
        }
        // AsyncIterable is not supported by HttpClient, skip body for those cases

        const response = await httpClient.request(
          options.url,
          options.method ?? 'GET',
          body,
          options.headers
        );

        const statusCode = response.message.statusCode ?? 0;
        const statusMessage = response.message.statusMessage ?? '';

        // Check for HTTP errors
        if (statusCode >= 400) {
          throw new Error(`HTTP ${statusCode} ${statusMessage}: Failed to fetch ${options.url}`);
        }

        return {
          url: options.url,
          method: options.method ?? 'GET',
          headers: response.message.headers as Record<string, string>,
          body: response.message as unknown as AsyncIterableIterator<Uint8Array>,
          statusCode,
          statusMessage,
        };
      },
    };
  }
}

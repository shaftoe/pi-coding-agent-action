import * as core from '@actions/core';
import * as github from '@actions/github';
import { runCommand } from './utils.js';
import { generateBranchName } from './utils.js';
import { DEFAULT_FETCH_DEPTH } from './constants.js';
import type { GitAuthor, PRNode } from './types.js';

// ── GitService Class ─────────────────────────────────────────
/**
 * Git operations service using system git CLI.
 * Uses the standard git commands available in GitHub Actions environment.
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
    core.info('Git service initialized');
  }

  // ── Git Command Helper ─────────────────────────────────────
  /**
   * Runs a git command in the working directory.
   */
  private git(args: string[]): string {
    return runCommand(['git', '-C', this.dir, ...args]);
  }

  /**
   * Runs a git command and returns its output, or returns undefined on failure.
   */
  private gitQuiet(args: string[]): string | undefined {
    try {
      return runCommand(['git', '-C', this.dir, ...args]);
    } catch {
      return undefined;
    }
  }

  // ── Status Operations ─────────────────────────────────────
  /**
   * Gets the current HEAD commit SHA.
   * @returns The HEAD commit SHA, or null if not available
   */
  private getHeadCommit(): string | null {
    try {
      return this.gitQuiet(['rev-parse', 'HEAD']) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Gets the current branch name.
   * @returns The current branch name, or null if not available
   */
  getCurrentBranch(): string | null {
    try {
      return this.gitQuiet(['rev-parse', '--abbrev-ref', 'HEAD']) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Checks if the current branch has uncommitted changes.
   * @returns True if branch is dirty, false otherwise
   */
  branchIsDirty(): boolean {
    try {
      const output = this.gitQuiet(['status', '--porcelain']);
      return output !== undefined && output.trim().length > 0;
    } catch {
      return false;
    }
  }

  // ── Remote Operations ────────────────────────────────────
  /**
   * Gets the remote URL for a given remote name.
   * @param remote - The remote name
   * @returns The remote URL, or null if not found
   */
  private getRemoteUrl(remote: string): string | null {
    try {
      return this.gitQuiet(['remote', 'get-url', remote]) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Adds a git remote if it doesn't already exist.
   * @param name - The remote name
   * @param url - The remote URL
   */
  private addRemote(name: string, url: string): void {
    if (this.getRemoteUrl(name) === null) {
      this.git(['remote', 'add', name, url]);
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

    // Add the remote with the auth token embedded
    const authUrl = remoteUrl.replace(
      'https://github.com/',
      `https://x-access-token:${this.token}@github.com/`
    );

    this.addRemote(remote, authUrl);

    const depthArgs = depth ? [`--depth=${depth}`] : [];
    this.git(['fetch', remote, branch, ...depthArgs]);

    core.info(`Fetched ${remote}/${branch}`);
  }

  // ── Checkout Operations ───────────────────────────────────
  /**
   * Checks out a branch, optionally creating it.
   * @param branch - The branch name
   * @param createNew - Whether to create a new branch (default: false)
   */
  checkoutBranch(branch: string, createNew = false): void {
    core.info(`Checking out ${branch}${createNew ? ' (new branch)' : ''}`);

    if (createNew) {
      this.git(['checkout', '-b', branch]);
    } else {
      this.git(['checkout', branch]);
    }

    core.info(`Checked out ${branch}`);
  }

  /**
   * Checks out a PR branch, handling both local PRs and fork PRs.
   * @param pr - The PR data
   * @param issueNumber - The PR number
   * @returns The remote and branch name for pushing changes
   */
  async checkoutPRBranch(
    pr: PRNode,
    issueNumber: number
  ): Promise<{ remote: string; branchName: string; headRefName: string; isLocalPR: boolean }> {
    const isLocalPR = pr.headRepository.nameWithOwner === pr.baseRepository.nameWithOwner;
    core.info(`Processing PR #${issueNumber} (local: ${isLocalPR})`);

    const depth = Math.max(pr.commits.totalCount, DEFAULT_FETCH_DEPTH);

    if (isLocalPR) {
      const originUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}.git`;
      await this.fetchBranch(originUrl, 'origin', pr.headRefName, depth);
      this.checkoutBranch(pr.headRefName);
      return {
        remote: 'origin',
        branchName: pr.headRefName,
        headRefName: pr.headRefName,
        isLocalPR,
      };
    } else {
      const localBranch = generateBranchName('pr', issueNumber);
      const forkUrl = `https://github.com/${pr.headRepository.nameWithOwner}.git`;
      await this.fetchBranch(forkUrl, 'fork', pr.headRefName, depth);
      this.checkoutBranch(localBranch, true);
      // For fork PRs, we'll push to origin with a different branch name
      return { remote: 'fork', branchName: localBranch, headRefName: pr.headRefName, isLocalPR };
    }
  }

  // ── Stage and Commit ────────────────────────────────────
  /**
   * Stages all changes in the working directory.
   */
  private stageAll(): void {
    core.info('Staging all changes');
    this.git(['add', '-A']);
  }

  /**
   * Commits staged changes with the given message.
   * @param message - The commit message
   * @param author - The author information
   * @returns The commit SHA
   */
  private commitChanges(message: string, author: { name: string; email: string }): string {
    core.info(`Committing: ${message}`);

    const result = this.git([
      '-c',
      `user.name="${author.name}"`,
      '-c',
      `user.email="${author.email}"`,
      '-c',
      `committer.name="${this.author.name}"`,
      '-c',
      `committer.email="${this.author.email}"`,
      'commit',
      '-m',
      message,
    ]);

    core.info(`Committed`);
    return result.trim();
  }

  // ── Push Operations ──────────────────────────────────────
  /**
   * Pushes a branch to a remote.
   * @param remote - The remote name
   * @param branch - The branch name
   * @param force - Whether to force push (default: false)
   */
  private pushBranch(remote: string, branch: string, force = false): void {
    core.info(`Pushing ${branch} to ${remote}${force ? ' (force)' : ''}`);

    const forceArgs = force ? ['--force'] : [];
    this.git(['push', remote, `HEAD:${branch}`, ...forceArgs]);

    core.info(`Pushed ${branch} to ${remote}`);
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
    this.stageAll();
    this.commitChanges(summary, author);
    this.pushBranch(remote, branch);
  }
}

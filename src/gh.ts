import * as core from '@actions/core';
import * as github from '@actions/github';
import { runCommand } from './utils.js';
import { GH_TIMEOUT_MS, type GitHubReaction } from './constants.js';
import type { IssueNode, PRNode } from './types.js';

// ── GitHubClient ─────────────────────────────────────────────
/**
 * A client for interacting with GitHub features via both the GitHub CLI and Octokit API.
 * Provides methods for issue/PR data retrieval, comments, reactions, and PR creation.
 *
 * @internal This class is exported primarily for testing purposes. Use the singleton {@link gh} instance instead.
 */
class GitHubClient {
  private readonly token: string;
  private octokitInstance: ReturnType<typeof github.getOctokit> | undefined;

  constructor(token?: string) {
    this.token = token ?? core.getInput('github_token');
  }

  /**
   * Gets the Octokit client for GitHub API operations.
   * Cached to avoid creating multiple instances.
   */
  private getOctokit() {
    this.octokitInstance ??= github.getOctokit(this.token);
    return this.octokitInstance;
  }

  /**
   * Gets the repository context (owner, repo).
   */
  private getRepoContext() {
    return github.context.repo;
  }

  /**
   * Parses JSON output from GitHub CLI commands with consistent error handling.
   * @param output - The JSON string to parse
   * @param dataType - The type of data being parsed (e.g., "issue", "PR")
   * @param number - The issue/PR number for error context
   * @returns The parsed JSON object
   * @throws Error with context about the parsing failure
   */
  private parseJSONOutput<T>(output: string, dataType: string, number: number): T {
    try {
      return JSON.parse(output) as T;
    } catch (e) {
      throw new Error(
        `Failed to parse ${dataType} data for #${number}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /**
   * Runs a GitHub CLI command with authentication.
   * @param command - The command arguments (without 'gh' prefix)
   * @param options - Optional input to provide to stdin
   * @returns The stdout output from the command
   * @throws Error with context about the command that failed
   */
  cli(command: string[], options?: { input?: string }): string {
    const env = { ...process.env };
    if (this.token) {
      env.GH_TOKEN = this.token;
    }

    try {
      return runCommand(['gh', ...command], { ...options, timeout: GH_TIMEOUT_MS }, env);
    } catch (error) {
      // Enhance error message with command context
      const commandStr = `gh ${command.join(' ')}`;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`GitHub CLI command failed: ${commandStr}\n${message}`);
    }
  }

  /**
   * Gets issue data from GitHub.
   * @param issueNumber - The issue number
   * @returns The issue data including title, body, author, and comments
   * @throws Error if the issue cannot be found or parsed
   */
  getIssueData(issueNumber: number): IssueNode {
    const output = this.cli([
      'issue',
      'view',
      `${issueNumber}`,
      '--json',
      'title,body,state,author,createdAt,comments',
    ]);
    return this.parseJSONOutput<IssueNode>(output, 'issue', issueNumber);
  }

  /**
   * Gets PR data from GitHub.
   * @param prNumber - The PR number
   * @returns The PR data including title, body, files, and reviews
   * @throws Error if the PR cannot be found or parsed
   */
  getPRData(prNumber: number): PRNode {
    const output = this.cli([
      'pr',
      'view',
      `${prNumber}`,
      '--json',
      'title,body,state,author,baseRefName,headRefName,headRepository,additions,deletions,commits,files,reviews,comments',
    ]);
    const prData = this.parseJSONOutput<PRNode>(output, 'PR', prNumber);

    // baseRepository is not available from gh CLI, so we populate it from context
    const { owner, repo } = this.getRepoContext();
    prData.baseRepository = { nameWithOwner: `${owner}/${repo}` };

    return prData;
  }

  /**
   * Creates a comment on an issue or PR using Octokit.
   * @param issueNumber - The issue/PR number
   * @param body - The comment body
   */
  async createComment(issueNumber: number, body: string): Promise<void> {
    const octokit = this.getOctokit();
    const { owner, repo } = this.getRepoContext();

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  }

  /**
   * Adds a reaction to a comment using Octokit.
   * @param commentId - The comment ID to react to
   * @param content - The reaction content (e.g., 'eyes', 'rocket', '+1')
   * @returns The reaction ID, which can be used to remove the reaction later
   */
  async addReaction(commentId: number, content: GitHubReaction): Promise<number> {
    const octokit = this.getOctokit();
    const { owner, repo } = this.getRepoContext();

    const result = await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      content,
    });

    return result.data.id;
  }

  /**
   * Removes a reaction from a comment using Octokit.
   * @param commentId - The comment ID the reaction belongs to
   * @param reactionId - The reaction ID to remove
   */
  async removeReaction(commentId: number, reactionId: number): Promise<void> {
    const octokit = this.getOctokit();
    const { owner, repo } = this.getRepoContext();

    await octokit.rest.reactions.deleteForIssueComment({
      owner,
      repo,
      comment_id: commentId,
      reaction_id: reactionId,
    });
  }

  /**
   * Creates a new pull request using Octokit.
   * @param base - The base branch name
   * @param head - The head branch name
   * @param title - The PR title
   * @param body - The PR body
   * @returns The PR number
   */
  async createPR(base: string, head: string, title: string, body: string): Promise<number> {
    const octokit = this.getOctokit();
    const { owner, repo } = this.getRepoContext();

    const result = await octokit.rest.pulls.create({
      owner,
      repo,
      base,
      head,
      title,
      body,
    });

    return result.data.number;
  }
}

// ── Singleton Instance ───────────────────────────────────────
/**
 * The default GitHub client instance for use throughout the application.
 * Uses the GITHUB_TOKEN from action inputs.
 */
export const gh = new GitHubClient();

// ── Exports ─────────────────────────────────────────────────
export { GitHubClient };

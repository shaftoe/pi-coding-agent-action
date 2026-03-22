import * as core from '@actions/core';
import * as github from '@actions/github';
import { runCommand } from './utils.js';
import type { IssueNode, PRNode } from './types.js';

// ── GitHub API Client (Octokit) ───────────────────────────────
/**
 * Gets the Octokit client for GitHub API operations.
 */
function getOctokit() {
  const token = core.getInput('github_token');
  return github.getOctokit(token);
}

// ── GitHub CLI Wrapper ───────────────────────────────────────
/**
 * Runs a GitHub CLI command with authentication.
 * @param command - The command arguments (without 'gh' prefix)
 * @param options - Optional input to provide to stdin
 * @returns The stdout output from the command
 */
export function gh(command: string[], options?: { input?: string }): string {
  return runCommand(['gh', ...command], options);
}

// ── Issue Operations ───────────────────────────────────────
/**
 * Gets issue data from GitHub.
 * @param issueNumber - The issue number
 * @returns The issue data including title, body, author, and comments
 * @throws Error if the issue cannot be found or parsed
 */
export function getIssueData(issueNumber: number): IssueNode {
  const output = gh([
    'issue',
    'view',
    `${issueNumber}`,
    '--json',
    'title,body,state,author,createdAt,comments',
  ]);
  try {
    return JSON.parse(output);
  } catch (e) {
    throw new Error(`Failed to parse issue data: ${e}`);
  }
}

/**
 * Creates a comment on an issue or PR using Octokit.
 * @param issueNumber - The issue/PR number
 * @param body - The comment body
 */
export async function createComment(issueNumber: number, body: string): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo } = github.context.repo;

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
 */
export async function addReaction(commentId: number, content: string): Promise<void> {
  const octokit = getOctokit();
  const { owner, repo } = github.context.repo;

  await octokit.rest.reactions.createForIssueComment({
    owner,
    repo,
    comment_id: commentId,
    content: content as '+1' | '-1' | 'laugh' | 'hooray' | 'confused' | 'heart' | 'rocket' | 'eyes',
  });
}

// ── PR Operations ─────────────────────────────────────────
/**
 * Gets PR data from GitHub.
 * @param prNumber - The PR number
 * @returns The PR data including title, body, files, and reviews
 * @throws Error if the PR cannot be found or parsed
 */
export function getPRData(prNumber: number): PRNode {
  const output = gh([
    'pr',
    'view',
    `${prNumber}`,
    '--json',
    'title,body,state,author,baseRefName,headRefName,headRepository,baseRepository,additions,deletions,commits,files,reviews,comments',
  ]);
  try {
    return JSON.parse(output);
  } catch (e) {
    throw new Error(`Failed to parse PR data: ${e}`);
  }
}

/**
 * Creates a new pull request using Octokit.
 * @param base - The base branch name
 * @param head - The head branch name
 * @param title - The PR title
 * @param body - The PR body
 * @returns The PR number
 */
export async function createPR(
  base: string,
  head: string,
  title: string,
  body: string
): Promise<number> {
  const octokit = getOctokit();
  const { owner, repo } = github.context.repo;

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

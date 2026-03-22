import * as core from '@actions/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCommand } from './utils.js';
import type { IssueNode, PRNode } from './types.js';

// ── GitHub CLI Wrapper ───────────────────────────────────────
/**
 * Runs a GitHub CLI command.
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
 * Creates a comment on an issue or PR.
 * @param issueNumber - The issue/PR number
 * @param body - The comment body
 */
export async function createComment(issueNumber: number, body: string): Promise<void> {
  // Write body to a temporary file to avoid parsing issues with special characters
  const tmpFile = path.join(os.tmpdir(), `gh-comment-body-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, body, 'utf8');

  try {
    gh(['issue', 'comment', `${issueNumber}`, '--body-file', tmpFile]);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (e) {
      core.debug(`Failed to clean up temp file: ${e}`);
    }
  }
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

function getPRByHead(branch: string): number {
  const output = gh(['pr', 'list', '--head', branch, '--json', 'number', '--limit', '1']);
  try {
    const results = JSON.parse(output);
    if (!results || results.length === 0) {
      throw new Error(`No PR found with head branch: ${branch}`);
    }
    return results[0].number;
  } catch (e) {
    if (e instanceof Error && e.message.includes('No PR found')) {
      throw e;
    }
    throw new Error(`Failed to parse PR list data: ${e}`);
  }
}

/**
 * Creates a new pull request.
 * @param base - The base branch name
 * @param branch - The head branch name
 * @param title - The PR title
 * @param body - The PR body
 * @returns The PR number
 */
export async function createPR(
  base: string,
  branch: string,
  title: string,
  body: string
): Promise<number> {
  // Write body to a temporary file to avoid parsing issues with special characters
  const tmpFile = path.join(os.tmpdir(), `gh-pr-body-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, body, 'utf8');

  try {
    gh([
      'pr',
      'create',
      '--base',
      base,
      '--head',
      branch,
      '--title',
      title,
      '--body-file',
      tmpFile,
    ]);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch (e) {
      core.debug(`Failed to clean up temp file: ${e}`);
    }
  }

  // Get the PR number from the created PR using the head branch
  return getPRByHead(branch);
}

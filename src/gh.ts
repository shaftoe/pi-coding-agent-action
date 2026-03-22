import { runCommand } from './utils.js';
import type { IssueNode, PRNode } from './types.js';

// ── GitHub CLI Wrapper ───────────────────────────────────────
export function gh(command: string[], options?: { input?: string }): string {
  return runCommand(['gh', ...command], options);
}

// ── Issue Operations ───────────────────────────────────────
export function getIssueData(issueNumber: number): IssueNode {
  const output = gh([
    'issue',
    'view',
    `${issueNumber}`,
    '--json',
    'title,body,state,author,createdAt,comments',
  ]);
  return JSON.parse(output);
}

export function createComment(issueNumber: number, body: string): void {
  gh(['issue', 'comment', `${issueNumber}`, '--body', body]);
}

// ── PR Operations ─────────────────────────────────────────
export function getPRData(prNumber: number): PRNode {
  const output = gh([
    'pr',
    'view',
    `${prNumber}`,
    '--json',
    'title,body,state,author,baseRefName,headRefName,headRepository,baseRepository,additions,deletions,commits,files,reviews,comments',
  ]);
  return JSON.parse(output);
}

export function createPR(base: string, branch: string, title: string, body: string): number {
  gh(['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body]);
  // Get the PR number from the created PR using the head branch
  const output = gh(['pr', 'view', '--json', 'number', '--head', branch]);
  const result = JSON.parse(output);
  return result.number;
}

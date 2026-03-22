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

export async function createComment(issueNumber: number, body: string): Promise<void> {
  // Write body to a temporary file to avoid parsing issues with special characters
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const tmpFile = path.join(os.tmpdir(), `gh-comment-body-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, body, 'utf8');

  try {
    gh(['issue', 'comment', `${issueNumber}`, '--body-file', tmpFile]);
  } finally {
    fs.unlinkSync(tmpFile);
  }
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

function getPRByHead(branch: string): number {
  const output = gh(['pr', 'list', '--head', branch, '--json', 'number', '--limit', '1']);
  const results = JSON.parse(output);
  if (!results || results.length === 0) {
    throw new Error(`No PR found with head branch: ${branch}`);
  }
  return results[0].number;
}

export async function createPR(
  base: string,
  branch: string,
  title: string,
  body: string
): Promise<number> {
  // Write body to a temporary file to avoid parsing issues with special characters
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
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
    fs.unlinkSync(tmpFile);
  }

  // Get the PR number from the created PR using the head branch
  return getPRByHead(branch);
}

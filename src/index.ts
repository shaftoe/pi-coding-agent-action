import git from 'isomorphic-git';
import * as fs from 'fs';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { assertKeyword, extractUserPrompt, generateBranchName } from './utils.js';
import { getIssueData, getPRData, createComment, createPR } from './gh.js';
import {
  configureGit,
  branchIsDirty,
  fetchBranch,
  checkoutBranch,
  stageAll,
  commitChanges,
  pushBranch,
} from './git.js';
import { buildIssuePrompt, buildPRPrompt } from './prompts.js';
import { runPi, summarize } from './pi.js';
import type { PRNode } from './types.js';

interface IssueCommentPayload {
  id: number;
  body?: string;
}

interface IssueWithPR {
  number: number;
  pull_request?: unknown;
}

interface GitHubPayload {
  issue?: IssueWithPR;
  comment?: IssueCommentPayload;
}

// ── Configuration ─────────────────────────────────────────────
const GIT_DIR = process.cwd();
const GITHUB_TOKEN = core.getInput('github_token');
const ACTOR = github.context.actor;

// ── Helper Functions ───────────────────────────────────────────

function setupEnvironment(): void {
  process.env.GH_TOKEN = GITHUB_TOKEN;
}

function extractContext(payload: GitHubPayload) {
  const issueNumber = payload.issue!.number;
  const commentBody = payload.comment?.body ?? '';
  const commentId = payload.comment?.id ?? 0;

  assertKeyword(commentBody);
  const userPrompt = extractUserPrompt(commentBody) ?? '';

  const runUrl = `${github.context.serverUrl}/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? 'unknown'}`;

  return { issueNumber, userPrompt, runUrl, commentId };
}

async function checkoutPRBranch(pr: PRNode, issueNumber: number) {
  const isLocalPR = pr.headRepository.nameWithOwner === pr.baseRepository.nameWithOwner;
  core.info(`Processing PR #${issueNumber} (local: ${isLocalPR})`);

  const depth = Math.max(pr.commits.totalCount, 20);

  if (isLocalPR) {
    const originUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}.git`;
    await fetchBranch(originUrl, 'origin', pr.headRefName, depth);
    await checkoutBranch(pr.headRefName);
    return { remote: 'origin' as const, branchName: pr.headRefName };
  } else {
    const localBranch = generateBranchName('pr', issueNumber);
    const forkUrl = `https://github.com/${pr.headRepository.nameWithOwner}.git`;
    await fetchBranch(forkUrl, 'fork', pr.headRefName, depth);
    await checkoutBranch(localBranch, true);
    return { remote: 'fork' as const, branchName: pr.headRefName };
  }
}

async function commitAndPush(
  response: string,
  issueNumber: number,
  remote: string,
  branchName: string
): Promise<void> {
  const summary = summarize(response, issueNumber);
  await stageAll();
  await commitChanges(summary, {
    name: ACTOR,
    email: `${ACTOR}@users.noreply.github.com`,
  });
  await pushBranch(remote, branchName);
}

/**
 * Handles the workflow for PR-related comments.
 * @param issueNumber - The PR number
 * @param userPrompt - The user's prompt
 * @param runUrl - The URL to view the GitHub Actions run
 * @param commentId - The comment ID to filter out from context
 */
async function handlePRWorkflow(
  issueNumber: number,
  userPrompt: string,
  runUrl: string,
  commentId: number
): Promise<void> {
  const pr = getPRData(issueNumber);
  const { remote, branchName } = await checkoutPRBranch(pr, issueNumber);

  const fullPrompt = buildPRPrompt(pr, userPrompt, commentId);
  const response = runPi(fullPrompt);

  if (await branchIsDirty()) {
    await commitAndPush(response, issueNumber, remote, branchName);
  }

  const finalBody = `${response}\n\n[View run](${runUrl})`;
  await createComment(issueNumber, finalBody);
}

/**
 * Handles the workflow for issue-related comments.
 * Creates a new branch, runs pi, and optionally creates a PR.
 * @param issueNumber - The issue number
 * @param userPrompt - The user's prompt
 * @param runUrl - The URL to view the GitHub Actions run
 * @param commentId - The comment ID to filter out from context
 */
async function handleIssueWorkflow(
  issueNumber: number,
  userPrompt: string,
  runUrl: string,
  commentId: number
): Promise<void> {
  const defaultBranch = (await git.currentBranch({ fs, dir: GIT_DIR })) ?? 'main';
  const branch = generateBranchName('issue', issueNumber);
  await checkoutBranch(branch, true);

  const issue = getIssueData(issueNumber);
  const fullPrompt = buildIssuePrompt(issue, userPrompt, commentId);
  const response = runPi(fullPrompt);

  if (await branchIsDirty()) {
    const summary = summarize(response, issueNumber);
    await stageAll();
    await commitChanges(summary, {
      name: ACTOR,
      email: `${ACTOR}@users.noreply.github.com`,
    });
    await pushBranch('origin', branch);

    const prBody = `${response}\n\nCloses #${issueNumber}\n\n[View run](${runUrl})`;
    const prNumber = await createPR(defaultBranch, branch, summary, prBody);

    await createComment(issueNumber, `Created PR #${prNumber}\n\n[View run](${runUrl})`);
  } else {
    await createComment(issueNumber, `${response}\n\n[View run](${runUrl})`);
  }
}

async function handleError(err: unknown): Promise<void> {
  core.error(err instanceof Error ? err.message : String(err));
  const msg = err instanceof Error ? err.message : String(err);
  const serverUrl = github.context.serverUrl || 'https://github.com';
  const owner = github.context.repo.owner || 'unknown';
  const repo = github.context.repo.repo || 'unknown';
  const runId = process.env.GITHUB_RUN_ID ?? 'unknown';
  const runUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
  const issueNumber = github.context.payload.issue!.number;

  await createComment(
    issueNumber,
    `❌ pi agent error:\n\n\`\`\`\n${msg}\n\`\`\`\n\n[View run](${runUrl})`
  );
  core.setFailed(msg);
}

// ── Main Workflow ───────────────────────────────────────────
/**
 * Main entry point for the action.
 * Handles both issue and PR workflows.
 */
async function run(): Promise<void> {
  setupEnvironment();

  try {
    const payload = github.context.payload;
    const { issueNumber, userPrompt, runUrl, commentId } = extractContext(payload);

    // Post initial "working" comment
    await createComment(issueNumber, `[pi agent working...](${runUrl})`);

    // Configure git
    await configureGit(GITHUB_TOKEN);

    const isPR = Boolean(payload.issue?.pull_request);

    if (isPR) {
      await handlePRWorkflow(issueNumber, userPrompt, runUrl, commentId);
    } else {
      await handleIssueWorkflow(issueNumber, userPrompt, runUrl, commentId);
    }
  } catch (err) {
    await handleError(err);
  }
}

// Only run if this is the main module (not during imports)
if (require.main === module) {
  run().catch(err => {
    core.setFailed(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { run };

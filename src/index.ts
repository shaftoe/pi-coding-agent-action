import * as core from '@actions/core';
import * as github from '@actions/github';
import { assertKeyword, extractUserPrompt, generateBranchName } from './utils.js';
import { gh } from './gh.js';
import { GitService } from './git.js';
import { buildIssuePrompt, buildPRPrompt } from './prompts.js';
import { runPi, summarize } from './pi.js';

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
  comment?: IssueCommentPayload | undefined;
}

// ── Configuration ─────────────────────────────────────────────
const GITHUB_TOKEN = core.getInput('github_token');
const ACTOR = github.context.actor;

/**
 * Builds the GitHub Actions run URL for logging.
 * @returns The URL to view the current workflow run
 */
function buildRunUrl(): string {
  const serverUrl = github.context.serverUrl || 'https://github.com';
  const owner = github.context.repo.owner || 'unknown';
  const repo = github.context.repo.repo || 'unknown';
  const runId = process.env.GITHUB_RUN_ID ?? 'unknown';
  return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
}

function extractContext(payload: GitHubPayload) {
  if (!payload.issue) {
    throw new Error('GitHub payload is missing issue data');
  }

  const issueNumber = payload.issue.number;
  const commentBody = payload.comment?.body ?? '';
  const commentId = payload.comment?.id ?? 0;

  assertKeyword(commentBody);
  const userPrompt = extractUserPrompt(commentBody) ?? '';
  const runUrl = buildRunUrl();

  return { issueNumber, userPrompt, runUrl, commentId };
}

/**
 * Handles the workflow for PR-related comments.
 * Assumes the PR branch is already checked out by the workflow.
 * @param gitService - The GitService instance
 * @param issueNumber - The PR number
 * @param userPrompt - The user's prompt
 * @param runUrl - The URL to view the GitHub Actions run
 * @param commentId - The comment ID to filter out from context
 */
async function handlePRWorkflow(
  gitService: GitService,
  issueNumber: number,
  userPrompt: string,
  runUrl: string,
  commentId: number
): Promise<void> {
  const pr = gh.getPRData(issueNumber);

  // Configure git credentials before running pi so it can detect push permissions
  await gitService.configureCredentials();

  const fullPrompt = buildPRPrompt(pr, userPrompt, commentId);
  const response = runPi(fullPrompt);

  if (await gitService.branchIsDirty()) {
    const summary = summarize(response, issueNumber);
    await gitService.commitAndPush(
      summary,
      {
        name: ACTOR,
        email: `${ACTOR}@users.noreply.github.com`,
      },
      pr.headRefName
    );
  }

  const finalBody = `${response}\n\n[View run](${runUrl})`;
  await gh.createComment(issueNumber, finalBody);
}

/**
 * Handles the workflow for issue-related comments.
 * Creates a new branch, runs pi, and optionally creates a PR.
 * Assumes the default branch is already checked out.
 * @param gitService - The GitService instance
 * @param issueNumber - The issue number
 * @param userPrompt - The user's prompt
 * @param runUrl - The URL to view the GitHub Actions run
 * @param commentId - The comment ID to filter out from context
 */
async function handleIssueWorkflow(
  gitService: GitService,
  issueNumber: number,
  userPrompt: string,
  runUrl: string,
  commentId: number
): Promise<void> {
  const defaultBranch = github.context.payload.repository?.default_branch ?? 'main';
  const branch = generateBranchName('issue', issueNumber);
  await gitService.checkoutBranch(branch);

  // Configure git credentials before running pi so it can detect push permissions
  await gitService.configureCredentials();

  const issue = gh.getIssueData(issueNumber);
  const fullPrompt = buildIssuePrompt(issue, userPrompt, commentId);
  const response = runPi(fullPrompt);

  if (await gitService.branchIsDirty()) {
    const summary = summarize(response, issueNumber);
    await gitService.commitAndPush(
      summary,
      {
        name: ACTOR,
        email: `${ACTOR}@users.noreply.github.com`,
      },
      branch
    );

    const prBody = `${response}\n\nCloses #${issueNumber}\n\n[View run](${runUrl})`;
    const prNumber = await gh.createPR(defaultBranch, branch, summary, prBody);

    await gh.createComment(issueNumber, `Created PR #${prNumber}\n\n[View run](${runUrl})`);
  } else {
    await gh.createComment(issueNumber, `${response}\n\n[View run](${runUrl})`);
  }
}

async function handleError(err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  core.error(msg);
  const runUrl = buildRunUrl();
  const issueNumber = github.context.payload.issue?.number;

  if (issueNumber !== undefined) {
    await gh.createComment(
      issueNumber,
      `❌ pi agent error:\n\n\`\`\`\n${msg}\n\`\`\`\n\n[View run](${runUrl})`
    );
  } else {
    core.error(`[View run](${runUrl})`);
  }
  core.setFailed(msg);
}

// ── Main Workflow ───────────────────────────────────────────
/**
 * Main entry point for the action.
 * Handles both issue and PR workflows.
 */
async function run(): Promise<void> {
  const payload = github.context.payload;
  const { issueNumber, userPrompt, runUrl, commentId } = extractContext(payload);

  let reactionId: number | undefined;

  try {
    // Add "eyes" reaction to indicate work has started
    reactionId = await gh.addReaction(commentId, 'eyes');

    const gitService = new GitService(GITHUB_TOKEN);

    const isPR = Boolean(payload.issue?.pull_request);

    if (isPR) {
      await handlePRWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
    } else {
      await handleIssueWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
    }
  } finally {
    // Remove the "eyes" reaction before exit, even on error
    if (reactionId !== undefined) {
      await gh.removeReaction(commentId, reactionId).catch(err => {
        // Silently ignore errors when removing the reaction
        core.debug(
          `Failed to remove reaction: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }
  }
}

// Only run if this file is being executed directly (not imported)
if (require.main === module) {
  run().catch(handleError);
}

export { run };

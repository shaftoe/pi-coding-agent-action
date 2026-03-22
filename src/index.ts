import * as core from '@actions/core';
import * as github from '@actions/github';
import { assertKeyword, extractUserPrompt, generateBranchName } from './utils.js';
import { getIssueData, getPRData, createComment, createPR, addReaction } from './gh.js';
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
  comment?: IssueCommentPayload;
}

// ── Configuration ─────────────────────────────────────────────
const GITHUB_TOKEN = core.getInput('github_token');
const ACTOR = github.context.actor;

function setupGitService(): GitService {
  const gitService = new GitService(GITHUB_TOKEN);
  return gitService;
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

/**
 * Handles the workflow for PR-related comments.
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
  const pr = getPRData(issueNumber);
  const { remote, branchName } = await gitService.checkoutPRBranch(pr, issueNumber);

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
      remote,
      branchName
    );
  }

  const finalBody = `${response}\n\n[View run](${runUrl})`;
  await createComment(issueNumber, finalBody);
}

/**
 * Handles the workflow for issue-related comments.
 * Creates a new branch, runs pi, and optionally creates a PR.
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
  const defaultBranch = (await gitService.getCurrentBranch()) ?? 'main';
  const branch = generateBranchName('issue', issueNumber);
  await gitService.checkoutBranch(branch, true);

  const issue = getIssueData(issueNumber);
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
      'origin',
      branch
    );

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
  try {
    const payload = github.context.payload;
    const { issueNumber, userPrompt, runUrl, commentId } = extractContext(payload);

    // Add "eyes" reaction to indicate work has started
    await addReaction(commentId, 'eyes');

    const gitService = setupGitService();

    const isPR = Boolean(payload.issue?.pull_request);

    if (isPR) {
      await handlePRWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
    } else {
      await handleIssueWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
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

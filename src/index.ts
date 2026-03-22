import git from 'isomorphic-git';
import fs from 'fs';
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

// ── Configuration ─────────────────────────────────────────────
const GIT_DIR = process.cwd();
const GITHUB_TOKEN = core.getInput('github_token');
const ACTOR = github.context.actor;

// ── Main Workflow ───────────────────────────────────────────
async function run(): Promise<void> {
  let workingComment = '';

  // Set GH_TOKEN for gh CLI
  process.env.GH_TOKEN = GITHUB_TOKEN;

  try {
    const payload = github.context.payload;
    const issueNumber = payload.issue!.number;
    const commentBody = payload.comment?.body ?? '';

    assertKeyword(commentBody);
    const userPrompt = extractUserPrompt(commentBody);

    const runUrl = `${github.context.serverUrl}/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    workingComment = `[pi agent working...](${runUrl})`;

    // Post initial "working" comment
    await createComment(issueNumber, workingComment);

    // Configure git
    await configureGit(GITHUB_TOKEN);

    const isPR = Boolean(payload.issue?.pull_request);
    const defaultBranch = (await git.currentBranch({ fs, dir: GIT_DIR })) ?? 'main';

    if (isPR) {
      const prNumber = issueNumber;
      const pr = getPRData(prNumber);
      const isLocalPR = pr.headRepository.nameWithOwner === pr.baseRepository.nameWithOwner;

      core.info(`Processing PR #${prNumber} (local: ${isLocalPR})`);

      // Checkout PR branch using isomorphic-git
      if (isLocalPR) {
        const depth = Math.max(pr.commits.totalCount, 20);
        const originUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}.git`;
        await fetchBranch(originUrl, 'origin', pr.headRefName, depth);
        await checkoutBranch(pr.headRefName);
      } else {
        const depth = Math.max(pr.commits.totalCount, 20);
        const localBranch = generateBranchName('pr', issueNumber);
        const forkUrl = `https://github.com/${pr.headRepository.nameWithOwner}.git`;
        await fetchBranch(forkUrl, 'fork', pr.headRefName, depth);
        await checkoutBranch(localBranch, true);
      }

      const fullPrompt = buildPRPrompt(pr, userPrompt, payload.comment?.id ?? 0);
      const response = runPi(fullPrompt);

      if (await branchIsDirty()) {
        const summary = summarize(response, issueNumber);
        await stageAll();
        await commitChanges(summary, {
          name: ACTOR,
          email: `${ACTOR}@users.noreply.github.com`,
        });

        if (isLocalPR) {
          await pushBranch('origin', pr.headRefName);
        } else {
          await pushBranch('fork', pr.headRefName);
        }
      }

      // Update comment with final response
      const finalBody = `${response}\n\n[View run](${runUrl})`;
      // We need to find and update the working comment - for now, create a new one
      await createComment(issueNumber, finalBody);
    } else {
      // Issue flow — create new branch, run agent, open PR
      const branch = generateBranchName('issue', issueNumber);
      await checkoutBranch(branch, true);

      const issue = getIssueData(issueNumber);
      const fullPrompt = buildIssuePrompt(issue, userPrompt, payload.comment?.id ?? 0);
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
  } catch (err) {
    core.error(err instanceof Error ? err.message : String(err));
    const msg = err instanceof Error ? err.message : String(err);
    const runUrl = `${github.context.serverUrl}/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    const issueNumber = github.context.payload.issue!.number;

    await createComment(
      issueNumber,
      `❌ pi agent error:\n\n\`\`\`\n${msg}\n\`\`\`\n\n[View run](${runUrl})`
    );
    core.setFailed(msg);
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

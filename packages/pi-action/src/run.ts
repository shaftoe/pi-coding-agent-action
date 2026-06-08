/**
 * @file GitHub Action entry point.
 *
 * Orchestrates the action by creating adapters, gathering configuration,
 * and passing them to the ActionOrchestrator which handles the complete
 * execution flow.
 */

import * as path from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { ActionOrchestrator } from '@alexanderfortin/pi-orchestrator';
import { RealCoreAdapter } from './adapters/core-adapter';
import { RealGitAdapter } from './adapters/git-adapter';
import { createRealPiAgent } from './adapters/pi-agent-adapter';
import { gatherActionsConfig } from './adapters/config';
import { ActionsOutputSink } from './adapters/output-sink';
import { createGitHubPlatformProvider, detectPlatform } from '@alexanderfortin/pi-platform-github';

/**
 * Configure the Pi SDK's package directory for the bundled action.
 *
 * When the action runs from its bundled `dist/index.js`, the SDK's
 * `getPackageDir()` walks up from `__dirname` and finds the action's
 * `package.json` instead of the SDK's. The build script copies the SDK's
 * export-html assets into `dist/pi-sdk/`. Setting `PI_PACKAGE_DIR` tells
 * the SDK where to find those assets — it's the SDK's documented escape
 * hatch for bundled deployments.
 *
 * This is always needed here because `run.ts` is only executed as the
 * bundled action entry point. Library/CLI/other consumers never go
 * through this path.
 */
function ensurePackageDirOverride(): void {
  process.env.PI_PACKAGE_DIR = path.join(__dirname, 'pi-sdk');
}

/**
 * Run the Pi coding agent end-to-end.
 *
 * Creates real adapters for Core, Git platform, and Pi agent, gathers
 * configuration from GitHub Action inputs, and passes them to the
 * orchestrator which handles the execution flow.
 *
 * @throws Rethrows any error from the orchestrator.
 */
// fallow-ignore-next-line complexity
export async function run() {
  // Set PI_PACKAGE_DIR once at startup so the SDK's getPackageDir()
  // resolves to the bundled assets in dist/pi-sdk/.
  ensurePackageDirOverride();

  const coreAdapter = new RealCoreAdapter();
  const config = gatherActionsConfig();
  const outputSink = new ActionsOutputSink();

  // Create Octokit from the github_token input
  const octokit = github.getOctokit(coreAdapter.getInput('github_token'));

  // Build PlatformContext from the @actions/github singleton
  const githubCtx = github.context as { actor?: string; sha?: string };

  // When pr_number is provided (e.g. workflow_dispatch), override the
  // issue number so all downstream tools target the specified PR.
  const prNumber = config.prNumber;
  const issueNumber = prNumber ?? github.context.issue.number;

  // Build the payload, injecting a pull_request stub when pr_number is set
  // so that isPR() and getContextType() work without event-specific context.
  const payload = { ...(github.context.payload as Record<string, unknown>) };
  if (prNumber) {
    payload.pull_request = payload.pull_request ?? { number: prNumber };
  }

  const platformContext = {
    repo: github.context.repo,
    issue: { number: issueNumber },
    eventName: github.context.eventName,
    payload,
    serverUrl: github.context.serverUrl || 'https://github.com',
    runId: github.context.runId,
    workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
    ...(githubCtx.actor !== undefined ? { actor: githubCtx.actor } : {}),
    ...(githubCtx.sha !== undefined ? { sha: githubCtx.sha } : {}),
  };

  // Create the platform provider with explicit deps (no singletons)
  const triggerValue = coreAdapter.getInput('trigger');
  const branchNameTemplate = coreAdapter.getInput('branch_name_template');
  const platformProvider = createGitHubPlatformProvider({
    octokit,
    context: platformContext,
    logger: coreAdapter,
    platformType: detectPlatform(platformContext.serverUrl),
    ...(triggerValue ? { trigger: triggerValue } : {}),
    ...(branchNameTemplate ? { branchNameTemplate } : {}),
  });

  // Create the git adapter with explicit deps
  const gitAdapter = new RealGitAdapter(coreAdapter, octokit, platformContext);

  const orchestrator = new ActionOrchestrator(
    config,
    coreAdapter, // CoreAdapter extends Logger
    outputSink,
    gitAdapter,
    createRealPiAgent,
    platformProvider
  );

  await orchestrator.execute();
}

run().catch(error => {
  // Safety net – the orchestrator should have already called core.setFailed,
  // but ensure the action is always marked as failed on any unhandled error.
  console.error('Unhandled error in run():', error);
  core.setFailed(`Unhandled error: ${error instanceof Error ? error.message : String(error)}`);
});

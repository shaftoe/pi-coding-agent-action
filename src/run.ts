/**
 * @file GitHub Action entry point.
 *
 * Orchestrates the action by creating adapters, gathering configuration,
 * and passing them to the ActionOrchestrator which handles the complete
 * execution flow.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { ActionOrchestrator } from './orchestrator';
import { RealCoreAdapter } from './adapters/core-adapter';
import { RealGitAdapter } from './adapters/git-adapter';
import { createRealPiAgent } from './adapters/pi-agent-adapter';
import { gatherActionsConfig } from './adapters/config';
import { ActionsOutputSink } from './adapters/output-sink';
import { createGitHubPlatformProvider } from './platform';

/**
 * Run the Pi coding agent end-to-end.
 *
 * Creates real adapters for Core, Git platform, and Pi agent, gathers
 * configuration from GitHub Action inputs, and passes them to the
 * orchestrator which handles the execution flow.
 *
 * @throws Rethrows any error from the orchestrator.
 */
export async function run() {
  const coreAdapter = new RealCoreAdapter();
  const config = gatherActionsConfig();
  const outputSink = new ActionsOutputSink();

  // Create Octokit from the github_token input
  const octokit = github.getOctokit(coreAdapter.getInput('github_token'));

  // Build PlatformContext from the @actions/github singleton
  const githubCtx = github.context as { actor?: string; sha?: string };
  const platformContext = {
    repo: github.context.repo,
    issue: github.context.issue,
    eventName: github.context.eventName,
    payload: github.context.payload as Record<string, unknown>,
    serverUrl: github.context.serverUrl || 'https://github.com',
    runId: github.context.runId,
    workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
    ...(githubCtx.actor !== undefined ? { actor: githubCtx.actor } : {}),
    ...(githubCtx.sha !== undefined ? { sha: githubCtx.sha } : {}),
  };

  // Create the platform provider with explicit deps (no singletons)
  const platformProvider = createGitHubPlatformProvider({
    octokit,
    context: platformContext,
    logger: coreAdapter,
  });

  // Create the git adapter with explicit deps
  const gitAdapter = new RealGitAdapter(coreAdapter, octokit, platformContext);

  const orchestrator = new ActionOrchestrator(
    config,
    coreAdapter,       // CoreAdapter extends Logger
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

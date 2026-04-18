/**
 * @file GitHub Action entry point.
 *
 * Orchestrates the action by creating adapters and passing them to the
 * ActionOrchestrator, which handles the complete execution flow.
 */

import { ActionOrchestrator } from './orchestrator';
import { RealCoreAdapter } from './adapters/core-adapter';
import { RealGitAdapter } from './adapters/git-adapter';
import { createRealPiAgent } from './adapters/pi-agent-adapter';

/**
 * Run the Pi coding agent end-to-end.
 *
 * Creates real adapters for Core, Git platform, and Pi agent, then passes them
 * to the orchestrator which handles the execution flow.
 *
 * @throws Rethrows any error from the orchestrator.
 */
export async function run() {
  const coreAdapter = new RealCoreAdapter();
  const gitAdapter = new RealGitAdapter(coreAdapter);
  const orchestrator = new ActionOrchestrator(coreAdapter, gitAdapter, createRealPiAgent);

  await orchestrator.execute();
}

run().catch(error => {
  // This catch block is a safety net; the orchestrator already calls core.setFailed
  console.error('Unhandled error in run():', error);
});

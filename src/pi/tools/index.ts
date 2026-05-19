/**
 * @file Pi extension factory – registers custom tools with the agent.
 *
 * Defines tools that extend Pi's built-in capabilities:
 *
 * - **`create_pull_request`** – creates a GitHub pull request with the current
 *   working-tree changes.
 * - **`update_pull_request`** – updates an existing pull request by pushing
 *   new commits to the PR branch and optionally updating the title and/or body.
 * - **`get_issue_or_pr_thread`** – fetches the full comment thread of an issue
 *   or pull request for context.
 * - **`get_pr_diff`** – fetches the diff of a pull request.
 * - **`create_pull_request_review`** – creates a pull request review with
 *   inline comments anchored to specific diff lines.
 *
 * The exported {@link toolsFactory} function is passed to the Pi SDK resource
 * loader so that the tools are available during agent sessions.
 */

import { createPRToolFactory } from './create-pr';
import { getIssueOrPRThreadToolFactory } from './get-thread';
import { getPRDiffToolFactory } from './get-pr-diff';
import { updatePullRequestToolFactory } from './update-pr';
import { createReviewToolFactory } from './create-review';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { PlatformProvider } from '../../platform';
import type { DiffConfig } from '../../types';

// Re-export tool execution utilities for use in custom tools
export {
  withCancellation,
  createCancellationResult,
  buildParams,
  type ToolExecutionConfig,
  type CancellationResult,
} from './tool-execution';

/**
 * Extension factory that registers all custom tools with the Pi agent.
 *
 * Called by the Pi SDK resource loader during session initialisation. Registers
 * the `create_pull_request`, `update_pull_request`, `get_issue_or_pr_thread`,
 * `get_pr_diff`, and `create_pull_request_review` tools.
 *
 * @param provider - The platform provider for tool operations.
 * @returns An extension factory function compatible with the Pi SDK.
 */
export function createToolsFactory(provider: PlatformProvider, config?: DiffConfig): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const tools = [
      createPRToolFactory(provider),
      updatePullRequestToolFactory(provider),
      getIssueOrPRThreadToolFactory(provider),
      getPRDiffToolFactory(provider, config),
      createReviewToolFactory(provider),
    ];
    tools.forEach(tool => {
      pi.registerTool(tool);
    });
  };
}

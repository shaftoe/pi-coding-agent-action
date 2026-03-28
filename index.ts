/**
 * @file Pi extension factory – registers custom tools with the agent.
 *
 * Defines three tools that extend Pi's built-in capabilities:
 *
 * - **`create_pull_request`** – creates a GitHub pull request with the current
 *   working-tree changes.
 * - **`update_pull_request`** – updates an existing pull request by pushing
 *   new commits to the PR branch and optionally updating the title and/or body.
 * - **`get_issue_or_pr_thread`** – fetches the full comment thread of an issue
 *   or pull request for context.
 *
 * The exported {@link extensionsFactory} function is passed to the Pi SDK resource
 * loader so that the tools are available during agent sessions.
 */

import { createPRTool } from './create-pr';
import { getIssueOrPRThreadTool } from './get-thread';
import { updatePullRequestTool } from './update-pr';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

/**
 * Extension factory that registers all custom tools with the Pi agent.
 *
 * Called by the Pi SDK resource loader during session initialisation. Registers
 * the `create_pull_request`, `update_pull_request`, and `get_issue_or_pr_thread` tools.
 *
 * @param pi - The Pi extension API used to register tools.
 */
export const extensionsFactory = (pi: ExtensionAPI): void => {
  const tools = [createPRTool, updatePullRequestTool, getIssueOrPRThreadTool];
  tools.forEach(tool => {
    pi.registerTool(tool);
  });
};

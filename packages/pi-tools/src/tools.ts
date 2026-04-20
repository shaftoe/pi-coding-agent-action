/**
 * @file Tool factory aggregator – registers all built-in tools with the Pi agent.
 *
 * The exported {@link createToolsFactory} function is passed to the Pi SDK
 * resource loader so that the tools are available during agent sessions.
 */

import { createPRToolFactory } from './create-pr';
import { getIssueOrPRThreadToolFactory } from './get-thread';
import { updatePullRequestToolFactory } from './update-pr';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { ToolProvider } from './types';

/**
 * Extension factory that registers all built-in tools with the Pi agent.
 *
 * Called by the Pi SDK resource loader during session initialisation. Registers
 * the `create_pull_request`, `update_pull_request`, and `get_issue_or_pr_thread` tools.
 *
 * @param provider - The tool provider for backend operations.
 * @returns An extension factory function compatible with the Pi SDK.
 */
export function createToolsFactory(provider: ToolProvider): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const tools = [
      createPRToolFactory(provider),
      updatePullRequestToolFactory(provider),
      getIssueOrPRThreadToolFactory(provider),
    ];
    tools.forEach(tool => {
      pi.registerTool(tool);
    });
  };
}

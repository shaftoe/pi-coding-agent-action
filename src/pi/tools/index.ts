/**
 * @file Pi extension factory – registers custom tools with the agent.
 *
 * Re-exports the tool factory from `pi-coding-agent-tools` and adapts the
 * action's {@link PlatformProvider} to the package's minimal
 * {@link ToolProvider} interface.
 *
 * The exported {@link createToolsFactory} function is passed to the Pi SDK
 * resource loader so that the tools are available during agent sessions.
 */

import {
  createToolsFactory as createToolsFactoryCore,
  type ToolProvider,
} from 'pi-coding-agent-tools';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { PlatformProvider } from '../../platform';

// Re-export tool execution utilities for use in custom tools
export {
  withCancellation,
  createCancellationResult,
  buildParams,
  type ToolExecutionConfig,
  type CancellationResult,
} from 'pi-coding-agent-tools';

/**
 * Adapt the action's {@link PlatformProvider} to the package's
 * {@link ToolProvider} interface.
 *
 * The `PlatformProvider` is a superset – it includes reactions, comments,
 * prompt extraction, etc. – but the tool definitions only need the three
 * methods defined in `ToolProvider`. This adapter narrows the interface.
 */
function adaptProvider(provider: PlatformProvider): ToolProvider {
  return {
    createPullRequest: params => provider.createPullRequest(params),
    updatePullRequest: params => provider.updatePullRequest(params),
    getIssueOrPRThread: params => provider.getIssueOrPRThread(params),
  };
}

/**
 * Extension factory that registers all custom tools with the Pi agent.
 *
 * Called by the Pi SDK resource loader during session initialisation. Registers
 * the `create_pull_request`, `update_pull_request`, and `get_issue_or_pr_thread` tools.
 *
 * @param provider - The platform provider for tool operations.
 * @returns An extension factory function compatible with the Pi SDK.
 */
export function createToolsFactory(provider: PlatformProvider): (pi: ExtensionAPI) => void {
  return createToolsFactoryCore(adaptProvider(provider));
}

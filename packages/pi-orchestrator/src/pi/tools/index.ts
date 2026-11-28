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
 * - **`get_ci_status`** – checks the CI/CD status of check runs and workflow
 *   runs for a pull request or commit ref.
 * - **`get_workflow_run_logs`** – fetches job logs for a specific workflow run
 *   to diagnose CI failures.
 * - **`parse_actions_url`** – extracts repository, run, and optional job IDs
 *   from a GitHub Actions URL without making network requests.
 * - **`summarize_text`** – summarizes very long text with a separate one-shot
 *   LLM call (via `ctx.modelRegistry`), keeping the raw text out of the
 *   agent's own context.
 *
 * The exported {@link toolsFactory} function is passed to the Pi SDK resource
 * loader so that the tools are available during agent sessions.
 */

import { createPRToolFactory } from './create-pr';
import { getIssueOrPRThreadToolFactory } from './get-thread';
import { getPRDiffToolFactory } from './get-pr-diff';
import { updatePullRequestToolFactory } from './update-pr';
import { createReviewToolFactory } from './create-review';
import { getCIStatusToolFactory } from './get-ci-status';
import { getWorkflowRunLogsToolFactory } from './get-workflow-run-logs';
import { parseActionsUrlToolFactory } from './parse-actions-url';
import { createSummarizeToolFactory } from './summarize';
import { diagnoseCIFailureToolFactory } from './diagnose-ci-failure';
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
 * `get_pr_diff`, `create_pull_request_review`, `get_ci_status`,
 * `get_workflow_run_logs`, `parse_actions_url`, `summarize_text`, and
 * `diagnose_ci_failure` tools.
 *
 * @param provider - The platform provider for tool operations.
 * @returns An extension factory function compatible with the Pi SDK.
 */
export function createToolsFactory(
  provider: PlatformProvider,
  config?: DiffConfig
): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI): void => {
    const tools = [
      createPRToolFactory(provider),
      updatePullRequestToolFactory(provider),
      getIssueOrPRThreadToolFactory(provider),
      getPRDiffToolFactory(provider, config),
      createReviewToolFactory(provider),
      getCIStatusToolFactory(provider),
      getWorkflowRunLogsToolFactory(provider),
      parseActionsUrlToolFactory(provider),
      // Platform-agnostic: uses the SDK's extension model-call API
      // (ctx.modelRegistry) rather than the platform provider.
      createSummarizeToolFactory(),
      // Platform-agnostic composite: chains get_ci_status →
      // get_workflow_run_logs → summarize_text via ctx.executeTool().
      diagnoseCIFailureToolFactory(),
    ];
    tools.forEach(tool => {
      pi.registerTool(tool);
    });
  };
}

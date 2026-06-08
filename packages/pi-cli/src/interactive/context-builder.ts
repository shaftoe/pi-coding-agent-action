/**
 * @file Interactive context builder for issue/PR-aware CLI runs.
 *
 * Constructs a {@link PlatformContext} from a GitHub issue/PR number
 * by fetching metadata from the GitHub API. This allows the CLI to
 * attach an agent run to an existing issue/PR thread so the agent has
 * full context and can post its response as a comment.
 *
 * Unlike the M1 sentinel context (`eventName: 'cli'`, `issue.number: 0`),
 * the interactive context sets the real issue/PR number and appropriate
 * event name so that `isPR()`, `getContextType()`, and comment-posting
 * all work correctly.
 */

import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';
import type { PlatformContext } from '@alexanderfortin/pi-orchestrator';

/**
 * Arguments for building an interactive {@link PlatformContext}.
 */
export interface InteractiveContextArgs {
  /** Repository owner + name. */
  repo: { owner: string; repo: string };
  /** Issue or PR number to target. */
  issueOrPRNumber: number;
  /** Whether the target is a PR (vs a plain issue). */
  isPR: boolean;
  /** Working directory for the agent. */
  workspace: string;
  /** Server URL (e.g. `https://github.com`). */
  serverUrl: string;
  /** Git user name (for Co-authored-by trailers). Optional. */
  actor?: string | undefined;
  /** Current HEAD commit SHA. Optional. */
  sha?: string | undefined;
}

/**
 * Build a {@link PlatformContext} that targets a specific issue or PR.
 *
 * The context mirrors what the GitHub Action would produce for the same
 * event, but is constructed from explicit parameters rather than
 * `@actions/github` environment variables.
 *
 * For PRs, sets `eventName: 'pull_request'` and includes a
 * `pull_request` stub in the payload so `isPR()` and `getContextType()`
 * return the correct values. For issues, sets `eventName: 'issues'`
 * with an `issue` stub.
 *
 * @param args - Interactive context arguments.
 * @returns A fully-formed PlatformContext for the target issue/PR.
 */
export function buildInteractiveContext(args: InteractiveContextArgs): PlatformContext {
  const eventName = args.isPR ? 'pull_request' : 'issues';
  const payload: Record<string, unknown> = args.isPR
    ? { pull_request: { number: args.issueOrPRNumber } }
    : { issue: { number: args.issueOrPRNumber } };

  return {
    repo: args.repo,
    issue: { number: args.issueOrPRNumber },
    eventName,
    payload,
    serverUrl: args.serverUrl,
    // runId omitted: CLI has no Actions runId. buildActionRunUrl() returns
    // undefined, suppressing the "View action run" footer.
    workspace: args.workspace,
    ...(args.actor !== undefined ? { actor: args.actor } : {}),
    ...(args.sha !== undefined ? { sha: args.sha } : {}),
  };
}

/**
 * Detect whether a GitHub issue number refers to a PR by querying the API.
 *
 * Uses `issues.get()` and checks for `pull_request` in the response.
 * Returns `false` for issues and `true` for PRs.
 *
 * @param octokit - Authenticated Octokit instance.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param number - Issue or PR number.
 * @returns `true` if the number refers to a pull request.
 */
export async function detectIsPR(
  octokit: OctokitInstance,
  owner: string,
  repo: string,
  number: number
): Promise<boolean> {
  const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: number });
  // GitHub returns `pull_request` in the response for PRs
  return !!data.pull_request;
}

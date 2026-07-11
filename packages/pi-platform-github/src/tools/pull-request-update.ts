/**
 * @file GitHub pull request update tool implementation.
 *
 * Implements the server-side logic for the `update_pull_request` custom tool:
 * detecting changed files in the working tree, creating a commit via the
 * `git` CLI, and pushing the new commit to an existing PR branch.
 * Supports updating the PR title and body as well. Supports dry-run mode for
 * testing without side effects.
 */

import type { GitHubModuleDeps, UpdatePullRequestParams, UpdatePullRequestDetails } from '../types';
import type { Logger } from '@alexanderfortin/pi-orchestrator';
import { MAX_TITLE_LENGTH } from '../constants';
import {
  createLogger,
  getWorkspaceChangePaths,
  commitAndPushBranch,
  appendCoAuthoredBy,
} from '../git/index';

export interface UpdatePullRequestResult {
  content: { type: 'text'; text: string }[];
  details: UpdatePullRequestDetails;
}

/**
 * Update an existing pull request's title and/or body via the GitHub REST API.
 *
 * @param deps - Module dependencies.
 * @param pullNumber - PR number.
 * @param updates - Object with optional title and/or body.
 * @returns An object containing the updated PR URL.
 */
async function updatePullRequestMetadata(
  deps: GitHubModuleDeps,
  pullNumber: number,
  updates: { title?: string; body?: string }
): Promise<{ titleUpdated: boolean; bodyUpdated: boolean }> {
  const owner = deps.context.repo.owner;
  const repo = deps.context.repo.repo;
  const log = createLogger(deps);

  const updateParams: {
    title?: string;
    body?: string;
  } = {};

  if (updates.title !== undefined) {
    updateParams.title = updates.title;
  }
  if (updates.body !== undefined) {
    updateParams.body = updates.body;
  }

  if (Object.keys(updateParams).length === 0) {
    return { titleUpdated: false, bodyUpdated: false };
  }

  log.debug(`Updating PR #${pullNumber} metadata...`);

  await deps.octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: pullNumber,
    ...updateParams,
  });

  return {
    titleUpdated: updates.title !== undefined,
    bodyUpdated: updates.body !== undefined,
  };
}

/**
 * Validate pull request update parameters.
 *
 * @param params - The pull request update parameters to validate.
 * @throws {Error} If validation fails.
 * @internal Exported for testing purposes.
 */
// fallow-ignore-next-line complexity
export function validateUpdatePullRequestParams(params: UpdatePullRequestParams): void {
  if (params.title !== undefined && params.title.length > MAX_TITLE_LENGTH) {
    throw new Error(
      `Pull request title exceeds maximum length of ${MAX_TITLE_LENGTH} characters (got ${params.title.length})`
    );
  }

  // Ensure at least one update parameter is provided (besides dryRun)
  const { title, body, message, pull_number } = params;
  const hasContentUpdate = title !== undefined || body !== undefined || message !== undefined;
  const hasPRContext = pull_number !== undefined;

  if (!hasContentUpdate && !hasPRContext) {
    throw new Error(
      'At least one update parameter (title, body, message, or pull_number) must be provided'
    );
  }
}

/**
 * Resolve the pull request number from explicit param or action context.
 *
 * @param deps - Module dependencies (provides `context.issue.number`).
 * @param pullNumber - Explicit `pull_number` parameter, if provided.
 * @returns The resolved PR number.
 * @throws {Error} If no PR number can be resolved.
 * @internal Exported for testing purposes.
 */
export function resolvePullRequestNumber(
  deps: GitHubModuleDeps,
  pullNumber: number | undefined
): number {
  const resolved = pullNumber ?? deps.context.issue?.number;
  if (!resolved) {
    throw new Error(
      'Pull request number not provided and not available in context. ' +
        'Please provide pull_number parameter or run this action in the context of a pull request.'
    );
  }
  return resolved;
}

interface PullRequestBranchInfo {
  headBranch: string;
  baseBranch: string;
  headSha: string;
  prUrl: string;
}

/**
 * Fetch a pull request via the GitHub REST API and extract the fields needed
 * to update its branch (head/base ref, head SHA, HTML URL).
 *
 * @param deps - Module dependencies.
 * @param pullNumber - PR number to fetch.
 * @returns The PR's branch info and URL.
 * @throws {Error} If the API call returns a non-200 status or no data.
 * @internal Exported for testing purposes.
 */
export async function fetchPullRequestData(
  deps: GitHubModuleDeps,
  pullNumber: number
): Promise<PullRequestBranchInfo> {
  const owner = deps.context.repo.owner;
  const repo = deps.context.repo.repo;
  const log = createLogger(deps);

  log.debug(`Fetching PR #${pullNumber}...`);
  const prData = await deps.octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });

  if (prData.status !== 200 || !prData.data) {
    throw new Error(
      `Could not fetch pull request #${pullNumber}. ` +
        `Please verify the pull request number is correct and that you have access to this repository.`
    );
  }

  return {
    headBranch: prData.data.head.ref,
    baseBranch: prData.data.base.ref,
    headSha: prData.data.head.sha,
    prUrl: prData.data.html_url,
  };
}

/**
 * Build the dry-run report (no side effects).
 *
 * Produces both the human-readable text content and the structured
 * `details` payload describing what would happen if the PR update ran for
 * real. The caller is responsible for any logging.
 *
 * @param input - Resolved PR number, branch info, and the change scan results.
 * @returns The tool result to return to the caller.
 * @internal Exported for testing purposes.
 */
export function buildDryRunReport(input: {
  pullNumber: number;
  title: string | undefined;
  body: string | undefined;
  headBranch: string;
  baseBranch: string;
  prUrl: string;
  changedFiles: readonly string[];
  deletedFiles: readonly string[];
}): UpdatePullRequestResult {
  const { pullNumber, title, body, headBranch, baseBranch, prUrl, changedFiles, deletedFiles } =
    input;
  const parts: string[] = [`[DRY RUN] Would update pull request #${pullNumber}:`];
  if (title !== undefined) {
    parts.push(`- Title: ${title}`);
  }
  if (body !== undefined) {
    parts.push(`- Body: ${body}`);
  }
  parts.push(`- Head branch: ${headBranch}`);
  parts.push(`- Base branch: ${baseBranch}`);
  parts.push(...formatChangeSummary(changedFiles, deletedFiles));

  return {
    content: [{ type: 'text' as const, text: parts.join('\n') }],
    details: {
      pullRequestNumber: pullNumber,
      pullRequestUrl: prUrl,
      headBranch,
      baseBranch,
      dryRun: true,
    },
  };
}

/**
 * Build the "Code changes" section of a dry-run report.
 *
 * Returns one of:
 *   - `["- Code changes:", "  - N modified/new file(s)", "  - M deleted file(s)"]`
 *     (one or both counts depending on input)
 *   - `["- No code changes detected"]` when both lists are empty.
 *
 * Exported for unit testing.
 */
// fallow-ignore-next-line complexity
export function formatChangeSummary(
  changedFiles: readonly string[],
  deletedFiles: readonly string[]
): string[] {
  if (changedFiles.length === 0 && deletedFiles.length === 0) {
    return ['- No code changes detected'];
  }

  const lines: string[] = ['- Code changes:'];
  if (changedFiles.length > 0) {
    lines.push(`  - ${changedFiles.length} modified/new file(s)`);
  }
  if (deletedFiles.length > 0) {
    lines.push(`  - ${deletedFiles.length} deleted file(s)`);
  }
  return lines;
}

/**
 * Resolve the commit message to use for a PR update.
 *
 * Returns `message` as-is when provided and non-empty; otherwise builds a
 * descriptive default of the form
 *   `Update PR #<n>: <a> modified/new file(s), <b> deleted file(s)`
 * omitting either half when the corresponding list is empty.
 *
 * @internal Exported for testing purposes.
 */
export function generateCommitMessage(
  message: string | undefined,
  changedFiles: readonly string[],
  deletedFiles: readonly string[],
  pullNumber: number
): string {
  if (message) {
    return message;
  }
  const changes: string[] = [];
  if (changedFiles.length > 0) {
    changes.push(`${changedFiles.length} modified/new file(s)`);
  }
  if (deletedFiles.length > 0) {
    changes.push(`${deletedFiles.length} deleted file(s)`);
  }
  return `Update PR #${pullNumber}: ${changes.join(', ')}`;
}

/**
 * Build the success report (no side effects).
 *
 * Composes both the human-readable summary and the structured `details`
 * payload describing a successful (non-dry-run) PR update. The caller is
 * responsible for any logging.
 *
 * @param input - Resolved PR number, branch info, and the outcomes of the
 *                 commit / metadata-update steps.
 * @returns The tool result to return to the caller.
 * @internal Exported for testing purposes.
 */
export function buildSuccessReport(input: {
  pullNumber: number;
  prUrl: string;
  headBranch: string;
  baseBranch: string;
  commitSha: string | undefined;
  titleUpdated: boolean | undefined;
  bodyUpdated: boolean | undefined;
}): UpdatePullRequestResult {
  const { pullNumber, prUrl, commitSha, titleUpdated, bodyUpdated } = input;

  const parts: string[] = [`Pull request #${pullNumber} updated: ${prUrl}`];
  if (commitSha) {
    parts.push(`- New commit: ${commitSha}`);
  }
  if (titleUpdated) {
    parts.push(`- Title updated`);
  }
  if (bodyUpdated) {
    parts.push(`- Description updated`);
  }

  return {
    content: [{ type: 'text' as const, text: parts.join('\n') }],
    details: buildSuccessDetails(input),
  };
}

/**
 * Build the `details` payload for a successful PR update.
 *
 * Only includes optional fields (`commitSha`, `titleUpdated`, `bodyUpdated`)
 * when they are set / truthy, matching the historical contract.
 *
 * Exported for unit testing.
 */
export function buildSuccessDetails(input: {
  pullNumber: number;
  prUrl: string;
  headBranch: string;
  baseBranch: string;
  commitSha: string | undefined;
  titleUpdated: boolean | undefined;
  bodyUpdated: boolean | undefined;
}): UpdatePullRequestDetails {
  const { pullNumber, prUrl, headBranch, baseBranch, commitSha, titleUpdated, bodyUpdated } = input;
  const details: UpdatePullRequestDetails = {
    pullRequestNumber: pullNumber,
    pullRequestUrl: prUrl,
    headBranch,
    baseBranch,
    dryRun: false,
  };
  if (commitSha !== undefined) {
    details.commitSha = commitSha;
  }
  if (titleUpdated) {
    details.titleUpdated = titleUpdated;
  }
  if (bodyUpdated) {
    details.bodyUpdated = bodyUpdated;
  }
  return details;
}

/**
 * Commit working-tree changes and push to the PR branch via the `git` CLI.
 *
 * Wrapper around {@link generateCommitMessage} + {@link commitAndPushBranch}.
 * Returns `undefined` when there are no file changes to apply.
 *
 * @returns The new commit SHA, or `undefined` when no changes were applied.
 * @internal Exported for testing purposes.
 */
export async function applyCommit(
  deps: GitHubModuleDeps,
  args: {
    changedPaths: string[];
    deletedPaths: string[];
    headBranch: string;
    message: string | undefined;
    pullNumber: number;
    log: Logger;
  }
): Promise<string | undefined> {
  const { changedPaths, deletedPaths, headBranch, message, pullNumber, log } = args;

  if (changedPaths.length === 0 && deletedPaths.length === 0) {
    log.info(`No code changes detected, only updating PR metadata if provided`);
    return undefined;
  }

  const commitMessage = appendCoAuthoredBy(
    deps,
    generateCommitMessage(message, changedPaths, deletedPaths, pullNumber)
  );

  const commitSha = await commitAndPushBranch({
    cwd: deps.context.workspace,
    branchName: headBranch,
    message: commitMessage,
    isNewBranch: false,
    paths: [...changedPaths, ...deletedPaths],
    actor: deps.context.actor,
    gitIdentityOptions: {
      platformType: deps.platformType,
      serverUrl: deps.context.serverUrl,
    },
    log,
  });
  log.info(`Created new commit ${commitSha} on branch ${headBranch}`);
  return commitSha;
}

/**
 * Log the initial debug lines for a PR-update invocation.
 *
 * Exported for unit testing.
 */
export function logUpdateDebugStart(
  log: { debug: (msg: string) => void },
  params: UpdatePullRequestParams,
  pullNumber: number
): void {
  const { title, body, dryRun } = params;
  log.debug(`PR Number: ${pullNumber}`);
  log.debug(`Title: ${title ?? '(no change)'}`);
  log.debug(`Body: ${body ? '(provided)' : '(no change)'}`);
  log.debug(`DryRun: ${dryRun ?? false}`);
}

/**
 * Log the PR-info debug lines after fetching PR data.
 *
 * Exported for unit testing.
 */
export function logPRFoundDebug(
  log: { debug: (msg: string) => void },
  info: { prUrl: string; headBranch: string; baseBranch: string; headSha: string }
): void {
  log.debug(`PR found: ${info.prUrl}`);
  log.debug(`Head branch: ${info.headBranch}`);
  log.debug(`Base branch: ${info.baseBranch}`);
  log.debug(`Head SHA: ${info.headSha}`);
}

/**
 * Update PR title/body metadata when at least one is provided; log what was
 * updated. Returns `{ titleUpdated: false, bodyUpdated: false }` when neither
 * is supplied.
 *
 * Exported for unit testing.
 */
// fallow-ignore-next-line complexity
export async function applyMetadataUpdate(
  deps: GitHubModuleDeps,
  pullNumber: number,
  title: string | undefined,
  body: string | undefined,
  log: { info: (msg: string) => void }
): Promise<{ titleUpdated: boolean; bodyUpdated: boolean }> {
  if (title === undefined && body === undefined) {
    return { titleUpdated: false, bodyUpdated: false };
  }

  const updateParams: { title?: string; body?: string } = {};
  if (title !== undefined) {
    updateParams.title = title;
  }
  if (body !== undefined) {
    updateParams.body = body;
  }

  const metadataResult = await updatePullRequestMetadata(deps, pullNumber, updateParams);
  if (metadataResult.titleUpdated) {
    log.info(`Updated PR title to: ${title}`);
  }
  if (metadataResult.bodyUpdated) {
    log.info(`Updated PR description`);
  }
  return metadataResult;
}

/**
 * Update a pull request end-to-end.
 *
 * Orchestrates the full flow: fetches the PR and its branch, scans for changed
 * files, creates a commit on the PR branch, and optionally updates the PR's
 * title and/or body. When `dryRun` is `true` the operation is simulated and no
 * GitHub resources are modified.
 *
 * @param deps - Module dependencies.
 * @param params - Parameters controlling PR number, title, body, and dry-run.
 * @returns The tool result containing a human-readable message and structured
 *          details about the updated PR (or dry-run output).
 * @throws {Error} If no changes are detected, the PR is not found, or the
 *                 GitHub API call fails.
 */
export async function updatePullRequest(
  deps: GitHubModuleDeps,
  params: UpdatePullRequestParams
): Promise<UpdatePullRequestResult> {
  const { title, body, message, dryRun } = params;
  const log = createLogger(deps);

  // Validate input parameters early
  validateUpdatePullRequestParams(params);

  // Resolve PR number from context if not provided
  const resolvedPullNumber = resolvePullRequestNumber(deps, params.pull_number);

  logUpdateDebugStart(log, params, resolvedPullNumber);

  const { headBranch, baseBranch, headSha, prUrl } = await fetchPullRequestData(
    deps,
    resolvedPullNumber
  );

  logPRFoundDebug(log, { prUrl, headBranch, baseBranch, headSha });

  // Detect working-tree changes via `git status --porcelain`, filtered by
  // platform ignore patterns. This replaces the old `buildFileMap` +
  // `scanForChanges` round-trip over the Git Data API (broken on Forgejo).
  const { changed: changedPaths, deleted: deletedPaths } = await getWorkspaceChangePaths(
    deps.context.workspace
  );

  // Dry run mode - report what would happen without making changes
  if (dryRun) {
    const result = buildDryRunReport({
      pullNumber: resolvedPullNumber,
      title,
      body,
      headBranch,
      baseBranch,
      prUrl,
      changedFiles: changedPaths,
      deletedFiles: deletedPaths,
    });
    log.debug(result.content[0]!.text);
    return result;
  }

  const commitSha = await applyCommit(deps, {
    changedPaths,
    deletedPaths,
    headBranch,
    message,
    pullNumber: resolvedPullNumber,
    log,
  });

  const { titleUpdated, bodyUpdated } = await applyMetadataUpdate(
    deps,
    resolvedPullNumber,
    title,
    body,
    log
  );

  const result = buildSuccessReport({
    pullNumber: resolvedPullNumber,
    prUrl,
    headBranch,
    baseBranch,
    commitSha,
    titleUpdated,
    bodyUpdated,
  });
  log.info(`SUCCESS: ${result.content[0]!.text}`);
  return result;
}

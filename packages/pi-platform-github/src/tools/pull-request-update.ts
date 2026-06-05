/**
 * @file GitHub pull request update tool implementation.
 *
 * Implements the server-side logic for the `update_pull_request` custom tool:
 * detecting changed files in the working tree, creating blobs/trees/commits
 * via the Git Data API, and pushing the new commit to an existing PR branch.
 * Supports updating the PR title and body as well. Supports dry-run mode for
 * testing without side effects.
 */

import type { GitHubModuleDeps, UpdatePullRequestParams, UpdatePullRequestDetails } from '../types';
import { MAX_TITLE_LENGTH } from '../constants';
import {
  createLogger,
  scanForChanges,
  createBlobsAndTree,
  createCommitAndUpdateBranch,
  buildFileMap,
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
  changedFiles: readonly { path: string }[];
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
  if (changedFiles.length > 0 || deletedFiles.length > 0) {
    parts.push(`- Code changes:`);
    if (changedFiles.length > 0) {
      parts.push(`  - ${changedFiles.length} modified/new file(s)`);
    }
    if (deletedFiles.length > 0) {
      parts.push(`  - ${deletedFiles.length} deleted file(s)`);
    }
  } else {
    parts.push(`- No code changes detected`);
  }

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

  log.debug(`PR Number: ${resolvedPullNumber}`);
  log.debug(`Title: ${title ?? '(no change)'}`);
  log.debug(`Body: ${body ? '(provided)' : '(no change)'}`);
  log.debug(`DryRun: ${dryRun ?? false}`);

  const { headBranch, baseBranch, headSha, prUrl } = await fetchPullRequestData(
    deps,
    resolvedPullNumber
  );

  log.debug(`PR found: ${prUrl}`);
  log.debug(`Head branch: ${headBranch}`);
  log.debug(`Base branch: ${baseBranch}`);
  log.debug(`Head SHA: ${headSha}`);

  // Get files that exist in the current PR head tree (for comparison)
  log.debug(`Getting PR head tree...`);
  const headFiles = await buildFileMap(deps, headSha);
  log.debug(`Found ${headFiles.size} files in PR head`);

  // Scan for changes (do this before dry run check so dry run can report them)
  const { changedFiles, deletedFiles } = await scanForChanges(deps, headFiles, log);

  // Dry run mode - report what would happen without making changes
  if (dryRun) {
    const result = buildDryRunReport({
      pullNumber: resolvedPullNumber,
      title,
      body,
      headBranch,
      baseBranch,
      prUrl,
      changedFiles,
      deletedFiles,
    });
    log.debug(result.content[0]!.text);
    return result;
  }

  let commitSha: string | undefined;
  if (changedFiles.length > 0 || deletedFiles.length > 0) {
    // Create blobs and tree
    const treeSha = await createBlobsAndTree(deps, {
      changedFiles,
      deletedFiles,
      parentSha: headSha,
      log,
    });

    // Generate commit message
    let commitMessage = message;
    if (!commitMessage) {
      // Generate a descriptive commit message based on the changes
      const changes: string[] = [];
      if (changedFiles.length > 0) {
        changes.push(`${changedFiles.length} modified/new file(s)`);
      }
      if (deletedFiles.length > 0) {
        changes.push(`${deletedFiles.length} deleted file(s)`);
      }
      commitMessage = `Update PR #${resolvedPullNumber}: ${changes.join(', ')}`;
    }

    // Create commit and update branch
    commitSha = await createCommitAndUpdateBranch(deps, {
      treeSha,
      parentSha: headSha,
      branchName: headBranch,
      message: commitMessage,
      log,
    });
    log.info(`Created new commit ${commitSha} on branch ${headBranch}`);
  } else {
    log.info(`No code changes detected, only updating PR metadata if provided`);
  }

  // Update PR title/body if provided
  let titleUpdated = false;
  let bodyUpdated = false;
  if (title !== undefined || body !== undefined) {
    const updateParams: { title?: string; body?: string } = {};
    if (title !== undefined) {
      updateParams.title = title;
    }
    if (body !== undefined) {
      updateParams.body = body;
    }
    const metadataResult = await updatePullRequestMetadata(deps, resolvedPullNumber, updateParams);
    titleUpdated = metadataResult.titleUpdated;
    bodyUpdated = metadataResult.bodyUpdated;

    if (titleUpdated) {
      log.info(`Updated PR title to: ${title}`);
    }
    if (bodyUpdated) {
      log.info(`Updated PR description`);
    }
  }

  const successParts: string[] = [`Pull request #${resolvedPullNumber} updated: ${prUrl}`];
  if (commitSha) {
    successParts.push(`- New commit: ${commitSha}`);
  }
  if (titleUpdated) {
    successParts.push(`- Title updated`);
  }
  if (bodyUpdated) {
    successParts.push(`- Description updated`);
  }

  const successMessage = successParts.join('\n');
  log.info(`SUCCESS: ${successMessage}`);

  const details: UpdatePullRequestDetails = {
    pullRequestNumber: resolvedPullNumber,
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

  return {
    content: [{ type: 'text' as const, text: successMessage }],
    details,
  };
}

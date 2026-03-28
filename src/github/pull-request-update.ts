/**
 * @file GitHub pull request update tool implementation.
 *
 * Implements the server-side logic for the `update_pull_request` custom tool:
 * detecting changed files in the working tree, creating blobs/trees/commits
 * via the Git Data API, and pushing the new commit to an existing PR branch.
 * Supports updating the PR title and body as well. Supports dry-run mode for
 * testing without side effects.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import ignore from 'ignore';
import { getOctokit } from './octokit.js';
import {
  FILE_MODE_DIRECTORY,
  FILE_MODE_EXECUTABLE,
  FILE_MODE_REGULAR,
  MAX_FILE_SIZE_BYTES,
  IGNORE_PATTERNS,
} from './constants.js';

const octokit = getOctokit();

/**
 * Logging helpers with emoji labels for pull-request update operations.
 */
function pruDebug(msg: string): void {
  core.debug(`🔀 ${msg}`);
}

function pruInfo(msg: string): void {
  core.info(`🔀 ${msg}`);
}

export interface UpdatePullRequestParams {
  pull_number?: number;
  title?: string;
  body?: string;
  dryRun?: boolean;
}

export interface UpdatePullRequestResult {
  content: { type: 'text'; text: string }[];
  details: UpdatePullRequestDetails;
}

export interface UpdatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  commitSha?: string;
  titleUpdated?: boolean;
  bodyUpdated?: boolean;
  dryRun: boolean;
  cancelled?: boolean;
}

/**
 * Git file mode types
 */
export type FileMode =
  | typeof FILE_MODE_REGULAR
  | typeof FILE_MODE_EXECUTABLE
  | typeof FILE_MODE_DIRECTORY;

/**
 * Recursively scan the local repository for files that are new or modified
 * compared to the current PR branch head.
 *
 * Respects `.gitignore` and the additional {@link IGNORE_PATTERNS}. Skips
 * binary files and files larger than {@link MAX_FILE_SIZE_BYTES}.
 *
 * @param headFiles - Map of head-branch file paths to their SHA and content,
 *                   used for change detection.
 * @returns An array of changed file descriptors (path, content, mode).
 */
async function scanForChanges(
  headFiles: Map<string, { sha: string; content: string | null }>
): Promise<
  {
    path: string;
    content: string;
    mode: FileMode;
  }[]
> {
  pruDebug(`Scanning local files for changes...`);

  const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const ig = ignore();
  try {
    const gitignoreContent = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf-8');
    ig.add(gitignoreContent);
  } catch (_e) {
    // No .gitignore file, that's fine
  }
  // Add additional patterns to always ignore
  ig.add(IGNORE_PATTERNS);

  const changedFiles: {
    path: string;
    content: string;
    mode: FileMode;
  }[] = [];

  async function scanDirectory(dir: string, relativePath = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativeFilePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (ig.ignores(relativeFilePath)) {
        pruDebug(`Ignored: ${relativeFilePath}`);
        continue;
      }

      if (entry.isDirectory()) {
        await scanDirectory(fullPath, relativePath);
      } else if (entry.isFile()) {
        // Skip files that are too large (>1MB to be safe)
        const stats = await fs.stat(fullPath);
        if (stats.size > MAX_FILE_SIZE_BYTES) {
          pruDebug(`Skipping large file (>1MB): ${relativeFilePath}`);
          continue;
        }

        // Try to read file content, skip if binary
        let localContent: string;
        try {
          localContent = await fs.readFile(fullPath, 'utf-8');
        } catch (_e) {
          pruDebug(`Skipping file (likely binary): ${relativeFilePath}`);
          continue;
        }

        const headFile = headFiles.get(relativeFilePath);

        // Check if file is new or modified
        let isChanged = false;
        if (!headFile) {
          // New file
          isChanged = true;
          pruDebug(`New file: ${relativeFilePath}`);
        } else if (headFile.content !== null && headFile.content !== localContent) {
          // Modified file
          isChanged = true;
          pruDebug(`Modified file: ${relativeFilePath}`);
        }

        if (isChanged) {
          changedFiles.push({
            path: relativeFilePath,
            content: localContent,
            mode: FILE_MODE_REGULAR,
          });
        }
      }
    }
  }

  await scanDirectory(repoRoot, '');

  pruDebug(`Found ${changedFiles.length} changed file(s)`);
  return changedFiles;
}

/**
 * Upload changed files as Git blobs and create a tree that references them.
 *
 * @param changedFiles - Array of changed file descriptors.
 * @param parentSha    - SHA of the parent commit (current PR head).
 * @returns The SHA of the newly created tree.
 */
async function createBlobsAndTree(
  changedFiles: {
    path: string;
    content: string;
    mode: FileMode;
  }[],
  parentSha: string
): Promise<string> {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  pruDebug(`Creating blobs for changed files...`);

  // Create blobs for all changed files and map their paths to SHAs
  const blobShaMap = new Map<string, string>();
  for (const file of changedFiles) {
    const blob = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: Buffer.from(file.content).toString('base64'),
      encoding: 'base64',
    });
    blobShaMap.set(file.path, blob.data.sha);
    pruDebug(`Created blob for ${file.path}: ${blob.data.sha}`);
  }
  pruDebug(`Created ${blobShaMap.size} blob(s)`);

  // Create tree with all the blob references
  pruDebug(`Creating tree with changes...`);
  const tree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: parentSha,
    tree: Array.from(blobShaMap.entries()).map(([path, sha]) => ({
      path,
      mode: FILE_MODE_REGULAR,
      type: 'blob',
      sha,
    })),
  });
  pruDebug(`Created tree: ${tree.data.sha}`);

  return tree.data.sha;
}

/**
 * Create a commit on the given tree and point the branch reference at it.
 *
 * @param treeSha    - SHA of the tree containing the changed files.
 * @param parentSha  - SHA of the parent commit (current PR head).
 * @param branchName - Name of the branch to update.
 * @param message    - Commit message.
 * @returns The SHA of the new commit.
 */
async function createCommitAndUpdateBranch(
  treeSha: string,
  parentSha: string,
  branchName: string,
  message: string
): Promise<string> {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  // Create a single commit with the new tree
  pruDebug(`Creating commit...`);
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: treeSha,
    parents: [parentSha],
  });
  pruDebug(`Created commit: ${commit.data.sha}`);

  // Update the branch reference to point to the new commit
  pruDebug(`Updating branch reference...`);
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: commit.data.sha,
  });
  pruDebug(`Branch updated successfully`);

  return commit.data.sha;
}

/**
 * Update an existing pull request's title and/or body via the GitHub REST API.
 *
 * @param pullNumber - PR number.
 * @param updates    - Object with optional title and/or body.
 * @returns An object containing the updated PR URL.
 */
async function updatePullRequestMetadata(
  pullNumber: number,
  updates: { title?: string; body?: string }
): Promise<{ titleUpdated: boolean; bodyUpdated: boolean }> {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

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

  pruDebug(`Updating PR #${pullNumber} metadata...`);

  await octokit.rest.pulls.update({
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
 * Update a pull request end-to-end.
 *
 * Orchestrates the full flow: fetches the PR and its branch, scans for changed
 * files, creates a commit on the PR branch, and optionally updates the PR's
 * title and/or body. When `dryRun` is `true` the operation is simulated and no
 * GitHub resources are modified.
 *
 * @param params - Parameters controlling PR number, title, body, and dry-run.
 * @returns The tool result containing a human-readable message and structured
 *          details about the updated PR (or dry-run output).
 * @throws {Error} If no changes are detected, the PR is not found, or the
 *                 GitHub API call fails.
 */
export async function updatePullRequest(
  params: UpdatePullRequestParams
): Promise<UpdatePullRequestResult> {
  const { pull_number, title, body, dryRun } = params;

  // Resolve PR number from context if not provided
  const resolvedPullNumber = pull_number ?? github.context.issue.number;
  if (!resolvedPullNumber) {
    throw new Error('Pull request number not provided and not available in context');
  }

  pruDebug(`PR Number: ${resolvedPullNumber}`);
  pruDebug(`Title: ${title ?? '(no change)'}`);
  pruDebug(`Body: ${body ? '(provided)' : '(no change)'}`);
  pruDebug(`DryRun: ${dryRun ?? false}`);

  // Fetch PR details
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  pruDebug(`Fetching PR #${resolvedPullNumber}...`);
  const prData = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: resolvedPullNumber,
  });

  const headBranch = prData.data.head.ref;
  const baseBranch = prData.data.base.ref;
  const headSha = prData.data.head.sha;
  const prUrl = prData.data.html_url;

  pruDebug(`PR found: ${prUrl}`);
  pruDebug(`Head branch: ${headBranch}`);
  pruDebug(`Base branch: ${baseBranch}`);
  pruDebug(`Head SHA: ${headSha}`);

  // Dry run mode for metadata updates only (no changes)
  if (dryRun) {
    const parts: string[] = [`[DRY RUN] Would update pull request #${resolvedPullNumber}:`];
    if (title !== undefined) {
      parts.push(`- Title: ${title}`);
    }
    if (body !== undefined) {
      parts.push(`- Body: ${body}`);
    }
    parts.push(`- Head branch: ${headBranch}`);
    parts.push(`- Base branch: ${baseBranch}`);

    const message = parts.join('\n');
    pruDebug(message);

    return {
      content: [{ type: 'text' as const, text: message }],
      details: {
        pullRequestNumber: resolvedPullNumber,
        pullRequestUrl: prUrl,
        headBranch,
        baseBranch,
        dryRun: true,
      },
    };
  }

  // Get files that exist in the current PR head tree (for comparison)
  pruDebug(`Getting PR head tree...`);
  const headTree = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: headSha,
    recursive: 'true',
  });

  // Create a map of head files for quick lookup: path -> {sha, content}
  const headFiles = new Map<string, { sha: string; content: string | null }>();
  for (const item of headTree.data.tree) {
    if (item.type === 'blob') {
      let content: string | null = null;
      if (item.sha) {
        try {
          const blob = await octokit.rest.git.getBlob({
            owner,
            repo,
            file_sha: item.sha,
          });
          content = Buffer.from(blob.data.content, 'base64').toString('utf-8');
        } catch (_e) {
          // Could not fetch blob content, continue with null
        }
      }
      headFiles.set(item.path, { sha: item.sha, content });
    }
  }
  pruDebug(`Found ${headFiles.size} files in PR head`);

  // Scan for changes
  const changedFiles = await scanForChanges(headFiles);

  let commitSha: string | undefined;
  if (changedFiles.length > 0) {
    // Create blobs and tree
    const treeSha = await createBlobsAndTree(changedFiles, headSha);

    // Create commit and update branch
    commitSha = await createCommitAndUpdateBranch(
      treeSha,
      headSha,
      headBranch,
      title ?? `Update PR #${resolvedPullNumber}`
    );
    pruInfo(`Created new commit ${commitSha} on branch ${headBranch}`);
  } else {
    pruInfo(`No code changes detected, only updating PR metadata if provided`);
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
    const metadataResult = await updatePullRequestMetadata(resolvedPullNumber, updateParams);
    titleUpdated = metadataResult.titleUpdated;
    bodyUpdated = metadataResult.bodyUpdated;

    if (titleUpdated) {
      pruInfo(`Updated PR title to: ${title}`);
    }
    if (bodyUpdated) {
      pruInfo(`Updated PR description`);
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
  pruInfo(`SUCCESS: ${successMessage}`);

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

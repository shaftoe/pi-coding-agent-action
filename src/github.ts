import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import ignore from 'ignore';
import RestEndpointMethodTypes from '@octokit/plugin-rest-endpoint-methods';

export type createReactionType =
  RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['createForIssueComment']['response'];
type deleteReactionType =
  RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['deleteForIssueComment']['response'];
type createCommentType =
  RestEndpointMethodTypes.RestEndpointMethodTypes['issues']['createComment']['response'];

export interface IssueOrPullRequestContext {
  title: string;
  body?: string;
  number: number;
}

export function getIssueOrPullRequestContext(): IssueOrPullRequestContext | undefined {
  const eventType = github.context.eventName;
  const payload = github.context.payload;

  if (eventType === 'issue_comment' || eventType === 'issues') {
    const issue = payload.issue;
    if (issue?.title) {
      const result: IssueOrPullRequestContext = {
        title: issue.title,
        number: issue.number,
      };
      if (issue.body !== undefined) {
        result.body = issue.body;
      }
      return result;
    }
  } else if (eventType === 'pull_request') {
    const pullRequest = payload.pull_request;
    if (pullRequest?.title) {
      const result: IssueOrPullRequestContext = {
        title: pullRequest.title,
        number: pullRequest.number,
      };
      if (pullRequest.body !== undefined) {
        result.body = pullRequest.body;
      }
      return result;
    }
  }

  return undefined;
}

export async function getPrompt(): Promise<string | undefined> {
  const comment = await getComment();
  if (!comment) {
    return undefined;
  }

  const prompt = comment.body;
  if (!prompt) {
    core.notice('no prompt found in comment, skipping prompt');
    return undefined;
  }

  // Fetch additional context from issue/PR
  const issueOrPrContext = getIssueOrPullRequestContext();
  if (issueOrPrContext) {
    const { title, body, number } = issueOrPrContext;
    const contextParts: string[] = [`Issue/PR #${number}: ${title}`];

    if (body) {
      contextParts.push(`\nDescription:\n${body}`);
    }

    contextParts.push(`\n\nComment/Instruction:\n${prompt}`);
    return contextParts.join('');
  }

  // Return just the comment body if no context available
  return prompt;
}

const trigger = core.getInput('trigger') || '/pi';
const octokit = github.getOctokit(core.getInput('github_token'));

export async function addReaction(): Promise<createReactionType | undefined> {
  const comment = github.context.payload.comment;
  if (!comment) {
    core.notice('no comment found, skipping reaction');
    return;
  }

  return await octokit.rest.reactions.createForIssueComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: comment.id,
    content: 'eyes',
  });
}

async function getComment(): Promise<typeof github.context.payload.comment | undefined> {
  const comment = github.context.payload.comment;
  if (!comment) {
    core.notice('no comment found in context, skipping prompt');
    return;
  }

  comment.body = comment.body.replace(trigger, '').trim();

  return comment;
}

export async function deleteReaction(
  reaction: createReactionType | undefined
): Promise<deleteReactionType | undefined> {
  if (!reaction) {
    return;
  }

  const comment = github.context.payload.comment;
  if (!comment) {
    return;
  }

  return octokit.rest.reactions.deleteForIssueComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: comment.id,
    reaction_id: reaction.data.id,
  });
}

async function createComment(body: string): Promise<createCommentType | undefined> {
  if (!body) {
    return;
  }

  return octokit.rest.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: github.context.issue.number,
    body,
  });
}

export async function createFinalComment(body: string): Promise<createCommentType | undefined> {
  if (!body) {
    return;
  }

  // Build the action run URL
  const serverUrl = github.context.serverUrl || 'https://github.com';
  const { owner, repo } = github.context.repo;
  const runId = github.context.runId;

  let finalBody = body;
  if (owner && repo && runId) {
    const actionRunUrl = `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
    finalBody = `${body}\n\n---\n\n[View action run](${actionRunUrl})`;
  }

  return createComment(finalBody);
}

export interface CreatePullRequestParams {
  title: string;
  body?: string;
  base?: string;
  dryRun?: boolean;
}

interface CreatePullRequestResult {
  content: { type: 'text'; text: string }[];
  details: CreatePullRequestDetails;
}

interface CreatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  dryRun: boolean;
}

export async function createPullRequest(
  params: CreatePullRequestParams
): Promise<CreatePullRequestResult> {
  const { title, body, base, dryRun } = params;
  const info = (msg: string) => {
    core.info(`[create_pull_request] ${msg}`);
  };
  const debug = (msg: string) => {
    core.debug(`[create_pull_request] ${msg}`);
  };

  // Auto-generate branch name
  const issueNumber = github.context.issue?.number ?? 'unknown';
  const timestamp = Date.now();
  const head = `pi/issue${issueNumber}-${timestamp}`;

  debug(`Title: ${title}`);
  debug(`Auto-generated branch: ${head}`);
  debug(`Base: ${base ?? 'default'}`);
  debug(`DryRun: ${dryRun ?? false}`);

  // Determine base branch
  let baseBranch: string;
  if (base) {
    // Explicitly provided by caller
    baseBranch = base;
    debug(`Using provided base branch: ${baseBranch}`);
  } else if (github.context.payload.repository?.default_branch) {
    // Available in context
    baseBranch = github.context.payload.repository.default_branch;
    debug(`Using default branch from context: ${baseBranch}`);
  } else {
    // Fetch from GitHub API
    debug(`Fetching repository default branch from GitHub API...`);
    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    const repoData = await octokit.rest.repos.get({
      owner,
      repo,
    });
    baseBranch = repoData.data.default_branch;
    debug(`Fetched default branch: ${baseBranch}`);
  }

  // Generate default body if not provided
  let bodyText = body ?? '';
  if (!bodyText && github.context.issue?.number) {
    const eventType = github.context.eventName;
    const issueNum = github.context.issue.number;
    if (eventType === 'issue_comment' || eventType === 'issues') {
      bodyText = `Fixes #${issueNum}\n\nCreated by pi coding agent.`;
    } else if (eventType === 'pull_request') {
      bodyText = `Related to #${issueNum}\n\nCreated by pi coding agent.`;
    }
    debug(`Auto-generated body from issue #${issueNum}`);
  }

  // Dry run mode
  if (dryRun) {
    const message = `[DRY RUN] Would create pull request:\n- Title: ${title}\n- Body: ${bodyText || '(empty)'}\n- Base: ${baseBranch}\n- Head: ${head}`;
    debug(message);

    return {
      content: [{ type: 'text' as const, text: message }],
      details: {
        pullRequestNumber: 0,
        pullRequestUrl: '',
        headBranch: head,
        baseBranch: baseBranch,
        dryRun: true,
      },
    };
  }

  // Create and push the new branch via GitHub API
  debug(`Preparing branch and changes via GitHub API...`);

  try {
    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;

    // Get base branch reference
    debug(`Getting base branch "${baseBranch}" reference...`);
    const baseRef = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    const baseSha = baseRef.data.object.sha;
    debug(`Base branch SHA: ${baseSha}`);

    // Get files that exist in the base branch tree (for comparison)
    debug(`Getting base branch tree...`);
    const baseTree = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: baseSha,
      recursive: 'true',
    });

    // Create a map of base files for quick lookup: path -> {sha, content}
    const baseFiles = new Map<string, { sha: string; content: string | null }>();
    for (const item of baseTree.data.tree) {
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
        baseFiles.set(item.path, { sha: item.sha, content });
      }
    }
    debug(`Found ${baseFiles.size} files in base branch`);
    debug(`Scanning local files for changes...`);

    const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();

    const ig = ignore();
    try {
      const gitignoreContent = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf-8');
      ig.add(gitignoreContent);
    } catch (_e) {
      // No .gitignore file, that's fine
    }
    // Add additional patterns to always ignore
    ig.add([
      '.git',
      '.github/workflows/*/pi.yml', // Don't include the workflow that runs this action
    ]);

    const changedFiles: {
      path: string;
      content: string;
      mode: '100644' | '100755' | '040000';
    }[] = [];

    async function scanDirectory(dir: string, relativePath = '') {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativeFilePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

        if (ig.ignores(relativeFilePath)) {
          debug(`Ignored: ${relativeFilePath}`);
          continue;
        }

        if (entry.isDirectory()) {
          await scanDirectory(fullPath, relativeFilePath);
        } else if (entry.isFile()) {
          // Skip files that are too large (>1MB to be safe)
          const stats = await fs.stat(fullPath);
          if (stats.size > 1024 * 1024) {
            debug(`Skipping large file (>1MB): ${relativeFilePath}`);
            continue;
          }

          // Try to read file content, skip if binary
          let localContent: string;
          try {
            localContent = await fs.readFile(fullPath, 'utf-8');
          } catch (_e) {
            debug(`Skipping file (likely binary): ${relativeFilePath}`);
            continue;
          }

          const baseFile = baseFiles.get(relativeFilePath);

          // Check if file is new or modified
          let isChanged = false;
          if (!baseFile) {
            // New file
            isChanged = true;
            debug(`New file: ${relativeFilePath}`);
          } else if (baseFile.content !== null && baseFile.content !== localContent) {
            // Modified file
            isChanged = true;
            debug(`Modified file: ${relativeFilePath}`);
          }

          if (isChanged) {
            changedFiles.push({
              path: relativeFilePath,
              content: localContent,
              mode: '100644', // Default file mode (regular file, not executable)
            });
          }
        }
      }
    }

    await scanDirectory(repoRoot, '');

    if (changedFiles.length === 0) {
      const errorMsg =
        'No changes detected. Please add new files and/or make your changes before creating a pull request.';
      throw new Error(errorMsg);
    }

    debug(`Found ${changedFiles.length} changed file(s)`);

    // Create new branch reference from base branch
    debug(`Creating new branch "${head}"...`);
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${head}`,
      sha: baseSha,
    });
    debug(`Branch created successfully`);

    // Create a tree with all the changes
    debug(`Creating blobs for changed files...`);

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
      debug(`Created blob for ${file.path}: ${blob.data.sha}`);
    }
    debug(`Created ${blobShaMap.size} blob(s)`);

    // Create tree with all the blob references
    debug(`Creating tree with changes...`);
    const tree = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseSha,
      tree: Array.from(blobShaMap.entries()).map(([path, sha]) => ({
        path,
        mode: '100644',
        type: 'blob',
        sha,
      })),
    });
    debug(`Created tree: ${tree.data.sha}`);

    // Create a single commit with the new tree
    debug(`Creating commit...`);
    const commit = await octokit.rest.git.createCommit({
      owner,
      repo,
      message: title,
      tree: tree.data.sha,
      parents: [baseSha],
    });
    debug(`Created commit: ${commit.data.sha}`);

    // Update the branch reference to point to the new commit
    debug(`Updating branch reference...`);
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${head}`,
      sha: commit.data.sha,
    });
    debug(`Branch updated successfully`);

    // Create the pull request
    debug(`Creating pull request...`);

    const result = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body: bodyText,
      base: baseBranch,
      head,
    });

    const prNumber = result.data.number;
    const prUrl = result.data.html_url;
    const successMessage = `Pull request #${prNumber} created: ${prUrl}`;

    info(`SUCCESS: ${successMessage}`);

    const details = {
      pullRequestNumber: prNumber,
      pullRequestUrl: prUrl,
      headBranch: result.data.head.ref,
      baseBranch: result.data.base.ref,
      dryRun: false,
    };

    return {
      content: [{ type: 'text' as const, text: successMessage }],
      details,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorMsg = `[create_pull_request] Failed to create pull request: ${message}`;
    throw new Error(errorMsg);
  }
}

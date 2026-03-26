import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@mariozechner/pi-ai';
import { octokit } from './github';
import * as github from '@actions/github';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface CreatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  dryRun: boolean;
}

export const extFactory = (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: 'create_pull_request',
    label: 'Create Pull Request',
    description:
      'Create a new pull request on GitHub. This tool handles everything: creates a new branch, pushes changes, and creates the PR. The branch name is auto-generated following the pi/issue{number}-{timestamp} pattern.',
    promptSnippet:
      'Create a pull request with title, description, and optionally base branch. The tool will handle branch creation, pushing changes, and PR creation automatically.',
    promptGuidelines: [
      'Always use the create_pull_request tool to create pull requests - do not use git commands or gh CLI directly.',
      'The tool will automatically generate a branch name in the format: pi/issue{number}-{timestamp}.',
      'Make sure your changes are made (modified files exist) before calling this tool. The tool will detect changes, create branch, and create PR automatically.',
      'Use dryRun=true first to verify the PR configuration, then dryRun=false to create it.',
    ],
    parameters: Type.Object({
      title: Type.String({
        description:
          'Pull request title (should be descriptive and follow conventional commit format)',
      }),
      body: Type.Optional(
        Type.String({
          description:
            'Detailed description of changes in markdown format. If not provided, will auto-generate from issue context (e.g., "Fixes #27")',
        })
      ),
      base: Type.Optional(
        Type.String({
          description:
            'Target branch to merge into. If not provided, uses repository default branch (e.g., "main", "master", or "v1")',
        })
      ),
      dryRun: Type.Optional(
        Type.Boolean({
          description:
            'Set to true to simulate PR creation without actually creating it (for testing). Set to false to create the actual PR.',
        })
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      console.info('=== create_pull_request tool called ===');

      // Check for cancellation
      if (signal?.aborted) {
        console.info('[create_pull_request] Tool execution cancelled');
        return {
          content: [{ type: 'text', text: 'Pull request creation was cancelled' }],
          details: {},
        };
      }

      const { title, body, base, dryRun } = params as {
        title: string;
        body?: string;
        base?: string;
        dryRun?: boolean;
      };

      // Auto-generate branch name
      const issueNumber = github.context.issue?.number ?? 'unknown';
      const timestamp = Date.now();
      const head = `pi/issue${issueNumber}-${timestamp}`;

      console.info(`[create_pull_request] Title: ${title}`);
      console.info(`[create_pull_request] Auto-generated branch: ${head}`);
      console.info(`[create_pull_request] Base: ${base ?? 'default'}`);
      console.info(`[create_pull_request] DryRun: ${dryRun ?? false}`);

      // Determine base branch
      const baseBranch = base ?? github.context.payload.repository?.default_branch ?? 'main';

      console.info(`[create_pull_request] Resolved base branch: ${baseBranch}`);

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
        console.info(`[create_pull_request] Auto-generated body from issue #${issueNum}`);
      }

      console.info(`[create_pull_request] Body: ${bodyText || '(empty)'}`);

      // Dry run mode
      if (dryRun) {
        const message = `[DRY RUN] Would create pull request:\n- Title: ${title}\n- Body: ${bodyText || '(empty)'}\n- Base: ${baseBranch}\n- Head: ${head}`;
        console.info(message);

        return {
          content: [{ type: 'text', text: message }],
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
      console.info(`[create_pull_request] Preparing branch and changes via GitHub API...`);

      try {
        const owner = github.context.repo.owner;
        const repo = github.context.repo.repo;

        // Get base branch reference
        console.info(`[create_pull_request] Getting base branch "${baseBranch}" reference...`);
        const baseRef = await octokit.rest.git.getRef({
          owner,
          repo,
          ref: `heads/${baseBranch}`,
        });
        const baseSha = baseRef.data.object.sha;
        console.info(`[create_pull_request] Base branch SHA: ${baseSha}`);

        // Get files that exist in the base branch tree (for comparison)
        console.info(`[create_pull_request] Getting base branch tree...`);
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
        console.info(`[create_pull_request] Found ${baseFiles.size} files in base branch`);

        // Detect changed files by scanning the src directory
        console.info(`[create_pull_request] Scanning local files for changes...`);

        // Get the repository root directory (GitHub Actions sets GITHUB_WORKSPACE)
        const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();

        // Read files in src directory
        const srcDir = path.join(repoRoot, 'src');
        const changedFiles: {
          path: string;
          content: string;
          mode: '100644' | '100755' | '040000';
        }[] = [];

        async function scanDirectory(dir: string, relativePath = '') {
          const entries = await fs.readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativeFilePath = relativePath
              ? path.join(relativePath, entry.name)
              : entry.name;

            if (entry.isDirectory()) {
              await scanDirectory(fullPath, relativeFilePath);
            } else if (entry.isFile()) {
              // Skip node_modules and other ignored directories
              if (entry.name === 'node_modules' || entry.name === '.git') {
                continue;
              }

              const localContent = await fs.readFile(fullPath, 'utf-8');
              const baseFile = baseFiles.get(relativeFilePath);

              // Check if file is new or modified
              let isChanged = false;
              if (!baseFile) {
                // New file
                isChanged = true;
                console.info(`[create_pull_request] New file: ${relativeFilePath}`);
              } else if (baseFile.content !== null && baseFile.content !== localContent) {
                // Modified file
                isChanged = true;
                console.info(`[create_pull_request] Modified file: ${relativeFilePath}`);
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

        await scanDirectory(srcDir, 'src');

        if (changedFiles.length === 0) {
          const errorMsg =
            'No changes detected. Please make your changes before creating a pull request.';
          console.info(`[create_pull_request] ERROR: ${errorMsg}`);
          throw new Error(errorMsg);
        }

        console.info(`[create_pull_request] Found ${changedFiles.length} changed file(s)`);

        // Create new branch reference from base branch
        console.info(`[create_pull_request] Creating new branch "${head}"...`);
        await octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${head}`,
          sha: baseSha,
        });
        console.info(`[create_pull_request] Branch created successfully`);

        // Create a tree with all the changes
        console.info(`[create_pull_request] Creating tree with changes...`);

        // Get the current tree of the new branch (which is the same as base)
        const newTreeItems = [...baseTree.data.tree];

        // Update/add the changed files in the tree
        for (const file of changedFiles) {
          // Create a blob for the file content
          const blob = await octokit.rest.git.createBlob({
            owner,
            repo,
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64',
          });

          // Update or add the tree item
          const existingIndex = newTreeItems.findIndex(item => item.path === file.path);
          if (existingIndex >= 0) {
            // Update existing file
            newTreeItems[existingIndex] = {
              path: file.path,
              mode: file.mode,
              type: 'blob',
              sha: blob.data.sha,
            };
          } else {
            // Add new file
            newTreeItems.push({
              path: file.path,
              mode: file.mode,
              type: 'blob',
              sha: blob.data.sha,
            });
          }
        }

        // Note: GitHub API requires creating trees recursively for nested structures
        // For simplicity, we'll use a different approach: update files individually via REST API
        console.info(`[create_pull_request] Updating files via GitHub API...`);

        // Update each file individually using the REST API
        for (const file of changedFiles) {
          const fileSha = baseFiles.get(file.path)?.sha;
          console.info(`[create_pull_request] Updating file: ${file.path}`);

          const updateParams: {
            owner: string;
            repo: string;
            path: string;
            message: string;
            content: string;
            sha?: string;
            branch: string;
          } = {
            owner,
            repo,
            path: file.path,
            message: title,
            content: Buffer.from(file.content).toString('base64'),
            branch: head,
          };

          // Only include sha for existing files (not new files)
          if (fileSha) {
            updateParams.sha = fileSha;
          }

          await octokit.rest.repos.createOrUpdateFileContents(updateParams);
        }
        console.info(`[create_pull_request] All files updated successfully`);

        // Create the pull request
        console.info(`[create_pull_request] Creating pull request...`);

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

        console.info(`[create_pull_request] SUCCESS: ${successMessage}`);

        const details: CreatePullRequestDetails = {
          pullRequestNumber: prNumber,
          pullRequestUrl: prUrl,
          headBranch: result.data.head.ref,
          baseBranch: result.data.base.ref,
          dryRun: false,
        };

        return {
          content: [{ type: 'text', text: successMessage }],
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorMsg = `Failed to create pull request: ${message}`;
        console.info(`[create_pull_request] ERROR: ${errorMsg}`);
        console.error(error);
        throw new Error(errorMsg);
      }
    },
  });

  console.info('[create_pull_request] Tool registered successfully');
};

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@mariozechner/pi-ai';
import { octokit } from './github';
import * as github from '@actions/github';

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
      'Make sure your changes are committed before calling this tool (the tool only handles branch creation and PR creation).',
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

      // Create and push the new branch, then create the PR
      console.info(`[create_pull_request] Creating and pushing branch ${head}...`);

      try {
        // Create new branch from base
        const { execSync } = await import('child_process');
        execSync(`git checkout -b ${head}`, { encoding: 'utf-8' });
        console.info(`[create_pull_request] Created branch: ${head}`);

        // Push the branch to remote
        execSync(`git push -u origin ${head}`, { encoding: 'utf-8' });
        console.info(`[create_pull_request] Pushed branch: ${head}`);

        // Create the pull request
        console.info(`[create_pull_request] Calling GitHub API to create PR...`);

        const result = await octokit.rest.pulls.create({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
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

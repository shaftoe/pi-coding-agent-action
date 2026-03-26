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

const BRANCH_NAME_PATTERN = /^pi\/issue\d+-\d+$/;

export const extFactory = (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: 'create_pull_request',
    label: 'Create Pull Request',
    description:
      'Create a new pull request on GitHub. This is the RECOMMENDED way to create PRs - it handles all the GitHub API calls and ensures proper branch naming format. Use this tool instead of manual git commands.',
    promptSnippet:
      'Create a pull request with title, description, base branch, and head branch (must follow pi/issue{number}-{timestamp} pattern)',
    promptGuidelines: [
      'Always use the create_pull_request tool to create pull requests - do not use git commands or gh CLI directly.',
      'The head branch MUST follow the pattern: pi/issue{number}-{timestamp} (e.g., pi/issue27-1744533000000).',
      'Get the current issue number from github.context.issue.number if available.',
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
      head: Type.String({
        description:
          'Source branch containing the changes. MUST follow pattern: pi/issue{number}-{timestamp} where issue number is the GitHub issue number',
      }),
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

      const { title, body, base, head, dryRun } = params as {
        title: string;
        body?: string;
        base?: string;
        head: string;
        dryRun?: boolean;
      };

      console.info(`[create_pull_request] Title: ${title}`);
      console.info(`[create_pull_request] Head: ${head}`);
      console.info(`[create_pull_request] Base: ${base ?? 'default'}`);
      console.info(`[create_pull_request] DryRun: ${dryRun ?? false}`);

      // Validate branch name format
      if (!BRANCH_NAME_PATTERN.test(head)) {
        const issueNumber = github.context.issue?.number ?? 'unknown';
        const timestamp = Date.now();
        const correctFormat = `pi/issue${issueNumber}-${timestamp}`;
        const errorMsg = `Invalid branch name: "${head}". Pattern must be pi/issue{number}-{timestamp}. Correct format: ${correctFormat}`;
        console.info(`[create_pull_request] ERROR: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Determine base branch
      const baseBranch = base ?? github.context.payload.repository?.default_branch ?? 'main';

      console.info(`[create_pull_request] Resolved base branch: ${baseBranch}`);

      // Generate default body if not provided
      let bodyText = body ?? '';
      if (!bodyText && github.context.issue?.number) {
        const eventType = github.context.eventName;
        const issueNumber = github.context.issue.number;
        if (eventType === 'issue_comment' || eventType === 'issues') {
          bodyText = `Fixes #${issueNumber}\n\nCreated by pi coding agent.`;
        } else if (eventType === 'pull_request') {
          bodyText = `Related to #${issueNumber}\n\nCreated by pi coding agent.`;
        }
        console.info(`[create_pull_request] Auto-generated body from issue #${issueNumber}`);
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

      // Create the actual pull request
      console.info(`[create_pull_request] Calling GitHub API to create PR...`);

      try {
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

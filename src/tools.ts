import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { Type } from '@mariozechner/pi-ai';
import { octokit } from './github';
import * as github from '@actions/github';
import * as core from '@actions/core';

interface CreatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  dryRun: boolean;
}

const BRANCH_NAME_PATTERN = /^pi\/issue\d+-\d+$/;
const DEFAULT_BASE_BRANCH = 'main';

export const extFactory = (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: 'create_pull_request',
    label: 'Create Pull Request',
    description:
      'Create a new pull request on GitHub to propose changes. Branch names must follow the pattern: pi/issue{number}-{timestamp}',
    promptSnippet:
      'Create a new pull request with the given title, description, and branch name (must match pi/issue{number}-{timestamp} pattern)',
    parameters: Type.Object({
      title: Type.String({ description: 'Pull request title' }),
      body: Type.Optional(
        Type.String({
          description:
            'Detailed description of the changes (markdown supported). If not provided, will auto-generate from issue context if available',
        })
      ),
      base: Type.Optional(
        Type.String({
          description:
            'Target branch to merge into (defaults to repository default branch, usually "main" or "master")',
        })
      ),
      head: Type.String({
        description:
          'Source branch containing the changes. Must follow pattern: pi/issue{number}-{timestamp}',
      }),
      dryRun: Type.Optional(
        Type.Boolean({
          description: 'If true, simulate PR creation without actually creating it (for testing)',
        })
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      // Check for cancellation
      if (signal?.aborted) {
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

      if (!BRANCH_NAME_PATTERN.test(head)) {
        throw new Error(
          `Invalid branch name format: "${head}". Must follow pattern: pi/issue{number}-{timestamp} (e.g., pi/issue14-1740322625000)`
        );
      }

      const baseBranch =
        base ?? github.context.payload.repository?.default_branch ?? DEFAULT_BASE_BRANCH;

      // Generate default body if not provided
      let bodyText = body ?? '';
      if (!bodyText && github.context.issue?.number) {
        const eventType = github.context.eventName;
        if (eventType === 'issue_comment' || eventType === 'issues') {
          bodyText = `Fixes #${github.context.issue.number}\n\nCreated by Pi coding agent.`;
        } else if (eventType === 'pull_request') {
          bodyText = `Related to #${github.context.issue.number}\n\nCreated by Pi coding agent.`;
        }
      }

      // Dry run mode
      if (dryRun) {
        core.info(`[DRY RUN] Would create PR with:`);
        core.info(`  Title: ${title}`);
        core.info(`  Body: ${bodyText || '(empty)'}`);
        core.info(`  Base: ${baseBranch}`);
        core.info(`  Head: ${head}`);

        return {
          content: [
            {
              type: 'text',
              text: `[DRY RUN] Would create pull request:\n- Title: ${title}\n- Body: ${bodyText || '(empty)'}\n- Base: ${baseBranch}\n- Head: ${head}`,
            },
          ],
          details: {
            pullRequestNumber: 0,
            pullRequestUrl: '',
            headBranch: head,
            baseBranch: baseBranch,
            dryRun: true,
          },
        };
      }

      try {
        const result = await octokit.rest.pulls.create({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          title,
          body: bodyText,
          base: baseBranch,
          head,
        });

        const details: CreatePullRequestDetails = {
          pullRequestNumber: result.data.number,
          pullRequestUrl: result.data.html_url,
          headBranch: result.data.head.ref,
          baseBranch: result.data.base.ref,
          dryRun: false,
        };

        core.info(`Created PR #${result.data.number}: ${result.data.html_url}`);

        return {
          content: [
            {
              type: 'text',
              text: `Pull request #${result.data.number} created: ${result.data.html_url}`,
            },
          ],
          details,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create pull request: ${message}`);
      }
    },
  });
};

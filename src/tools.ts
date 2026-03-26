import { Type } from '@mariozechner/pi-ai';
import { createPullRequest } from './github';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { CreatePullRequestParams } from './github';

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
      console.info('\n=== create_pull_request tool called ===');

      // Check for cancellation
      if (signal?.aborted) {
        console.info('[create_pull_request] Tool execution cancelled');
        return {
          content: [{ type: 'text' as const, text: 'Pull request creation was cancelled' }],
          details: {},
        };
      }

      const { title, body, base, dryRun } = params as CreatePullRequestParams;

      // Delegate to the GitHub-specific implementation
      const prParams: CreatePullRequestParams = { title };
      if (body !== undefined) {
        prParams.body = body;
      }
      if (base !== undefined) {
        prParams.base = base;
      }
      if (dryRun !== undefined) {
        prParams.dryRun = dryRun;
      }

      return await createPullRequest(prParams);
    },
  });

  console.info('[create_pull_request] Tool registered successfully');
};

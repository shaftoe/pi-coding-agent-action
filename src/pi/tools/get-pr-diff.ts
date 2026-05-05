/**
 * @file get_pr_diff tool definition.
 */

import { Type, Static } from 'typebox';
import { defineTool } from '@mariozechner/pi-coding-agent';
import {
  GET_PR_DIFF_PROMPT_SNIPPET,
  GET_PR_DIFF_PROMPT_GUIDELINES,
  GET_PR_DIFF_DESCRIPTION,
  GET_PR_DIFF_PARAM_OWNER_DESCRIPTION,
  GET_PR_DIFF_PARAM_REPO_DESCRIPTION,
  GET_PR_DIFF_PARAM_PULL_NUMBER_DESCRIPTION,
  GET_PR_DIFF_PARAM_MAX_LINES_DESCRIPTION,
  GET_PR_DIFF_PARAM_IGNORE_FILES_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_GET_PR_DIFF } from './constants';
import { withCancellation } from './tool-execution';
import type { PlatformProvider } from '../../platform';

/**
 * Schema for the get_pr_diff tool.
 */
const getPRDiffSchema = Type.Object({
  owner: Type.Optional(
    Type.String({
      description: GET_PR_DIFF_PARAM_OWNER_DESCRIPTION,
    })
  ),
  repo: Type.Optional(
    Type.String({
      description: GET_PR_DIFF_PARAM_REPO_DESCRIPTION,
    })
  ),
  pull_number: Type.Optional(
    Type.Integer({
      description: GET_PR_DIFF_PARAM_PULL_NUMBER_DESCRIPTION,
    })
  ),
  max_lines: Type.Optional(
    Type.Integer({
      description: GET_PR_DIFF_PARAM_MAX_LINES_DESCRIPTION,
    })
  ),
  ignore_files: Type.Optional(
    Type.Array(
      Type.String({
        description: GET_PR_DIFF_PARAM_IGNORE_FILES_DESCRIPTION,
      }),
      {
        description: GET_PR_DIFF_PARAM_IGNORE_FILES_DESCRIPTION,
      }
    )
  ),
});

type GetPRDiffToolParams = Static<typeof getPRDiffSchema>;

interface GetPRDiffDetails {
  pull_number: number;
  lines: number;
  truncated: boolean;
  ignored_files?: string[];
  cancelled?: boolean;
}

/**
 * Resolve the owner, repo, and pull number from params or platform context.
 */
function resolvePRParams(
  params: GetPRDiffToolParams,
  provider: PlatformProvider
): { owner: string; repo: string; pullNumber: number } | undefined {
  const ctx = provider.getContext();

  const owner = params.owner ?? ctx.repo.owner;
  const repo = params.repo ?? ctx.repo.repo;
  const pullNumber = params.pull_number ?? ctx.issue.number;

  if (!owner || !repo || !pullNumber) {
    return undefined;
  }

  return { owner, repo, pullNumber };
}

/**
 * Create the get_pr_diff tool definition bound to a platform provider.
 *
 * @param provider - The platform provider for PR diff operations.
 * @returns The tool definition.
 */
export function getPRDiffToolFactory(provider: PlatformProvider) {
  return defineTool({
    name: 'get_pr_diff',
    label: 'Get PR Diff',
    description: GET_PR_DIFF_DESCRIPTION,
    promptSnippet: GET_PR_DIFF_PROMPT_SNIPPET,
    promptGuidelines: GET_PR_DIFF_PROMPT_GUIDELINES,
    parameters: getPRDiffSchema,
    execute: withCancellation<GetPRDiffToolParams, GetPRDiffDetails, GetPRDiffToolParams>({
      cancellationMessage: CANCELLATION_MESSAGE_GET_PR_DIFF,
      cancellationDetails: {
        pull_number: 0,
        lines: 0,
        truncated: false,
      },
      prepareParams: params => params,
      execute: async params => {
        const resolved = resolvePRParams(params, provider);

        if (!resolved) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Could not resolve PR: owner, repo, or pull_number missing and no PR context available.',
              },
            ],
            details: {
              pull_number: 0,
              lines: 0,
              truncated: false,
            } satisfies GetPRDiffDetails,
          };
        }

        const { owner, repo, pullNumber } = resolved;
        const ignoreFiles = params.ignore_files;

        const diff = await provider.getPRDiff(owner, repo, pullNumber, ignoreFiles);

        if (!diff) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No diff available for PR #${pullNumber}. This may not be a pull request, or the diff could not be fetched.`,
              },
            ],
            details: {
              pull_number: pullNumber,
              lines: 0,
              truncated: false,
            } satisfies GetPRDiffDetails,
          };
        }

        const lines = diff.split('\n').length;
        const maxLines = params.max_lines;
        let finalDiff = diff;
        let truncated = false;

        if (maxLines && lines > maxLines) {
          finalDiff =
            diff.split('\n').slice(0, maxLines).join('\n') +
            `\n... (truncated at ${maxLines} lines, ${lines - maxLines} more)`;
          truncated = true;
        }

        const details: GetPRDiffDetails = {
          pull_number: pullNumber,
          lines: Math.min(lines, maxLines ?? lines),
          truncated,
        };
        if (ignoreFiles && ignoreFiles.length > 0) {
          details.ignored_files = ignoreFiles;
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `PR #${pullNumber} Diff:\n\`\`\`diff\n${finalDiff}\n\`\`\``,
            },
          ],
          details: details satisfies GetPRDiffDetails,
        };
      },
    }),
  });
}

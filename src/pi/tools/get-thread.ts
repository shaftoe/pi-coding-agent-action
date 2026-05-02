/**
 * @file get_issue_or_pr_thread tool definition.
 */

import { Type, Static } from 'typebox';
import { defineTool } from '@mariozechner/pi-coding-agent';
import {
  GET_ISSUE_PR_THREAD_PROMPT_SNIPPET,
  GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES,
  GET_ISSUE_PR_THREAD_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_OWNER_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_REPO_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_ISSUE_NUMBER_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_MAX_COMMENTS_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_GET_THREAD } from './constants';
import { formatThreadAsText } from './common';
import type { IssueOrPRThread, GetIssueOrPRThreadParams, PlatformProvider } from '../../platform';
import type { AgentToolResult } from '@mariozechner/pi-coding-agent';
import { withCancellation } from './tool-execution';

/**
 * Schema for the get_issue_or_pr_thread tool.
 */
const getIssueOrPRThreadSchema = Type.Object({
  owner: Type.Optional(
    Type.String({
      description: GET_ISSUE_PR_THREAD_PARAM_OWNER_DESCRIPTION,
    })
  ),
  repo: Type.Optional(
    Type.String({
      description: GET_ISSUE_PR_THREAD_PARAM_REPO_DESCRIPTION,
    })
  ),
  issue_number: Type.Optional(
    Type.Integer({
      description: GET_ISSUE_PR_THREAD_PARAM_ISSUE_NUMBER_DESCRIPTION,
    })
  ),
  max_comments: Type.Optional(
    Type.Integer({
      description: GET_ISSUE_PR_THREAD_PARAM_MAX_COMMENTS_DESCRIPTION,
    })
  ),
});

type GetIssueOrPRThreadToolParams = Static<typeof getIssueOrPRThreadSchema>;

/**
 * Create a not-found result for when an issue or PR is not found.
 */
function createNotFoundResult(): AgentToolResult<IssueOrPRThread> {
  return {
    content: [{ type: 'text' as const, text: 'Issue or pull request not found' }],
    details: {
      number: 0,
      title: 'Not Found',
      body: 'Issue or pull request not found',
      state: 'closed',
      author: 'unknown',
      author_type: 'user',
      created_at: undefined,
      updated_at: undefined,
      closed_at: undefined,
      merged_at: undefined,
      labels: [],
      is_pull_request: false,
      head_branch: undefined,
      base_branch: undefined,
      head_sha: undefined,
      comments: [],
      review_comments: [],
    },
  };
}

/**
 * Create the get_issue_or_pr_thread tool definition bound to a platform provider.
 *
 * @param provider - The platform provider for thread retrieval operations.
 * @returns The tool definition.
 */
export function getIssueOrPRThreadToolFactory(provider: PlatformProvider) {
  return defineTool({
    name: 'get_issue_or_pr_thread',
    label: 'Get Issue/PR Thread',
    description: GET_ISSUE_PR_THREAD_DESCRIPTION,
    promptSnippet: GET_ISSUE_PR_THREAD_PROMPT_SNIPPET,
    promptGuidelines: GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES,
    parameters: getIssueOrPRThreadSchema,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_GET_THREAD,
      cancellationDetails: {
        number: 0,
        title: 'Cancelled',
        body: CANCELLATION_MESSAGE_GET_THREAD,
        state: 'closed',
        author: 'unknown',
        author_type: 'user',
        created_at: undefined,
        updated_at: undefined,
        closed_at: undefined,
        merged_at: undefined,
        labels: [],
        is_pull_request: false,
        head_branch: undefined,
        base_branch: undefined,
        head_sha: undefined,
        comments: [],
        review_comments: [],
      },
      prepareParams: (params: GetIssueOrPRThreadToolParams) => params,
      execute: async (params: GetIssueOrPRThreadParams) => {
        const result = await provider.getIssueOrPRThread(params);

        if (!result) {
          return createNotFoundResult();
        }

        const threadSummary = formatThreadAsText(result);

        return {
          content: [{ type: 'text' as const, text: threadSummary }],
          details: result,
        };
      },
    }),
  });
}

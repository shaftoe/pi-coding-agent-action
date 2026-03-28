/**
 * @file get_issue_or_pr_thread tool definition.
 */

import { Type, Static } from '@sinclair/typebox';
import {
  GET_ISSUE_PR_THREAD_PROMPT_SNIPPET,
  GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES,
  GET_ISSUE_PR_THREAD_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_OWNER_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_REPO_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_ISSUE_NUMBER_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PARAM_MAX_COMMENTS_DESCRIPTION,
} from '../prompt';
import { formatThreadAsText } from './common';
import { getIssueOrPRThread, CANCELLATION_MESSAGE_GET_THREAD } from '../../github/index';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';

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

/**
 * Runtime type for the get_issue_or_pr_thread tool parameters.
 */
type GetIssueOrPRThreadToolParams = Static<typeof getIssueOrPRThreadSchema>;

/**
 * Tool definition for fetching issue or PR thread.
 */
export const getIssueOrPRThreadTool: ToolDefinition = {
  name: 'get_issue_or_pr_thread',
  label: 'Get Issue/PR Thread',
  description: GET_ISSUE_PR_THREAD_DESCRIPTION,
  promptSnippet: GET_ISSUE_PR_THREAD_PROMPT_SNIPPET,
  promptGuidelines: GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES,
  // @ts-expect-error - TypeBox Symbol property not recognized by TypeScript
  parameters: getIssueOrPRThreadSchema,

  async execute(_toolCallId, params, signal, _onUpdate, _ctx): Promise<AgentToolResult<unknown>> {
    // Check for cancellation
    if (signal?.aborted) {
      return {
        content: [{ type: 'text' as const, text: CANCELLATION_MESSAGE_GET_THREAD }],
        details: {
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
          cancelled: true,
        },
      };
    }

    const result = await getIssueOrPRThread(params as GetIssueOrPRThreadToolParams);

    if (!result) {
      return {
        content: [{ type: 'text' as const, text: 'Issue or pull request not found' }],
        details: {
          number: 0,
          title: 'Not Found',
          body: null,
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
        },
      };
    }

    const threadSummary = formatThreadAsText(result);

    return {
      content: [{ type: 'text' as const, text: threadSummary }],
      details: result,
    };
  },
};

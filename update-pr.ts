/**
 * @file update_pull_request tool definition.
 */

import { Type, Static } from '@sinclair/typebox';
import {
  UPDATE_PULL_REQUEST_PROMPT_SNIPPET,
  UPDATE_PULL_REQUEST_PROMPT_GUIDELINES,
  UPDATE_PULL_REQUEST_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_PULL_NUMBER_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_MESSAGE_DESCRIPTION,
  UPDATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
} from '../prompt';
import { updatePullRequest, CANCELLATION_MESSAGE_UPDATE_PR } from '../../github/index';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';
import type { UpdatePullRequestParams, UpdatePullRequestDetails } from '../../github/index';

/**
 * Schema for the update_pull_request tool.
 */
const updatePullRequestSchema = Type.Object({
  pull_number: Type.Optional(
    Type.Integer({
      description: UPDATE_PULL_REQUEST_PARAM_PULL_NUMBER_DESCRIPTION,
    })
  ),
  title: Type.Optional(
    Type.String({
      description: UPDATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
    })
  ),
  body: Type.Optional(
    Type.String({
      description: UPDATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
    })
  ),
  message: Type.Optional(
    Type.String({
      description: UPDATE_PULL_REQUEST_PARAM_MESSAGE_DESCRIPTION,
    })
  ),
  dryRun: Type.Optional(
    Type.Boolean({
      description: UPDATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
    })
  ),
});

/**
 * Runtime type for the update_pull_request tool parameters.
 */
type UpdatePullRequestToolParams = Static<typeof updatePullRequestSchema>;

/**
 * Tool definition for updating a pull request.
 */
export const updatePullRequestTool: ToolDefinition = {
  name: 'update_pull_request',
  label: 'Update Pull Request',
  description: UPDATE_PULL_REQUEST_DESCRIPTION,
  promptSnippet: UPDATE_PULL_REQUEST_PROMPT_SNIPPET,
  promptGuidelines: UPDATE_PULL_REQUEST_PROMPT_GUIDELINES,
  // @ts-expect-error - TypeBox Symbol property not recognized by TypeScript
  parameters: updatePullRequestSchema,

  async execute(
    _toolCallId,
    params,
    signal,
    _onUpdate,
    _ctx
  ): Promise<AgentToolResult<UpdatePullRequestDetails>> {
    // Check for cancellation
    if (signal?.aborted) {
      return {
        content: [{ type: 'text' as const, text: CANCELLATION_MESSAGE_UPDATE_PR }],
        details: {
          pullRequestNumber: 0,
          pullRequestUrl: '',
          headBranch: '',
          baseBranch: '',
          dryRun: false,
          cancelled: true,
        },
      };
    }

    const { pull_number, title, body, message, dryRun } = params as UpdatePullRequestToolParams;

    // Delegate to the GitHub-specific implementation
    const updateParams: UpdatePullRequestParams = {};
    if (pull_number !== undefined) {
      updateParams.pull_number = pull_number;
    }
    if (title !== undefined) {
      updateParams.title = title;
    }
    if (body !== undefined) {
      updateParams.body = body;
    }
    if (message !== undefined) {
      updateParams.message = message;
    }
    if (dryRun !== undefined) {
      updateParams.dryRun = dryRun;
    }

    return await updatePullRequest(updateParams);
  },
};

/**
 * @file create_pull_request tool definition.
 */

import { Type, Static } from '@sinclair/typebox';
import {
  CREATE_PULL_REQUEST_PROMPT_SNIPPET,
  CREATE_PULL_REQUEST_PROMPT_GUIDELINES,
  CREATE_PULL_REQUEST_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_BASE_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
} from '../prompt';
import { createPullRequest, CANCELLATION_MESSAGE_CREATE_PR } from '../../github/index';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';
import type { CreatePullRequestParams, CreatePullRequestDetails } from '../../github/index';

/**
 * Schema for the create_pull_request tool.
 */
const createPullRequestSchema = Type.Object({
  title: Type.String({
    description: CREATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
  }),
  body: Type.Optional(
    Type.String({
      description: CREATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
    })
  ),
  base: Type.Optional(
    Type.String({
      description: CREATE_PULL_REQUEST_PARAM_BASE_DESCRIPTION,
    })
  ),
  dryRun: Type.Optional(
    Type.Boolean({
      description: CREATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
    })
  ),
});

/**
 * Runtime type for the create_pull_request tool parameters.
 */
type CreatePullRequestToolParams = Static<typeof createPullRequestSchema>;

/**
 * Tool definition for creating a pull request.
 */
export const createPRTool: ToolDefinition = {
  name: 'create_pull_request',
  label: 'Create Pull Request',
  description: CREATE_PULL_REQUEST_DESCRIPTION,
  promptSnippet: CREATE_PULL_REQUEST_PROMPT_SNIPPET,
  promptGuidelines: CREATE_PULL_REQUEST_PROMPT_GUIDELINES,
  // @ts-expect-error - TypeBox Symbol property not recognized by TypeScript
  parameters: createPullRequestSchema,

  async execute(
    _toolCallId,
    params,
    signal,
    _onUpdate,
    _ctx
  ): Promise<AgentToolResult<CreatePullRequestDetails>> {
    // Check for cancellation
    if (signal?.aborted) {
      return {
        content: [{ type: 'text' as const, text: CANCELLATION_MESSAGE_CREATE_PR }],
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

    const { title, body, base, dryRun } = params as CreatePullRequestToolParams;

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
};

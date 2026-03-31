/**
 * @file create_pull_request tool definition.
 */

import { Type } from '@sinclair/typebox';
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
import type { CreatePullRequestParams } from '../../github/index';
import { buildTool } from './tool-builder';

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
 * Tool definition for creating a pull request.
 */
export const createPRTool = buildTool({
  name: 'create_pull_request',
  label: 'Create Pull Request',
  description: CREATE_PULL_REQUEST_DESCRIPTION,
  promptSnippet: CREATE_PULL_REQUEST_PROMPT_SNIPPET,
  promptGuidelines: CREATE_PULL_REQUEST_PROMPT_GUIDELINES,
  parameters: createPullRequestSchema,
  cancellationMessage: CANCELLATION_MESSAGE_CREATE_PR,
  cancellationDetails: {
    pullRequestNumber: 0,
    pullRequestUrl: '',
    headBranch: '',
    baseBranch: '',
    dryRun: false,
  },
  execute: async (params) => {
    const { title, body, base, dryRun } = params;

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

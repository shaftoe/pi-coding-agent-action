/**
 * @file create_pull_request tool definition.
 */

import { Type, Static } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  CREATE_PULL_REQUEST_PROMPT_SNIPPET,
  CREATE_PULL_REQUEST_PROMPT_GUIDELINES,
  CREATE_PULL_REQUEST_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_BASE_DESCRIPTION,
  CREATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_CREATE_PR } from './constants';
import type {
  CreatePullRequestParams,
  CreatePullRequestDetails,
  PlatformProvider,
} from '../../platform';
import { withCancellation } from './tool-execution';

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

type CreatePullRequestToolParams = Static<typeof createPullRequestSchema>;

/**
 * Create the create_pull_request tool definition bound to a platform provider.
 *
 * @param provider - The platform provider for PR creation operations.
 * @returns The tool definition.
 */
export function createPRToolFactory(provider: PlatformProvider) {
  return defineTool({
    name: 'create_pull_request',
    label: 'Create Pull Request',
    description: CREATE_PULL_REQUEST_DESCRIPTION,
    promptSnippet: CREATE_PULL_REQUEST_PROMPT_SNIPPET,
    promptGuidelines: CREATE_PULL_REQUEST_PROMPT_GUIDELINES,
    parameters: createPullRequestSchema,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_CREATE_PR,
      cancellationDetails: {
        pullRequestNumber: 0,
        pullRequestUrl: '',
        headBranch: '',
        baseBranch: '',
        dryRun: false,
      },
      prepareParams: (params: CreatePullRequestToolParams) => {
        const { title, body, base, dryRun } = params;
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
        return prParams;
      },
      execute: params =>
        provider.createPullRequest(params) as Promise<{
          content: { type: 'text'; text: string }[];
          details: CreatePullRequestDetails;
        }>,
    }),
  });
}

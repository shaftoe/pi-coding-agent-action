/**
 * @file update_pull_request tool definition.
 */

import { Type, Static } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
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
import { CANCELLATION_MESSAGE_UPDATE_PR } from './constants';
import type {
  UpdatePullRequestParams,
  UpdatePullRequestDetails,
  PlatformProvider,
} from '../../platform';
import { withCancellation } from './tool-execution';

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

type UpdatePullRequestToolParams = Static<typeof updatePullRequestSchema>;

/**
 * Create the update_pull_request tool definition bound to a platform provider.
 *
 * @param provider - The platform provider for PR update operations.
 * @returns The tool definition.
 */
export function updatePullRequestToolFactory(provider: PlatformProvider) {
  return defineTool({
    name: 'update_pull_request',
    label: 'Update Pull Request',
    description: UPDATE_PULL_REQUEST_DESCRIPTION,
    promptSnippet: UPDATE_PULL_REQUEST_PROMPT_SNIPPET,
    promptGuidelines: UPDATE_PULL_REQUEST_PROMPT_GUIDELINES,
    parameters: updatePullRequestSchema,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_UPDATE_PR,
      cancellationDetails: {
        pullRequestNumber: 0,
        pullRequestUrl: '',
        headBranch: '',
        baseBranch: '',
        dryRun: false,
      },
      prepareParams: (params: UpdatePullRequestToolParams) => {
        const { pull_number, title, body, message, dryRun } = params;
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
        return updateParams;
      },
      execute: params =>
        provider.updatePullRequest(params) as Promise<{
          content: { type: 'text'; text: string }[];
          details: UpdatePullRequestDetails;
        }>,
    }),
  });
}

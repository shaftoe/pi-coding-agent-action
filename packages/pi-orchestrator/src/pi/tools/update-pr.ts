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
import { nullable, STRICT_JSON_SCHEMA } from './schema';
import type {
  UpdatePullRequestParams,
  UpdatePullRequestDetails,
  PlatformProvider,
} from '../../platform';
import { withCancellation, isPresent } from './tool-execution';

/**
 * Schema for the update_pull_request tool.
 */
const updatePullRequestSchema = Type.Object(
  {
    pull_number: nullable(
      Type.Integer({
        description: UPDATE_PULL_REQUEST_PARAM_PULL_NUMBER_DESCRIPTION,
      })
    ),
    title: nullable(
      Type.String({
        description: UPDATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
      })
    ),
    body: nullable(
      Type.String({
        description: UPDATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
      })
    ),
    message: nullable(
      Type.String({
        description: UPDATE_PULL_REQUEST_PARAM_MESSAGE_DESCRIPTION,
      })
    ),
    dryRun: nullable(
      Type.Boolean({
        description: UPDATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
      })
    ),
  },
  { additionalProperties: false }
);

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
    promptGuidelines: UPDATE_PULL_REQUEST_PROMPT_GUIDELINES(provider.type),
    parameters: updatePullRequestSchema,
    constrainedSampling: STRICT_JSON_SCHEMA,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_UPDATE_PR,
      cancellationDetails: {
        pullRequestNumber: 0,
        pullRequestUrl: '',
        headBranch: '',
        baseBranch: '',
        dryRun: false,
      },
      // fallow-ignore-next-line complexity
      prepareParams: (params: UpdatePullRequestToolParams) => {
        const { pull_number, title, body, message, dryRun } = params;
        const updateParams: UpdatePullRequestParams = {};
        if (isPresent(pull_number)) {
          updateParams.pull_number = pull_number;
        }
        if (isPresent(title)) {
          updateParams.title = title;
        }
        if (isPresent(body)) {
          updateParams.body = body;
        }
        if (isPresent(message)) {
          updateParams.message = message;
        }
        if (isPresent(dryRun)) {
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

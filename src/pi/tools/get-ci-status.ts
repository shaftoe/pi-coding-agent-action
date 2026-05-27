/**
 * @file get_ci_status tool definition.
 *
 * Defines the Pi agent tool that checks the CI/CD status of check runs
 * and workflow runs for a pull request or commit ref.
 */

import { Type, Static } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  GET_CI_STATUS_PROMPT_SNIPPET,
  GET_CI_STATUS_PROMPT_GUIDELINES,
  GET_CI_STATUS_DESCRIPTION,
  GET_CI_STATUS_PARAM_OWNER_DESCRIPTION,
  GET_CI_STATUS_PARAM_REPO_DESCRIPTION,
  GET_CI_STATUS_PARAM_PULL_NUMBER_DESCRIPTION,
  GET_CI_STATUS_PARAM_REF_DESCRIPTION,
  GET_CI_STATUS_PARAM_STATUS_DESCRIPTION,
  GET_CI_STATUS_PARAM_CONCLUSION_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_GET_CI_STATUS } from './constants';
import { withCancellation } from './tool-execution';
import type {
  PlatformProvider,
  GetCIStatusParams,
  GetCIStatusDetails,
} from '../../platform';

/**
 * Schema for the get_ci_status tool.
 */
const getCIStatusSchema = Type.Object({
  owner: Type.Optional(
    Type.String({
      description: GET_CI_STATUS_PARAM_OWNER_DESCRIPTION,
    })
  ),
  repo: Type.Optional(
    Type.String({
      description: GET_CI_STATUS_PARAM_REPO_DESCRIPTION,
    })
  ),
  pull_number: Type.Optional(
    Type.Integer({
      description: GET_CI_STATUS_PARAM_PULL_NUMBER_DESCRIPTION,
    })
  ),
  ref: Type.Optional(
    Type.String({
      description: GET_CI_STATUS_PARAM_REF_DESCRIPTION,
    })
  ),
  status: Type.Optional(
    Type.String({
      description: GET_CI_STATUS_PARAM_STATUS_DESCRIPTION,
    })
  ),
  conclusion: Type.Optional(
    Type.String({
      description: GET_CI_STATUS_PARAM_CONCLUSION_DESCRIPTION,
    })
  ),
});

type GetCIStatusToolParams = Static<typeof getCIStatusSchema>;

/**
 * Create the get_ci_status tool definition bound to a platform provider.
 *
 * @param provider - The platform provider for CI status operations.
 * @returns The tool definition.
 */
export function getCIStatusToolFactory(provider: PlatformProvider) {
  return defineTool({
    name: 'get_ci_status',
    label: 'Get CI Status',
    description: GET_CI_STATUS_DESCRIPTION,
    promptSnippet: GET_CI_STATUS_PROMPT_SNIPPET,
    promptGuidelines: GET_CI_STATUS_PROMPT_GUIDELINES,
    parameters: getCIStatusSchema,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_GET_CI_STATUS,
      cancellationDetails: {
        ref: '',
        check_runs: [],
        workflow_runs: [],
      },
      prepareParams: (params: GetCIStatusToolParams): GetCIStatusParams => ({
        ...(params.owner !== undefined ? { owner: params.owner } : {}),
        ...(params.repo !== undefined ? { repo: params.repo } : {}),
        ...(params.pull_number !== undefined ? { pull_number: params.pull_number } : {}),
        ...(params.ref !== undefined ? { ref: params.ref } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.conclusion !== undefined ? { conclusion: params.conclusion } : {}),
      }),
      execute: async (params: GetCIStatusParams) =>
        provider.getCIStatus(params) as Promise<{
          content: { type: 'text'; text: string }[];
          details: GetCIStatusDetails;
        }>,
    }),
  });
}

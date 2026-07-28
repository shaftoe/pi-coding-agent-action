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
import { nullable, PREFER_STRICT_JSON_SCHEMA } from './schema';
import { withCancellation, isPresent } from './tool-execution';
import type { PlatformProvider, GetCIStatusParams, GetCIStatusDetails } from '../../platform';

/**
 * Schema for the get_ci_status tool.
 */
const getCIStatusSchema = Type.Object(
  {
    owner: nullable(
      Type.String({
        description: GET_CI_STATUS_PARAM_OWNER_DESCRIPTION,
      })
    ),
    repo: nullable(
      Type.String({
        description: GET_CI_STATUS_PARAM_REPO_DESCRIPTION,
      })
    ),
    pull_number: nullable(
      Type.Integer({
        description: GET_CI_STATUS_PARAM_PULL_NUMBER_DESCRIPTION,
      })
    ),
    ref: nullable(
      Type.String({
        description: GET_CI_STATUS_PARAM_REF_DESCRIPTION,
      })
    ),
    status: nullable(
      Type.String({
        description: GET_CI_STATUS_PARAM_STATUS_DESCRIPTION,
      })
    ),
    conclusion: nullable(
      Type.String({
        description: GET_CI_STATUS_PARAM_CONCLUSION_DESCRIPTION,
      })
    ),
  },
  { additionalProperties: false }
);

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
    promptGuidelines: GET_CI_STATUS_PROMPT_GUIDELINES(provider.type),
    parameters: getCIStatusSchema,
    constrainedSampling: PREFER_STRICT_JSON_SCHEMA,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_GET_CI_STATUS,
      cancellationDetails: {
        ref: '',
        check_runs: [],
        workflow_runs: [],
      },
      // fallow-ignore-next-line complexity
      prepareParams: (params: GetCIStatusToolParams): GetCIStatusParams => ({
        ...(isPresent(params.owner) ? { owner: params.owner } : {}),
        ...(isPresent(params.repo) ? { repo: params.repo } : {}),
        ...(isPresent(params.pull_number) ? { pull_number: params.pull_number } : {}),
        ...(isPresent(params.ref) ? { ref: params.ref } : {}),
        ...(isPresent(params.status) ? { status: params.status } : {}),
        ...(isPresent(params.conclusion) ? { conclusion: params.conclusion } : {}),
      }),
      execute: async (params: GetCIStatusParams) =>
        provider.getCIStatus(params) as Promise<{
          content: { type: 'text'; text: string }[];
          details: GetCIStatusDetails;
        }>,
    }),
  });
}

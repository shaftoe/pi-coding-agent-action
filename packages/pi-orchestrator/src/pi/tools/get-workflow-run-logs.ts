/**
 * @file get_workflow_run_logs tool definition.
 *
 * Defines the Pi agent tool that fetches job logs for a specific
 * workflow run to diagnose CI failures.
 */

import { Type, Static } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  GET_CI_STATUS_PARAM_OWNER_DESCRIPTION,
  GET_CI_STATUS_PARAM_REPO_DESCRIPTION,
  GET_WORKFLOW_RUN_LOGS_PROMPT_SNIPPET,
  GET_WORKFLOW_RUN_LOGS_PROMPT_GUIDELINES,
  GET_WORKFLOW_RUN_LOGS_DESCRIPTION,
  GET_WORKFLOW_RUN_LOGS_PARAM_RUN_ID_DESCRIPTION,
  GET_WORKFLOW_RUN_LOGS_PARAM_MAX_BYTES_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_GET_WORKFLOW_RUN_LOGS } from './constants';
import { nullable, STRICT_JSON_SCHEMA } from './schema';
import { withCancellation, isPresent } from './tool-execution';
import type {
  PlatformProvider,
  GetWorkflowRunLogsParams,
  GetWorkflowRunLogsDetails,
} from '../../platform';

/**
 * Schema for the get_workflow_run_logs tool.
 */
const getWorkflowRunLogsSchema = Type.Object(
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
    run_id: Type.Integer({
      description: GET_WORKFLOW_RUN_LOGS_PARAM_RUN_ID_DESCRIPTION,
    }),
    max_bytes: nullable(
      Type.Integer({
        description: GET_WORKFLOW_RUN_LOGS_PARAM_MAX_BYTES_DESCRIPTION,
      })
    ),
  },
  { additionalProperties: false }
);

type GetWorkflowRunLogsToolParams = Static<typeof getWorkflowRunLogsSchema>;

/**
 * Create the get_workflow_run_logs tool definition bound to a platform provider.
 *
 * @param provider - The platform provider for workflow run log operations.
 * @returns The tool definition.
 */
export function getWorkflowRunLogsToolFactory(provider: PlatformProvider) {
  return defineTool({
    name: 'get_workflow_run_logs',
    label: 'Get Workflow Run Logs',
    description: GET_WORKFLOW_RUN_LOGS_DESCRIPTION(provider.type),
    promptSnippet: GET_WORKFLOW_RUN_LOGS_PROMPT_SNIPPET,
    promptGuidelines: GET_WORKFLOW_RUN_LOGS_PROMPT_GUIDELINES,
    parameters: getWorkflowRunLogsSchema,
    constrainedSampling: STRICT_JSON_SCHEMA,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_GET_WORKFLOW_RUN_LOGS,
      cancellationDetails: {
        run_id: 0,
        jobs: [],
        total_bytes: 0,
        truncated: false,
      },
      prepareParams: (params: GetWorkflowRunLogsToolParams): GetWorkflowRunLogsParams => ({
        ...(isPresent(params.owner) ? { owner: params.owner } : {}),
        ...(isPresent(params.repo) ? { repo: params.repo } : {}),
        run_id: params.run_id,
        ...(isPresent(params.max_bytes) ? { max_bytes: params.max_bytes } : {}),
      }),
      execute: async (params: GetWorkflowRunLogsParams) =>
        provider.getWorkflowRunLogs(params) as Promise<{
          content: { type: 'text'; text: string }[];
          details: GetWorkflowRunLogsDetails;
        }>,
    }),
  });
}

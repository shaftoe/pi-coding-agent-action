/**
 * @file get_ci_status and get_workflow_run_logs tool definitions.
 *
 * Defines the Pi agent tools that enable CI/CD awareness:
 *
 * - **`get_ci_status`** – checks the status of check runs and workflow runs
 *   for a pull request or commit ref.
 * - **`get_workflow_run_logs`** – fetches job logs for a specific workflow
 *   run to diagnose CI failures.
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
  GET_WORKFLOW_RUN_LOGS_PROMPT_SNIPPET,
  GET_WORKFLOW_RUN_LOGS_PROMPT_GUIDELINES,
  GET_WORKFLOW_RUN_LOGS_DESCRIPTION,
  GET_WORKFLOW_RUN_LOGS_PARAM_RUN_ID_DESCRIPTION,
  GET_WORKFLOW_RUN_LOGS_PARAM_MAX_BYTES_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_GET_CI_STATUS, CANCELLATION_MESSAGE_GET_WORKFLOW_RUN_LOGS } from './constants';
import { withCancellation } from './tool-execution';
import type {
  PlatformProvider,
  GetCIStatusParams,
  GetCIStatusDetails,
  GetWorkflowRunLogsParams,
  GetWorkflowRunLogsDetails,
} from '../../platform';

// ─── get_ci_status ──────────────────────────────────────────────────

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

// ─── get_workflow_run_logs ──────────────────────────────────────────

/**
 * Schema for the get_workflow_run_logs tool.
 */
const getWorkflowRunLogsSchema = Type.Object({
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
  run_id: Type.Integer({
    description: GET_WORKFLOW_RUN_LOGS_PARAM_RUN_ID_DESCRIPTION,
  }),
  max_bytes: Type.Optional(
    Type.Integer({
      description: GET_WORKFLOW_RUN_LOGS_PARAM_MAX_BYTES_DESCRIPTION,
    })
  ),
});

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
    description: GET_WORKFLOW_RUN_LOGS_DESCRIPTION,
    promptSnippet: GET_WORKFLOW_RUN_LOGS_PROMPT_SNIPPET,
    promptGuidelines: GET_WORKFLOW_RUN_LOGS_PROMPT_GUIDELINES,
    parameters: getWorkflowRunLogsSchema,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_GET_WORKFLOW_RUN_LOGS,
      cancellationDetails: {
        run_id: 0,
        jobs: [],
        total_bytes: 0,
        truncated: false,
      },
      prepareParams: (params: GetWorkflowRunLogsToolParams): GetWorkflowRunLogsParams => ({
        ...(params.owner !== undefined ? { owner: params.owner } : {}),
        ...(params.repo !== undefined ? { repo: params.repo } : {}),
        run_id: params.run_id,
        ...(params.max_bytes !== undefined ? { max_bytes: params.max_bytes } : {}),
      }),
      execute: async (params: GetWorkflowRunLogsParams) =>
        provider.getWorkflowRunLogs(params) as Promise<{
          content: { type: 'text'; text: string }[];
          details: GetWorkflowRunLogsDetails;
        }>,
    }),
  });
}

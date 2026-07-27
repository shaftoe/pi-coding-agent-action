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
import { nullable, STRICT_JSON_SCHEMA } from './schema';
import type {
  CreatePullRequestParams,
  CreatePullRequestDetails,
  PlatformProvider,
} from '../../platform';
import { withCancellation, isPresent } from './tool-execution';

/**
 * Schema for the create_pull_request tool.
 */
const createPullRequestSchema = Type.Object(
  {
    title: Type.String({
      description: CREATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION,
    }),
    body: nullable(
      Type.String({
        description: CREATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION,
      })
    ),
    base: nullable(
      Type.String({
        description: CREATE_PULL_REQUEST_PARAM_BASE_DESCRIPTION,
      })
    ),
    dryRun: nullable(
      Type.Boolean({
        description: CREATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION,
      })
    ),
  },
  { additionalProperties: false }
);

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
    description: CREATE_PULL_REQUEST_DESCRIPTION(provider.type),
    promptSnippet: CREATE_PULL_REQUEST_PROMPT_SNIPPET,
    promptGuidelines: CREATE_PULL_REQUEST_PROMPT_GUIDELINES,
    parameters: createPullRequestSchema,
    constrainedSampling: STRICT_JSON_SCHEMA,
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
        if (isPresent(body)) {
          prParams.body = body;
        }
        if (isPresent(base)) {
          prParams.base = base;
        }
        if (isPresent(dryRun)) {
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

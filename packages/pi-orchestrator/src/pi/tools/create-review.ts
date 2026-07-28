/**
 * @file create_pull_request_review tool definition.
 *
 * Defines the Pi agent tool that creates a pull request review with
 * inline comments anchored to specific lines of the diff.
 */

import { Type, Static } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  CREATE_REVIEW_PROMPT_SNIPPET,
  CREATE_REVIEW_PROMPT_GUIDELINES,
  CREATE_REVIEW_DESCRIPTION,
  CREATE_REVIEW_PARAM_PULL_NUMBER_DESCRIPTION,
  CREATE_REVIEW_PARAM_BODY_DESCRIPTION,
  CREATE_REVIEW_PARAM_EVENT_DESCRIPTION,
  CREATE_REVIEW_PARAM_COMMENT_PATH_DESCRIPTION,
  CREATE_REVIEW_PARAM_COMMENT_LINE_DESCRIPTION,
  CREATE_REVIEW_PARAM_COMMENT_SIDE_DESCRIPTION,
  CREATE_REVIEW_PARAM_COMMENT_START_LINE_DESCRIPTION,
  CREATE_REVIEW_PARAM_COMMENT_START_SIDE_DESCRIPTION,
  CREATE_REVIEW_PARAM_COMMENT_BODY_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_CREATE_REVIEW } from './constants';
import { nullable, PREFER_STRICT_JSON_SCHEMA } from './schema';
import type { CreateReviewParams, CreateReviewDetails, PlatformProvider } from '../../platform';
import { withCancellation, isPresent } from './tool-execution';

/**
 * Schema for a single inline review comment.
 */
const reviewCommentSchema = Type.Object(
  {
    path: Type.String({
      description: CREATE_REVIEW_PARAM_COMMENT_PATH_DESCRIPTION,
    }),
    line: Type.Integer({
      description: CREATE_REVIEW_PARAM_COMMENT_LINE_DESCRIPTION,
    }),
    side: nullable(
      Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')], {
        description: CREATE_REVIEW_PARAM_COMMENT_SIDE_DESCRIPTION,
      })
    ),
    start_line: nullable(
      Type.Integer({
        description: CREATE_REVIEW_PARAM_COMMENT_START_LINE_DESCRIPTION,
      })
    ),
    start_side: nullable(
      Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')], {
        description: CREATE_REVIEW_PARAM_COMMENT_START_SIDE_DESCRIPTION,
      })
    ),
    body: Type.String({
      description: CREATE_REVIEW_PARAM_COMMENT_BODY_DESCRIPTION,
    }),
  },
  { additionalProperties: false }
);

/**
 * Schema for the create_pull_request_review tool.
 */
const createReviewSchema = Type.Object(
  {
    pull_number: nullable(
      Type.Integer({
        description: CREATE_REVIEW_PARAM_PULL_NUMBER_DESCRIPTION,
      })
    ),
    body: nullable(
      Type.String({
        description: CREATE_REVIEW_PARAM_BODY_DESCRIPTION,
      })
    ),
    event: nullable(
      Type.Union(
        [Type.Literal('COMMENT'), Type.Literal('APPROVE'), Type.Literal('REQUEST_CHANGES')],
        {
          description: CREATE_REVIEW_PARAM_EVENT_DESCRIPTION,
        }
      )
    ),
    comments: Type.Array(reviewCommentSchema, {
      description:
        'Array of inline comments anchored to diff lines. Each requires path, line, and body.',
    }),
  },
  { additionalProperties: false }
);

type CreateReviewToolParams = Static<typeof createReviewSchema>;

/**
 * Create the create_pull_request_review tool definition bound to a platform provider.
 *
 * @param provider - The platform provider for review creation operations.
 * @returns The tool definition.
 */
export function createReviewToolFactory(provider: PlatformProvider) {
  return defineTool({
    name: 'create_pull_request_review',
    label: 'Create Pull Request Review',
    description: CREATE_REVIEW_DESCRIPTION(provider.type),
    promptSnippet: CREATE_REVIEW_PROMPT_SNIPPET,
    promptGuidelines: CREATE_REVIEW_PROMPT_GUIDELINES,
    parameters: createReviewSchema,
    constrainedSampling: PREFER_STRICT_JSON_SCHEMA,
    execute: withCancellation({
      cancellationMessage: CANCELLATION_MESSAGE_CREATE_REVIEW,
      cancellationDetails: {
        reviewId: 0,
        reviewUrl: '',
        pullRequestNumber: 0,
        event: 'COMMENT',
        commentCount: 0,
      },
      prepareParams: (params: CreateReviewToolParams) => {
        const reviewParams: CreateReviewParams = {
          comments: params.comments.map(c => ({
            path: c.path,
            line: c.line,
            body: c.body,
            ...(isPresent(c.side) ? { side: c.side } : {}),
            ...(isPresent(c.start_line) ? { start_line: c.start_line } : {}),
            ...(isPresent(c.start_side) ? { start_side: c.start_side } : {}),
          })),
        };
        if (isPresent(params.pull_number)) {
          reviewParams.pull_number = params.pull_number;
        }
        if (isPresent(params.body)) {
          reviewParams.body = params.body;
        }
        if (isPresent(params.event)) {
          reviewParams.event = params.event;
        }
        return reviewParams;
      },
      execute: params =>
        provider.createReview(params) as Promise<{
          content: { type: 'text'; text: string }[];
          details: CreateReviewDetails;
        }>,
    }),
  });
}

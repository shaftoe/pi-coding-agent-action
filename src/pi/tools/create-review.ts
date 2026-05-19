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
import type {
  CreateReviewParams,
  CreateReviewDetails,
  PlatformProvider,
} from '../../platform';
import { withCancellation } from './tool-execution';

/**
 * Schema for a single inline review comment.
 */
const reviewCommentSchema = Type.Object({
  path: Type.String({
    description: CREATE_REVIEW_PARAM_COMMENT_PATH_DESCRIPTION,
  }),
  line: Type.Integer({
    description: CREATE_REVIEW_PARAM_COMMENT_LINE_DESCRIPTION,
  }),
  side: Type.Optional(
    Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')], {
      description: CREATE_REVIEW_PARAM_COMMENT_SIDE_DESCRIPTION,
    })
  ),
  start_line: Type.Optional(
    Type.Integer({
      description: CREATE_REVIEW_PARAM_COMMENT_START_LINE_DESCRIPTION,
    })
  ),
  start_side: Type.Optional(
    Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')], {
      description: CREATE_REVIEW_PARAM_COMMENT_START_SIDE_DESCRIPTION,
    })
  ),
  body: Type.String({
    description: CREATE_REVIEW_PARAM_COMMENT_BODY_DESCRIPTION,
  }),
});

/**
 * Schema for the create_pull_request_review tool.
 */
const createReviewSchema = Type.Object({
  pull_number: Type.Optional(
    Type.Integer({
      description: CREATE_REVIEW_PARAM_PULL_NUMBER_DESCRIPTION,
    })
  ),
  body: Type.Optional(
    Type.String({
      description: CREATE_REVIEW_PARAM_BODY_DESCRIPTION,
    })
  ),
  event: Type.Optional(
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
});

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
    description: CREATE_REVIEW_DESCRIPTION,
    promptSnippet: CREATE_REVIEW_PROMPT_SNIPPET,
    promptGuidelines: CREATE_REVIEW_PROMPT_GUIDELINES,
    parameters: createReviewSchema,
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
            ...(c.side !== undefined ? { side: c.side } : {}),
            ...(c.start_line !== undefined ? { start_line: c.start_line } : {}),
            ...(c.start_side !== undefined ? { start_side: c.start_side } : {}),
          })),
        };
        if (params.pull_number !== undefined) {
          reviewParams.pull_number = params.pull_number;
        }
        if (params.body !== undefined) {
          reviewParams.body = params.body;
        }
        if (params.event !== undefined) {
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

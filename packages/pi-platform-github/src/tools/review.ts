/**
 * @file Pull request review creation with inline diff-anchored comments.
 *
 * Implements the server-side logic for the `create_pull_request_review` custom
 * tool: creates a GitHub Pull Request Review with optional inline comments
 * anchored to specific lines of the diff. Uses the modern `line`/`side`
 * positioning (not the deprecated `position` field).
 */

import type {
  GitHubModuleDeps,
  CreateReviewParams,
  CreateReviewDetails,
  ReviewInlineComment,
} from '../types';

export type { CreateReviewParams, CreateReviewDetails, ReviewInlineComment };

/**
 * Validate review parameters before making API calls.
 *
 * @param params - The review parameters to validate.
 * @throws {Error} If validation fails.
 * @internal Exported for testing purposes.
 */
export function validateCreateReviewParams(params: CreateReviewParams): void {
  if (!params.comments || params.comments.length === 0) {
    throw new Error('At least one inline comment is required to create a review');
  }

  for (const [i, c] of params.comments.entries()) {
    if (!c.path || c.path.trim() === '') {
      throw new Error(`Comment at index ${i}: "path" is required and cannot be empty`);
    }
    if (!c.body || c.body.trim() === '') {
      throw new Error(`Comment at index ${i}: "body" is required and cannot be empty`);
    }
    if (typeof c.line !== 'number' || !Number.isInteger(c.line) || c.line < 1) {
      throw new Error(`Comment at index ${i}: "line" must be a positive integer`);
    }
    if (c.start_line !== undefined) {
      if (!Number.isInteger(c.start_line) || c.start_line < 1) {
        throw new Error(`Comment at index ${i}: "start_line" must be a positive integer`);
      }
      if (c.start_line > c.line) {
        throw new Error(
          `Comment at index ${i}: "start_line" (${c.start_line}) must be <= "line" (${c.line})`
        );
      }
    }
  }

  if (params.event && !['COMMENT', 'APPROVE', 'REQUEST_CHANGES'].includes(params.event)) {
    throw new Error(
      `Invalid event "${params.event}". Must be one of: COMMENT, APPROVE, REQUEST_CHANGES`
    );
  }
}

/**
 * Transform a {@link ReviewInlineComment} into the shape expected by the
 * GitHub REST API `pulls.createReview`.
 *
 * @param comment - The platform-agnostic inline comment.
 * @returns The GitHub API comment object.
 */
export function toGitHubComment(comment: ReviewInlineComment): Record<string, unknown> {
  const ghComment: Record<string, unknown> = {
    path: comment.path,
    line: comment.line,
    side: comment.side ?? 'RIGHT',
    body: comment.body,
  };

  if (comment.start_line !== undefined) {
    ghComment.start_line = comment.start_line;
    ghComment.start_side = comment.start_side ?? comment.side ?? 'RIGHT';
  }

  return ghComment;
}

/**
 * Create a pull request review with inline comments.
 *
 * Uses `octokit.rest.pulls.createReview()` with the modern `line`/`side`
 * positioning for each comment.
 *
 * @param deps - Module dependencies.
 * @param params - Parameters for the review.
 * @returns Structured details about the created review.
 * @throws {Error} If the PR number cannot be resolved, validation fails,
 *                 or the GitHub API call fails.
 */
export async function createReview(
  deps: GitHubModuleDeps,
  params: CreateReviewParams
): Promise<{ content: { type: 'text'; text: string }[]; details: CreateReviewDetails }> {
  validateCreateReviewParams(params);

  const resolvedPullNumber = params.pull_number ?? deps.context.issue.number;
  if (!resolvedPullNumber) {
    throw new Error(
      'Pull request number not provided and not available in context. ' +
        'Please provide pull_number parameter or run this action in the context of a pull request.'
    );
  }

  const owner = deps.context.repo.owner;
  const repo = deps.context.repo.repo;
  const event = params.event ?? 'COMMENT';
  const body = params.body ?? '';

  deps.logger.debug(
    `Creating review on PR #${resolvedPullNumber} with ${params.comments.length} comment(s), event=${event}`
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Octokit's comment type is complex; our mapping produces the correct shape
  const reviewComments = params.comments.map(toGitHubComment) as any;
  const response = await deps.octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: resolvedPullNumber,
    body,
    event,
    comments: reviewComments,
  });

  const reviewId = response.data.id;
  const reviewUrl = response.data.html_url;
  const commentCount = params.comments.length;

  const successMessage = [
    `Review created on PR #${resolvedPullNumber}: ${reviewUrl}`,
    `- Event: ${event}`,
    `- Inline comments: ${commentCount}`,
  ].join('\n');

  deps.logger.debug(`SUCCESS: ${successMessage}`);

  return {
    content: [{ type: 'text' as const, text: successMessage }],
    details: {
      reviewId,
      reviewUrl,
      pullRequestNumber: resolvedPullNumber,
      event,
      commentCount,
    },
  };
}

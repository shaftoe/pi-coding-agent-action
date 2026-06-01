/**
 * @file GitHub reaction management (add / remove).
 *
 * Provides helpers to add an "eyes" reaction to the triggering comment while
 * the Pi agent is processing, and to remove it once the result (or error) has
 * been posted. This gives users immediate visual feedback that their request
 * was received.
 *
 * Supports both regular issue/PR comments and inline PR review comments.
 *
 * All functions accept a {@link GitHubModuleDeps} parameter for explicit
 * dependency injection — no module-level singletons or `@actions/*` imports.
 */

import RestEndpointMethodTypes from '@octokit/plugin-rest-endpoint-methods';
import { REACTION_TYPE_EYES } from './constants';
import type { GitHubModuleDeps } from './types';

export type CreateReactionType =
  | RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['createForIssueComment']['response']
  | RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['createForPullRequestReviewComment']['response'];

export type DeleteReactionType =
  | RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['deleteForIssueComment']['response']
  | RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['deleteForPullRequestComment']['response'];

/**
 * Check if the current comment is a pull request review comment (inline comment).
 *
 * PR review comments have a `pull_request_review_id` field in the payload.
 *
 * @param deps - Module dependencies.
 * @returns `true` if the comment is a PR review comment, `false` otherwise.
 */
function isPullRequestReviewComment(deps: GitHubModuleDeps): boolean {
  const comment = deps.context.payload.comment as
    | { pull_request_review_id?: number }
    | undefined;
  return comment?.pull_request_review_id !== undefined;
}

/**
 * Add an "eyes" (👀) reaction to the triggering comment to signal that the
 * agent has started processing.
 *
 * Handles both regular issue/PR comments and inline PR review comments.
 *
 * @param deps - Module dependencies.
 * @returns The Octokit reaction creation response, or `undefined` if no
 *          comment is present in the current context.
 */
export async function addReaction(
  deps: GitHubModuleDeps
): Promise<CreateReactionType | undefined> {
  const comment = deps.context.payload.comment as
    | { id?: number; pull_request_review_id?: number }
    | undefined;
  if (!comment || comment.id === undefined) {
    deps.logger.debug('[reactions] no comment found, skipping reaction');
    return;
  }

  const octokit = deps.octokit;
  const isPRReviewComment = isPullRequestReviewComment(deps);
  const { owner, repo } = deps.context.repo;

  if (isPRReviewComment) {
    deps.logger.debug('[reactions] adding reaction to PR review comment');
    return await octokit.rest.reactions.createForPullRequestReviewComment({
      owner,
      repo,
      comment_id: comment.id,
      content: REACTION_TYPE_EYES,
    });
  } else {
    deps.logger.debug('[reactions] adding reaction to issue comment');
    return await octokit.rest.reactions.createForIssueComment({
      owner,
      repo,
      comment_id: comment.id,
      content: REACTION_TYPE_EYES,
    });
  }
}

/**
 * Remove a previously added reaction from the triggering comment.
 *
 * Handles both regular issue/PR comments and inline PR review comments.
 *
 * @param deps - Module dependencies.
 * @param reaction - The reaction response returned by {@link addReaction}.
 * @returns The Octokit reaction deletion response, or `undefined` if the
 *          reaction or comment is not available.
 */
export async function deleteReaction(
  deps: GitHubModuleDeps,
  reaction: CreateReactionType | undefined
): Promise<DeleteReactionType | undefined> {
  if (!reaction) {
    return;
  }

  const comment = deps.context.payload.comment as
    | { id?: number; pull_request_review_id?: number }
    | undefined;
  if (!comment || comment.id === undefined) {
    return;
  }

  const octokit = deps.octokit;
  const isPRReviewComment = isPullRequestReviewComment(deps);
  const { owner, repo } = deps.context.repo;

  if (isPRReviewComment) {
    deps.logger.debug('[reactions] deleting reaction from PR review comment');
    return octokit.rest.reactions.deleteForPullRequestComment({
      owner,
      repo,
      comment_id: comment.id,
      reaction_id: reaction.data.id,
    });
  } else {
    deps.logger.debug('[reactions] deleting reaction from issue comment');
    return octokit.rest.reactions.deleteForIssueComment({
      owner,
      repo,
      comment_id: comment.id,
      reaction_id: reaction.data.id,
    });
  }
}

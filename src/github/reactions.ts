/**
 * @file GitHub reaction management (add / remove).
 *
 * Provides helpers to add an "eyes" reaction to the triggering comment while
 * the Pi agent is processing, and to remove it once the result (or error) has
 * been posted. This gives users immediate visual feedback that their request
 * was received.
 *
 * Supports both regular issue/PR comments and inline PR review comments.
 */

import * as github from '@actions/github';
import RestEndpointMethodTypes from '@octokit/plugin-rest-endpoint-methods';
import { getOctokit } from './octokit';
import { REACTION_TYPE_EYES } from './constants';
import { getCoreAdapter } from './index';

export type CreateReactionType =
  | RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['createForIssueComment']['response']
  | RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['createForPullRequestReviewComment']['response'];

export type DeleteReactionType =
  | RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['deleteForIssueComment']['response']
  | RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['deleteForPullRequestComment']['response'];

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  getCoreAdapter().debug(msg);
}

/**
 * Check if the current comment is a pull request review comment (inline comment).
 *
 * PR review comments have a `pull_request_review_id` field in the payload.
 *
 * @returns `true` if the comment is a PR review comment, `false` otherwise.
 */
function isPullRequestReviewComment(): boolean {
  const comment = github.context.payload.comment;
  return comment?.pull_request_review_id !== undefined;
}

/**
 * Add an "eyes" (👀) reaction to the triggering comment to signal that the
 * agent has started processing.
 *
 * Handles both regular issue/PR comments and inline PR review comments.
 *
 * @returns The Octokit reaction creation response, or `undefined` if no
 *          comment is present in the current context.
 */
export async function addReaction(): Promise<CreateReactionType | undefined> {
  const comment = github.context.payload.comment;
  if (!comment) {
    debug('[reactions] no comment found, skipping reaction');
    return;
  }

  const octokit = getOctokit();
  const isPRReviewComment = isPullRequestReviewComment();

  if (isPRReviewComment) {
    debug('[reactions] adding reaction to PR review comment');
    return await octokit.rest.reactions.createForPullRequestReviewComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: comment.id,
      content: REACTION_TYPE_EYES,
    });
  } else {
    debug('[reactions] adding reaction to issue comment');
    return await octokit.rest.reactions.createForIssueComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
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
 * @param reaction - The reaction response returned by {@link addReaction}.
 * @returns The Octokit reaction deletion response, or `undefined` if the
 *          reaction or comment is not available.
 */
export async function deleteReaction(
  reaction: CreateReactionType | undefined
): Promise<DeleteReactionType | undefined> {
  if (!reaction) {
    return;
  }

  const comment = github.context.payload.comment;
  if (!comment) {
    return;
  }

  const octokit = getOctokit();
  const isPRReviewComment = isPullRequestReviewComment();

  if (isPRReviewComment) {
    debug('[reactions] deleting reaction from PR review comment');
    return octokit.rest.reactions.deleteForPullRequestComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: comment.id,
      reaction_id: reaction.data.id,
    });
  } else {
    debug('[reactions] deleting reaction from issue comment');
    return octokit.rest.reactions.deleteForIssueComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: comment.id,
      reaction_id: reaction.data.id,
    });
  }
}

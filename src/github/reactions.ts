/**
 * @file GitHub reaction management (add / remove).
 *
 * Provides helpers to add an "eyes" reaction to the triggering comment while
 * the Pi agent is processing, and to remove it once the result (or error) has
 * been posted. This gives users immediate visual feedback that their request
 * was received.
 */

import * as github from '@actions/github';
import RestEndpointMethodTypes from '@octokit/plugin-rest-endpoint-methods';
import { getOctokit } from './octokit';
import { REACTION_TYPE_EYES } from './constants';
import { getCoreAdapter } from './index';

/**
 * Check if the current event is a pull request review comment.
 *
 * PR review comments (inline code comments) use a different event name and
 * different API endpoints for reactions compared to regular issue comments.
 */
function isReviewComment(): boolean {
  return github.context.eventName === 'pull_request_review_comment';
}

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
 * Add an "eyes" (👀) reaction to the triggering comment to signal that the
 * agent has started processing.
 *
 * Uses the appropriate API endpoint based on whether the comment is a regular
 * issue comment or a pull request review comment (inline code comment).
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
  const params = {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: comment.id,
    content: REACTION_TYPE_EYES,
  };

  if (isReviewComment()) {
    return await octokit.rest.reactions.createForPullRequestReviewComment(params);
  }
  return await octokit.rest.reactions.createForIssueComment(params);
}

/**
 * Remove a previously added reaction from the triggering comment.
 *
 * Uses the appropriate API endpoint based on whether the comment is a regular
 * issue comment or a pull request review comment (inline code comment).
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
  const params = {
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: comment.id,
    reaction_id: reaction.data.id,
  };

  if (isReviewComment()) {
    return octokit.rest.reactions.deleteForPullRequestComment(params);
  }
  return octokit.rest.reactions.deleteForIssueComment(params);
}

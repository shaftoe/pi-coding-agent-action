/**
 * @file GitHub reaction management (add / remove).
 *
 * Provides helpers to add an "eyes" reaction to the triggering comment while
 * the Pi agent is processing, and to remove it once the result (or error) has
 * been posted. This gives users immediate visual feedback that their request
 * was received.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import RestEndpointMethodTypes from '@octokit/plugin-rest-endpoint-methods';
import { getOctokit } from './octokit.js';
import { REACTION_TYPE_EYES } from './constants.js';
export type CreateReactionType =
  RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['createForIssueComment']['response'];
export type DeleteReactionType =
  RestEndpointMethodTypes.RestEndpointMethodTypes['reactions']['deleteForIssueComment']['response'];

const octokit = getOctokit();

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  core.debug(msg);
}

/**
 * Add an "eyes" (👀) reaction to the triggering comment to signal that the
 * agent has started processing.
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

  return await octokit.rest.reactions.createForIssueComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: comment.id,
    content: REACTION_TYPE_EYES,
  });
}

/**
 * Remove a previously added reaction from the triggering comment.
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

  return octokit.rest.reactions.deleteForIssueComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: comment.id,
    reaction_id: reaction.data.id,
  });
}

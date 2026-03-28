/**
 * @file Main orchestration logic for the Pi GitHub Action.
 *
 * Reads action inputs (provider, model, token, thinking_level), fetches the
 * user prompt from the triggering GitHub comment, initialises a Pi client
 * session, sends the prompt, and posts the result (or error) back as a GitHub
 * comment. An "eyes" reaction is added while processing to give visual feedback.
 */

import * as core from '@actions/core';
import { Temporal } from '@js-temporal/polyfill';
import { Client } from './pi';
import {
  addReaction,
  deleteReaction,
  createFinalComment,
  getPrompt,
  getStartTimeFromContext,
} from './github/index';
import type { CreateReactionType } from './github/index';

/**
 * Run the Pi coding agent end-to-end.
 *
 * @throws Rethrows any error from the Pi session after posting it as a comment.
 */
export async function run() {
  const provider = core.getInput('provider');
  const model = core.getInput('model');
  const token = core.getInput('token');
  const thinkingLevel = core.getInput('thinking_level') ?? 'off';
  const prompt = await getPrompt(core.getInput('prompt'));

  if (!prompt) {
    return;
  }

  let startTime = getStartTimeFromContext();
  if (startTime !== undefined) {
    core.info(`🕐 Trigger time: ${startTime.toString()}`);
  } else {
    startTime = Temporal.Now.instant();
  }

  let reaction: CreateReactionType | undefined;
  let result: string;

  try {
    reaction = await addReaction();

    // Pi session execution
    const pi = await new Client(model, provider, token, thinkingLevel).ready();
    result = await pi.prompt(prompt);
  } catch (e) {
    await finalize(
      e instanceof Error ? e.message : String(e),
      provider,
      model,
      thinkingLevel,
      startTime,
      reaction
    );
    throw e;
  }

  await finalize(result, provider, model, thinkingLevel, startTime, reaction);
}

/**
 * Finalizes the execution by creating a final comment and optionally deleting the reaction
 * from the comment.
 *
 * @param body
 * @param provider
 * @param model
 * @param thinkingLevel
 * @param startTime
 * @param reaction
 */
async function finalize(
  body: string,
  provider: string,
  model: string,
  thinkingLevel: string,
  startTime: Temporal.Instant,
  reaction?: CreateReactionType
): Promise<void> {
  if (reaction) {
    await deleteReaction(reaction);
  }

  await createFinalComment(body, {
    provider,
    model,
    thinkingLevel,
    executionDuration: startTime.until(Temporal.Now.instant()),
  });
}

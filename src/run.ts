import * as core from '@actions/core';
import { Client } from './pi';
import { addReaction, deleteReaction, createFinalComment, getPrompt } from './github';
import type { createReactionType } from './github';

export async function run() {
  const provider = core.getInput('provider');
  const model = core.getInput('model');
  const token = core.getInput('token');
  const thinkingInput = core.getInput('thinking_level') ?? 'off';

  const prompt = await getPrompt();
  if (!prompt) {
    return;
  }

  // add eyes reaction to the comment, will be removed before final comment
  let reaction: createReactionType | undefined;
  let result: string;

  try {
    reaction = await addReaction();

    // Pi session execution
    const pi = await new Client(model, provider, token, thinkingInput).ready();
    result = await pi.prompt(prompt);
  } catch (e) {
    if (reaction) {
      await deleteReaction(reaction);
    }
    await createFinalComment(e instanceof Error ? e.message : String(e));
    throw e;
  }

  if (reaction) {
    await deleteReaction(reaction);
  }
  await createFinalComment(result);
}

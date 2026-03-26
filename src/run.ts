import * as core from '@actions/core';
import { Client } from './pi';
import { getComment, addReaction, deleteReaction, createComment } from './github';

export async function run() {
  const provider = core.getInput('provider');
  const model = core.getInput('model');
  const token = core.getInput('token');
  const thinkingInput = core.getInput('thinking_level') ?? 'off';
  const comment = await getComment();
  if (!comment) {
    core.notice('no comment found in context, skipping prompt');
    return;
  }

  const prompt = comment.body;
  if (!prompt) {
    core.notice('no prompt found in comment, skipping prompt');
    return;
  }

  // add eyes reaction to the comment, will be removed before final comment
  const reaction = await addReaction(comment);
  let result: string;

  try {
    const pi = await new Client(model, provider, token, thinkingInput).ready();
    result = await pi.prompt(prompt);
  } catch (e) {
    await deleteReaction(reaction, comment);
    await createComment(e instanceof Error ? e.message : String(e));
    throw e;
  }

  await deleteReaction(reaction, comment);
  await createComment(result);
}

import * as core from '@actions/core';
import { AuthStorage, createAgentSession, ModelRegistry } from '@mariozechner/pi-coding-agent';

const provider = core.getInput('provider');
const modInput = core.getInput('model');
const token = core.getInput('token');

export async function run() {
  const authStorage = AuthStorage.create();
  authStorage.set(provider, {
    type: 'api_key',
    key: token,
  });
  const modelRegistry = new ModelRegistry(authStorage);
  const model = modelRegistry.find(provider, modInput);
  if (model) {
    core.info(`Found model: ${model.provider}/${model.id}`);
  } else {
    throw new Error('Model not found: ' + provider + '/' + model);
  }

  const { session } = await createAgentSession({
    model,
    thinkingLevel: 'medium', // off, low, medium, high
    authStorage,
    modelRegistry,
  });

  session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  await session.prompt('Say hello in one sentence.');
  core.info('done');
}

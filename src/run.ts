import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
} from '@mariozechner/pi-coding-agent';

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
    resourceLoader: await getResourceLoader(),
    thinkingLevel: 'medium', // off, low, medium, high
    authStorage,
    modelRegistry,
  });

  session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  const payload = github.context.payload;
  const body = payload.issue?.body ?? payload.pull_request?.body ?? undefined;

  if (!body) {
    throw new Error('no body, skipping prompt');
  }

  await session.prompt(body);
  core.info('done');
}

async function getResourceLoader(): Promise<DefaultResourceLoader> {
  const loader1 = new DefaultResourceLoader({
    systemPromptOverride: () => `You are a helpful non-interactive assistant
running in a CI/CD environment.`,
  });
  await loader1.reload();
  return loader1;
}

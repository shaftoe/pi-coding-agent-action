import * as core from '@actions/core';
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  DefaultResourceLoader,
} from '@mariozechner/pi-coding-agent';
import { SYSTEM_PROMPT } from './prompt';

import type { AgentSession } from '@mariozechner/pi-coding-agent';
import type { Api, Model } from '@mariozechner/pi-ai';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';

export async function getResourceLoader(): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    systemPromptOverride: () => SYSTEM_PROMPT,
  });
  await loader.reload();
  return loader;
}

export class PiClient {
  private model: Model<Api>;
  private authStorage: AuthStorage = AuthStorage.create();
  private modelRegistry: ModelRegistry;
  private session!: AgentSession;
  private modelStr: string;
  private provider: string;
  private token: string;
  private thinkingLevel: ThinkingLevel;
  private outputChunks: string[] = [];

  constructor(modelStr: string, provider: string, token: string, level: ThinkingLevel = 'off') {
    this.modelStr = modelStr;
    this.provider = provider;
    this.token = token;
    this.thinkingLevel = level;
    this.modelRegistry = new ModelRegistry(this.authStorage);

    if (this.token) {
      core.info(`Setting api_key auth token for provider: ${this.provider}`);
      this.authStorage.set(this.provider, {
        type: 'api_key',
        key: this.token,
      });
    }

    const foundModel = this.modelRegistry.find(this.provider, this.modelStr);

    if (foundModel) {
      this.model = foundModel;
      core.info(`Using model ${this.model.provider}/${this.model.id}`);
    } else {
      throw new Error('Model not found: ' + this.provider + '/' + this.modelStr);
    }
  }

  async ready(): Promise<PiClient> {
    const { session } = await createAgentSession({
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      resourceLoader: await getResourceLoader(),
    });
    this.session = session;

    this.session.subscribe(event => {
      if (event.type !== 'message_update') {
        return;
      }
      switch (event.assistantMessageEvent.type) {
        case 'text_delta':
          this.outputChunks.push(event.assistantMessageEvent.delta);
          break;
        case 'thinking_delta':
          process.stdout.write(event.assistantMessageEvent.delta);
          break;
        default:
          break;
      }
    });

    return this;
  }

  async prompt(text: string | undefined): Promise<string> {
    if (!text) {
      throw new Error('no text, skipping prompt');
    }

    core.info('thinking...\n' + text);
    await this.session.prompt(text);
    process.stdout.write('\n'); // ensure new line after prompt, usually missing from agent

    return this.outputChunks.join('');
  }
}

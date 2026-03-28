/**
 * @file Resource loader configuration for the Pi agent.
 *
 * Creates and configures the resource loader used by the agent session.
 *
 * Registers custom extension factories (tool definitions) and overrides the
 * default system prompt with the one tailored for GitHub Actions usage.
 *
 * Also appends AGENTS.md content to the system prompt to provide project context.
 */

import { DefaultResourceLoader } from '@mariozechner/pi-coding-agent';
import { SYSTEM_PROMPT } from './prompt';
import { loggingFactory } from './logging';
import { extensionsFactory } from './tools/index';

/**
 * Create and configure the resource loader used by the agent session.
 *
 * @returns A fully loaded {@link DefaultResourceLoader} instance.
 */
export async function getResourceLoader(): Promise<DefaultResourceLoader> {
  const loader = new DefaultResourceLoader({
    extensionFactories: [extensionsFactory, loggingFactory],
    systemPromptOverride: () => SYSTEM_PROMPT,
    appendSystemPromptOverride: agentsFiles => {
      if (agentsFiles.length === 0) {
        return [];
      }
      return agentsFiles;
    },
  });
  await loader.reload();
  return loader;
}

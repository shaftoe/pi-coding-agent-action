/**
 * @file Real implementation of PiAgent and PiAgentFactory.
 *
 * Provides the production implementation for Pi agent operations.
 */

import type { PiAgent, PiAgentFactory, PiConfig, CoreAdapter } from '../types';
import type { PlatformProvider } from '../platform';
import type { DiffConfig } from '../pi/tools/index';
import { Agent } from '../pi';

/**
 * Factory function that creates a PiAgent wrapping a real Pi Agent instance.
 */
export const createRealPiAgent: PiAgentFactory = (
  config: PiConfig,
  core: CoreAdapter,
  provider: PlatformProvider
): PiAgent => {
  const diffConfig: DiffConfig = {};
  if (config.diffMaxLines) {
    diffConfig.maxLines = config.diffMaxLines;
  }
  if (config.diffMaxBytes) {
    diffConfig.maxBytes = config.diffMaxBytes;
  }
  if (config.diffIgnorePatterns?.length) {
    diffConfig.ignorePatterns = config.diffIgnorePatterns;
  }

  const agent = new Agent(
    config.model,
    config.provider,
    config.token,
    config.thinkingLevel,
    core,
    provider,
    config.extensions,
    config.loadBuiltinExtensions,
    config.baseUrl,
    Object.keys(diffConfig).length > 0 ? diffConfig : undefined
  );

  return {
    async run(text: string) {
      await agent.ready();
      return agent.run(text);
    },
    async exportSessionHtml(outputPath: string) {
      return agent.exportSessionHtml(outputPath);
    },
  };
};

/**
 * @file Real implementation of PiAgent and PiAgentFactory.
 *
 * Provides the production implementation for Pi agent operations.
 */

import type { PiAgent, PiAgentFactory, PiConfig, CoreAdapter } from '../types';
import type { PlatformProvider } from '../platform';
import type { SessionArtifactsCollector } from '../pi/session-artifacts';
import { Agent } from '../pi';

/**
 * Factory function that creates a PiAgent wrapping a real Pi Agent instance.
 */
export const createRealPiAgent: PiAgentFactory = (
  config: PiConfig,
  core: CoreAdapter,
  provider: PlatformProvider,
  artifactsCollector?: SessionArtifactsCollector
): PiAgent => {
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
    artifactsCollector
  );

  return {
    async run(text: string) {
      await agent.ready();
      return agent.run(text);
    },
  };
};

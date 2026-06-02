/**
 * @file Real implementation of PiAgent and PiAgentFactory.
 *
 * Provides the production implementation for Pi agent operations.
 */

import type { PiAgent, PiAgentFactory, PiConfig, Logger, AgentEvents } from '../types';
import type { PlatformProvider } from '../platform';
import { Agent } from '../pi';

/**
 * Factory function that creates a PiAgent wrapping a real Pi Agent instance.
 *
 * Routes streaming events to `process.stdout` (the GitHub Action frontend).
 * Alternative frontends (web UI, GitHub App) would provide their own factory
 * with different event routing.
 */
export const createRealPiAgent: PiAgentFactory = (
  config: PiConfig,
  logger: Logger,
  provider: PlatformProvider
): PiAgent => {
  const events: AgentEvents = {
    onThinkingDelta: delta => process.stdout.write(delta),
    onPromptComplete: () => process.stdout.write('\n'),
  };
  const agent = new Agent(logger, provider, config, events);

  return {
    async run(text: string) {
      await agent.ready();
      return agent.run(text);
    },
    async exportSessionHtml(outputPath: string) {
      return agent.exportSessionHtml(outputPath);
    },
    async exportSessionJsonl(outputPath: string) {
      return agent.exportSessionJsonl(outputPath);
    },
  };
};

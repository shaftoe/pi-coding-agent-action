/**
 * @file Real implementation of PiAgent and PiAgentFactory.
 *
 * Provides the production implementation for Pi agent operations.
 */

import type { PiAgent, PiAgentFactory, PiConfig, SessionStats } from '../types';
import { Agent } from '../pi';

/**
 * Factory function that creates a PiAgent wrapping a real Pi Agent instance.
 */
export const createRealPiAgent: PiAgentFactory = (config: PiConfig): PiAgent => {
  const agent = new Agent(config.model, config.provider, config.token, config.thinkingLevel);

  return {
    async prompt(text: string): Promise<string> {
      await agent.ready();
      return agent.prompt(text);
    },

    getSessionStats(): SessionStats | undefined {
      return agent.getSessionStats();
    },
  };
};

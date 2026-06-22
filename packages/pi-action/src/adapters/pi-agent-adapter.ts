/**
 * @file Real implementation of PiAgent and PiAgentFactory.
 *
 * Provides the production implementation for Pi agent operations.
 * This is the GitHub Action frontend — it routes streaming events to
 * `process.stdout`.
 *
 * Alternative frontends (web UI, GitHub App) would provide their own factory
 * with different event routing.
 *
 * NOTE: The `PI_PACKAGE_DIR` env var is set once at action startup (in
 * `run.ts`) so the SDK's `getPackageDir()` resolves to the bundled SDK
 * assets in `dist/pi-sdk/`. There is no need to temporarily set/restore
 * the env var around each export call — the action is a single-process,
 * short-lived execution.
 */

import type {
  PiAgent,
  PiAgentFactory,
  PiConfig,
  Logger,
  AgentEvents,
} from '@alexanderfortin/pi-orchestrator';
import type { PlatformProvider } from '@alexanderfortin/pi-orchestrator';
import { Agent } from '@alexanderfortin/pi-orchestrator';

/**
 * Factory function that creates a PiAgent wrapping a real Pi Agent instance.
 *
 * Routes streaming events to `process.stdout` (the GitHub Action frontend).
 */
export const createRealPiAgent: PiAgentFactory = (
  config: PiConfig,
  logger: Logger,
  provider: PlatformProvider
): PiAgent => {
  const events: AgentEvents = {
    onThinkingDelta: delta => process.stdout.write(delta),
    onThinkingComplete: () => process.stdout.write('\n'),
    onPromptComplete: () => process.stdout.write('\n'),
  };
  const agent = new Agent(logger, provider, config, events);

  return {
    async run(text: string) {
      await agent.ready();
      return agent.run(text);
    },
    getSessionStats() {
      return agent.getSessionStats();
    },
    async exportSessionHtml(outputPath: string) {
      return agent.exportSessionHtml(outputPath);
    },
    async exportSessionJsonl(outputPath: string) {
      return agent.exportSessionJsonl(outputPath);
    },
  };
};

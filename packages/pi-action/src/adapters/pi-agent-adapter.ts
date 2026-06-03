/**
 * @file Real implementation of PiAgent and PiAgentFactory.
 *
 * Provides the production implementation for Pi agent operations.
 * This is the GitHub Action frontend — it routes streaming events to
 * `process.stdout` and handles SDK packaging quirks (like `PI_PACKAGE_DIR`)
 * that are specific to bundled deployments.
 *
 * Alternative frontends (web UI, GitHub App) would provide their own factory
 * with different event routing and no `PI_PACKAGE_DIR` manipulation.
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
 * Export a session to HTML, temporarily setting `PI_PACKAGE_DIR` if the
 * config specifies a package directory.
 *
 * When the action runs from its bundled `dist/index.js`, the SDK's
 * `getPackageDir()` walks up from `__dirname` and finds the action's
 * `package.json` instead of the SDK's. The build script copies the SDK's
 * export-html assets into `dist/pi-sdk/`. Setting `PI_PACKAGE_DIR` tells
 * the SDK where to find those assets — it's the SDK's documented escape
 * hatch for bundled deployments.
 *
 * When `config.packageDir` is not set (e.g. library/CLI usage), the env
 * var is left untouched and the SDK resolves its own package directory.
 */
async function exportSessionHtmlWithPackageDir(
  agent: Agent,
  outputPath: string,
  packageDir?: string
): Promise<string> {
  if (!packageDir) {
    return agent.exportSessionHtml(outputPath);
  }

  const previousPiPackageDir = process.env.PI_PACKAGE_DIR;
  try {
    process.env.PI_PACKAGE_DIR = packageDir;
    return agent.exportSessionHtml(outputPath);
  } finally {
    if (previousPiPackageDir !== undefined) {
      process.env.PI_PACKAGE_DIR = previousPiPackageDir;
    } else {
      delete process.env.PI_PACKAGE_DIR;
    }
  }
}

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
    async exportSessionHtml(outputPath: string) {
      return exportSessionHtmlWithPackageDir(agent, outputPath, config.packageDir);
    },
    async exportSessionJsonl(outputPath: string) {
      return agent.exportSessionJsonl(outputPath);
    },
  };
};

/**
 * @file CLI implementation of {@link PiAgentFactory}.
 *
 * Mirrors `packages/pi-action/src/adapters/pi-agent-adapter.ts` with two
 * CLI-specific differences:
 *
 * 1. **No `PI_PACKAGE_DIR` manipulation** — the CLI runs from a standard
 *    `node_modules/` layout, so the Pi SDK's exported `getPackageDir()`
 *    resolves its own package directory. The bundled-deployment escape
 *    hatch is only relevant to the GitHub Action's esbuild output.
 * 2. **Streaming events routed to stderr** — so the agent's final
 *    response on stdout is never interleaved with thinking deltas. The
 *    action frontend writes deltas to stdout because GitHub Actions
 *    surface them as workflow log lines; in a terminal, stdout pollution
 *    would break piping.
 */

import {
  Agent,
  type AgentEvents,
  type Logger,
  type PiAgent,
  type PiAgentFactory,
  type PiConfig,
} from '@alexanderfortin/pi-orchestrator';
import type { PlatformProvider } from '@alexanderfortin/pi-orchestrator';

/**
 * Factory function for CLI Pi agent instances.
 *
 * Streaming events go to stderr; final response goes to stdout via the
 * orchestrator's OutputSink flow.
 */
export const createCliPiAgent: PiAgentFactory = (
  config: PiConfig,
  logger: Logger,
  provider: PlatformProvider
): PiAgent => {
  const events: AgentEvents = {
    onThinkingDelta: delta => process.stderr.write(delta),
    onThinkingComplete: () => process.stderr.write('\n'),
    onPromptComplete: () => process.stderr.write('\n'),
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

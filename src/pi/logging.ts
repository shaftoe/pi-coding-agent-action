/**
 * @file Context visualization extension for Pi GitHub Action.
 *
 * Provides a nicely formatted view of the agent context before session starts
 * and after session ends, including system prompt, tools and configuration.
 */

import type { Logger } from '../types';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

/**
 * Captured information about extension loading, passed from resource-loader
 * to be displayed in the `before_agent_start` section.
 */
export interface ExtensionLoadingInfo {
  /** The original extension sources requested by the user. */
  requested: string[];
  /** Paths of extensions that were successfully loaded. */
  loaded: string[];
  /** Warnings encountered during extension loading. */
  warnings: string[];
}

/**
 * Injected at build time because Pi SDK 'VERSION' doesn't play well with bundles
 */
declare const __PI_CODING_AGENT_VERSION__: string;

export const loggingFactory = (
  pi: ExtensionAPI,
  logger: Logger,
  extensionInfo?: ExtensionLoadingInfo
) => {
  pi.on('tool_execution_start', async event => {
    logger.info('');
    logger.startGroup?.(`🔧 Tool started: ${event.toolName} (${event.toolCallId})`);
    logger.info(`  Args: ${truncateText(JSON.stringify(event.args, null, 2), 500)}`);
    logger.endGroup?.();
  });

  pi.on('tool_execution_end', async event => {
    logger.startGroup?.(`🔧 Tool ended: ${event.toolName} (${event.toolCallId})`);

    // Check for cancellation via details.cancelled pattern
    const cancelled = event.result?.details?.cancelled === true;

    if (cancelled) {
      logger.warning(`  ⚠️ execution cancelled`);
    } else if (event.isError) {
      logger.info(`  ❌ execution failed`);
    } else {
      logger.info(`  ✅ execution succeeded`);
    }
    logger.endGroup?.();
  });

  pi.on('tool_execution_update', async event => {
    logger.debug(
      `🔧 Tool ${event.toolName} (${event.toolCallId}) update: ${truncateText(JSON.stringify(event.partialResult), 200)}`
    );
  });

  pi.on('turn_start', async event => {
    logger.debug(`🔄 Turn ${event.turnIndex} started`);
  });

  pi.on('turn_end', async event => {
    const toolCount = event.toolResults.length;
    logger.debug(`🔄 Turn ${event.turnIndex} completed (${toolCount} tool result(s))`);
  });

  pi.on('after_provider_response', async event => {
    logger.debug(`📡 Provider response: status ${event.status}`);
  });

  pi.on('before_agent_start', async (event, ctx) => {
    logger.startGroup?.('🤖 Agent Session settings');
    logger.info(`  Running @earendil-works/pi-coding-agent@${getVersion()}`);
    logger.info('─────────────────────────────────────────────────────────────────────');

    const model = ctx.model;
    const thinkingLevel = pi.getThinkingLevel();
    logger.info('📊 LLM');
    if (model) {
      logger.info(`  Model:            ${model.provider}/${model.id}`);
      logger.info(`  Reasoning:        ${model.reasoning}`);
    } else {
      logger.info('  Model:     Not configured');
    }
    logger.info(`  Thinking Level:   ${thinkingLevel}`);
    logger.info('─────────────────────────────────────────────────────────────────────');

    if (extensionInfo && extensionInfo.requested.length > 0) {
      logger.info('📦 Extensions');
      logger.info(`  Requested:        ${extensionInfo.requested.join(', ')}`);
      if (extensionInfo.loaded.length > 0) {
        logger.info(`  Loaded:           ${extensionInfo.loaded.length} extension(s)`);
        extensionInfo.loaded.forEach(ext => {
          logger.info(`    • ${ext}`);
        });
      } else {
        logger.info('  Loaded:           None');
      }
      extensionInfo.warnings.forEach(warning => {
        logger.warning(`  ⚠️  ${warning}`);
      });
      logger.info('─────────────────────────────────────────────────────────────────────');
    }

    const allTools = pi.getAllTools();
    if (allTools.length > 0) {
      logger.info('🔧 Available Tools');
      allTools.forEach(tool => {
        if (tool.sourceInfo.source) {
          logger.info(`  • [${tool.sourceInfo.source}] ${tool.name}`);
        } else {
          logger.info(`  • ${tool.name}`);
        }
      });
      logger.info('─────────────────────────────────────────────────────────────────────');
    }

    const systemPrompt = ctx.getSystemPrompt();
    logger.info('📝 System Prompt');
    const displaySystemPrompt = truncateText(systemPrompt, 1000);
    logger.info(displaySystemPrompt);
    if (systemPrompt.length > 1000) {
      logger.info(`\n... (${systemPrompt.length - 1000} more characters)`);
    }
    logger.info('─────────────────────────────────────────────────────────────────────');

    logger.info('👤 User Prompt');
    logger.info(truncateText(event.prompt, 500));
    if (event.images && event.images.length > 0) {
      logger.info(`  [${event.images.length} image(s) attached]`);
    }
    logger.endGroup?.();

    logger.info('════════════════════════════════════════════════════════════════');
    logger.info('🚀 Starting agent session...');
    logger.info('════════════════════════════════════════════════════════════════');
  });
};

/**
 * Truncate text to a maximum length, preserving word boundaries.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) {
    return text;
  }

  const truncated = text.substring(0, maxLength);
  // Find the last complete word
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) {
    return truncated.substring(0, lastSpace) + '...';
  }
  return truncated + '...';
}

export function getVersion(): string {
  return typeof __PI_CODING_AGENT_VERSION__ === 'string' ? __PI_CODING_AGENT_VERSION__ : 'unknown';
}

/**
 * Create a logging factory bound to a specific CoreAdapter.
 *
 * This is a convenience wrapper that curries the CoreAdapter for use with
 * the Pi SDK's extension system.
 *
 * @param core - The CoreAdapter to use for logging.
 * @param extensionInfo - Optional extension loading info to display in the session header.
 * @returns A factory function compatible with the Pi SDK's extension system.
 */
export function createLoggingFactory(logger: Logger, extensionInfo?: ExtensionLoadingInfo) {
  return (pi: ExtensionAPI) => loggingFactory(pi, logger, extensionInfo);
}

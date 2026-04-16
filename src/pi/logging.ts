/**
 * @file Context visualization extension for Pi GitHub Action.
 *
 * Provides a nicely formatted view of the agent context before session starts
 * and after session ends, including system prompt, tools and configuration.
 */

import type { CoreAdapter } from '../types';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

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
  core: CoreAdapter,
  extensionInfo?: ExtensionLoadingInfo
) => {
  pi.on('tool_execution_start', async event => {
    core.info('');
    core.debug(`🔧 Tool Execution started: ${event.toolName} (${event.toolCallId})`);
  });

  pi.on('tool_execution_end', async event => {
    core.info(`::group::🔧 Tool Execution: ${event.toolName}`);
    core.info(`  Tool Call ID: ${event.toolCallId}`);

    // Check for cancellation via details.cancelled pattern
    const cancelled = event.result?.details?.cancelled === true;

    if (cancelled) {
      core.warning(`  ⚠️ execution cancelled`);
    } else if (event.isError) {
      core.info(`  ❌ execution failed`);
    } else {
      core.info(`  ✅ execution succeeded`);
    }
    core.info('::endgroup::');
  });

  pi.on('before_agent_start', async (event, ctx) => {
    core.info('::group::🤖 Agent Session settings');
    core.info(`  Running @mariozechner/pi-coding-agent@${getVersion()}`);
    core.info('─────────────────────────────────────────────────────────────────────');

    const model = ctx.model;
    const thinkingLevel = pi.getThinkingLevel();
    core.info('📊 LLM');
    if (model) {
      core.info(`  Model:            ${model.provider}/${model.id}`);
      core.info(`  Reasoning:        ${model.reasoning}`);
    } else {
      core.info('  Model:     Not configured');
    }
    core.info(`  Thinking Level:   ${thinkingLevel}`);
    core.info('─────────────────────────────────────────────────────────────────────');

    if (extensionInfo && extensionInfo.requested.length > 0) {
      core.info('📦 Extensions');
      core.info(`  Requested:        ${extensionInfo.requested.join(', ')}`);
      if (extensionInfo.loaded.length > 0) {
        core.info(`  Loaded:           ${extensionInfo.loaded.length} extension(s)`);
        extensionInfo.loaded.forEach(ext => {
          core.info(`    • ${ext}`);
        });
      } else {
        core.info('  Loaded:           None');
      }
      extensionInfo.warnings.forEach(warning => {
        core.warning(`  ⚠️  ${warning}`);
      });
      core.info('─────────────────────────────────────────────────────────────────────');
    }

    const allTools = pi.getAllTools();
    if (allTools.length > 0) {
      core.info('🔧 Available Tools');
      allTools.forEach(tool => {
        if (tool.sourceInfo.source) {
          core.info(`  • [${tool.sourceInfo.source}] ${tool.name}`);
        } else {
          core.info(`  • ${tool.name}`);
        }
      });
      core.info('─────────────────────────────────────────────────────────────────────');
    }

    const systemPrompt = ctx.getSystemPrompt();
    core.info('📝 System Prompt');
    const displaySystemPrompt = truncateText(systemPrompt, 1000);
    core.info(displaySystemPrompt);
    if (systemPrompt.length > 1000) {
      core.info(`\n... (${systemPrompt.length - 1000} more characters)`);
    }
    core.info('─────────────────────────────────────────────────────────────────────');

    core.info('👤 User Prompt');
    core.info(truncateText(event.prompt, 500));
    if (event.images && event.images.length > 0) {
      core.info(`  [${event.images.length} image(s) attached]`);
    }
    core.info('::endgroup::');

    core.info('════════════════════════════════════════════════════════════════');
    core.info('🚀 Starting agent session...');
    core.info('════════════════════════════════════════════════════════════════');
  });

  pi.on('agent_end', async () => {
    core.info('\n');
    core.info('════════════════════════════════════════════════════════════════');
    core.info('✅ Agent session completed');
    core.info('════════════════════════════════════════════════════════════════');
  });

  // Hook to inspect provider responses for monitoring and debugging
  // Check if the method exists (added in v0.67.4) for backward compatibility
  const piWithAfterHook = pi as ExtensionAPI & {
    afterProviderResponse?: (
      callback: (response: { status: number; headers: Record<string, string> }) => void
    ) => void;
  };

  if (piWithAfterHook.afterProviderResponse) {
    piWithAfterHook.afterProviderResponse(
      (response: { status: number; headers: Record<string, string> }) => {
        core.debug(`[provider] Response status: ${response.status}`);

        // Log rate limit information if available
        const rateLimitRemaining = response.headers['x-ratelimit-remaining'];
        if (rateLimitRemaining !== undefined) {
          core.debug(`[provider] Rate limit remaining: ${rateLimitRemaining}`);
        }

        const rateLimitReset = response.headers['x-ratelimit-reset'];
        if (rateLimitReset !== undefined) {
          core.debug(`[provider] Rate limit resets at: ${rateLimitReset}`);
        }

        // Log request ID for debugging
        const requestId = response.headers['x-request-id'] ?? response.headers['request-id'];
        if (requestId !== undefined) {
          core.debug(`[provider] Request ID: ${requestId}`);
        }

        // Warn about non-2xx responses
        if (response.status >= 400) {
          core.warning(`[provider] Non-success response status: ${response.status}`);
        }
      }
    );
  }
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
export function createLoggingFactory(core: CoreAdapter, extensionInfo?: ExtensionLoadingInfo) {
  return (pi: ExtensionAPI) => loggingFactory(pi, core, extensionInfo);
}

/**
 * @file Context visualization extension for Pi GitHub Action.
 *
 * Provides a nicely formatted view of the agent context before session starts
 * and after session ends, including system prompt, tools and configuration.
 */

import * as core from '@actions/core';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';

export const loggingFactory = (pi: ExtensionAPI) => {
  pi.on('tool_execution_start', async event => {
    core.info('\n');
    core.info('::group::🔧 Tool Execution');
    core.info(`Tool called: ${event.toolName}`);
    core.info('::endgroup::');
  });

  pi.on('tool_execution_end', async event => {
    // Check for cancellation via details.cancelled pattern
    const cancelled = event.result?.details?.cancelled === true;

    if (cancelled) {
      core.warning(`⚠️ Tool execution cancelled: ${event.toolName}`);
    } else if (event.isError) {
      core.warning(`❌ Tool execution failed: ${event.toolName}`);
    }
  });

  pi.on('before_agent_start', async (event, ctx) => {
    core.info('::group::🤖 Agent Configuration');
    core.info('╔════════════════════════════════════════════════════════════════╗');
    core.info('║                  🤖 AGENT SESSION CONTEXT                      ║');
    core.info('╚════════════════════════════════════════════════════════════════╝');

    // Model configuration
    const model = ctx.model;
    const thinkingLevel = pi.getThinkingLevel();
    core.info('📊 Configuration');
    if (model) {
      core.info(`  Model:            ${model.provider}/${model.id}`);
      core.info(`  Reasoning:        ${model.reasoning}`);
    } else {
      core.info('  Model:     Not configured');
    }
    core.info(`  Thinking Level:   ${thinkingLevel}`);
    core.info('─────────────────────────────────────────────────────────────────────');

    // Available tools
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

    // System prompt
    const systemPrompt = ctx.getSystemPrompt();
    core.info('📝 System Prompt');
    const displaySystemPrompt = truncateText(systemPrompt, 1000);
    core.info(displaySystemPrompt);
    if (systemPrompt.length > 1000) {
      core.info(`\n... (${systemPrompt.length - 1000} more characters)`);
    }
    core.info('─────────────────────────────────────────────────────────────────────');

    // Current user prompt
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

  // Show completion after agent finishes
  pi.on('agent_end', async () => {
    core.info('\n');
    core.info('════════════════════════════════════════════════════════════════');
    core.info('✅ Agent session completed');
    core.info('════════════════════════════════════════════════════════════════');
  });
};

/**
 * Truncate text to a maximum length, preserving word boundaries.
 */
function truncateText(text: string, maxLength: number): string {
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

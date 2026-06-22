/**
 * @file Context visualization extension for Pi GitHub Action.
 *
 * Provides a nicely formatted view of the agent context before session starts
 * and after session ends, including system prompt, tools and configuration.
 */

import type { Logger } from '../types';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getPiVersion } from '../version';

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
 * A log line to emit. Sections return arrays of these so the caller can
 * drive the actual `Logger` calls in one place. Exported for unit testing.
 */
export interface LogLine {
  level: 'info' | 'warning';
  text: string;
}

const SECTION_SEPARATOR = '─────────────────────────────────────────────────────────────────────';

function info(text: string): LogLine {
  return { level: 'info', text };
}

function warning(text: string): LogLine {
  return { level: 'warning', text };
}

/**
 * Format the LLM/model block of the session banner. Exported for unit testing.
 */
export function formatLLMSection(
  model:
    | { provider: string; id: string; reasoning?: string | null | boolean | undefined }
    | null
    | undefined,
  thinkingLevel: number | string
): LogLine[] {
  const lines: LogLine[] = [info('📊 LLM')];
  if (model) {
    lines.push(info(`  Model:            ${model.provider}/${model.id}`));
    lines.push(info(`  Reasoning:        ${model.reasoning}`));
  } else {
    lines.push(info('  Model:     Not configured'));
  }
  lines.push(info(`  Thinking Level:   ${thinkingLevel}`));
  lines.push(info(SECTION_SEPARATOR));
  return lines;
}

/**
 * Format the Extensions block, including any warnings. Returns an empty
 * array when there are no requested extensions (section is omitted).
 * Exported for unit testing.
 */
// fallow-ignore-next-line complexity
export function formatExtensionsSection(extensionInfo: ExtensionLoadingInfo): LogLine[] {
  if (extensionInfo.requested.length === 0) {
    return [];
  }
  const lines: LogLine[] = [info('📦 Extensions')];
  lines.push(info(`  Requested:        ${extensionInfo.requested.join(', ')}`));
  if (extensionInfo.loaded.length > 0) {
    lines.push(info(`  Loaded:           ${extensionInfo.loaded.length} extension(s)`));
    for (const ext of extensionInfo.loaded) {
      lines.push(info(`    • ${ext}`));
    }
  } else {
    lines.push(info('  Loaded:           None'));
  }
  for (const warningText of extensionInfo.warnings) {
    lines.push(warning(`  ⚠️  ${warningText}`));
  }
  lines.push(info(SECTION_SEPARATOR));
  return lines;
}

/**
 * Format the Available Tools block. Returns an empty array when no tools
 * are registered. Exported for unit testing.
 */
export function formatToolsSection(
  tools: readonly { name: string; sourceInfo: { source?: string | null } }[]
): LogLine[] {
  if (tools.length === 0) {
    return [];
  }
  const lines: LogLine[] = [info('🔧 Available Tools')];
  for (const tool of tools) {
    if (tool.sourceInfo.source) {
      lines.push(info(`  • [${tool.sourceInfo.source}] ${tool.name}`));
    } else {
      lines.push(info(`  • ${tool.name}`));
    }
  }
  lines.push(info(SECTION_SEPARATOR));
  return lines;
}

/**
 * Format the System Prompt block, truncating to 1000 chars and appending
 * a continuation indicator when truncated. Exported for unit testing.
 */
export function formatSystemPromptSection(systemPrompt: string): LogLine[] {
  const lines: LogLine[] = [info('📝 System Prompt')];
  const display = truncateText(systemPrompt, 1000);
  lines.push(info(display));
  if (systemPrompt.length > 1000) {
    lines.push(info(`\n... (${systemPrompt.length - 1000} more characters)`));
  }
  lines.push(info(SECTION_SEPARATOR));
  return lines;
}

/**
 * A compaction trigger reason, as reported by the Pi SDK's
 * `session_before_compact` / `session_compact` events (v0.79.10+).
 */
export type CompactionReason = 'manual' | 'threshold' | 'overflow';

/**
 * Map a compaction reason to a human-readable label. Exported for unit testing.
 */
export function compactionReasonLabel(reason: CompactionReason): string {
  switch (reason) {
    case 'manual':
      return 'manual /compact';
    case 'threshold':
      return 'context threshold reached';
    case 'overflow':
      return 'context overflow recovery';
  }
}

/**
 * Format a log line for a context-compaction event.
 *
 * Uses the `reason` and `willRetry` metadata introduced in Pi v0.79.10 to
 * give visibility into why the context was compacted (manual, threshold, or
 * overflow recovery) and whether the aborted turn is retried afterwards.
 *
 * @param phase     - Whether this is the `before` or `after` compaction event.
 * @param reason    - What triggered the compaction.
 * @param willRetry - Whether the aborted turn is retried after compaction.
 * @returns A single {@link LogLine} describing the compaction event.
 */
export function formatCompactionLine(
  phase: 'before' | 'after',
  reason: CompactionReason,
  willRetry: boolean
): LogLine {
  const label = compactionReasonLabel(reason);
  const retry = willRetry ? ' — turn will be retried' : '';
  if (phase === 'before') {
    return info(`🧹 Compacting context (${label})${retry}`);
  }
  return info(`✅ Context compacted (${label})${retry}`);
}

/**
 * Format the User Prompt block, including an image-attachment count when
 * images are present. Exported for unit testing.
 */
export function formatUserPromptSection(prompt: string, images?: readonly unknown[]): LogLine[] {
  const lines: LogLine[] = [info('👤 User Prompt'), info(truncateText(prompt, 500))];
  if (images && images.length > 0) {
    lines.push(info(`  [${images.length} image(s) attached]`));
  }
  return lines;
}

/**
 * Emit an array of `LogLine`s through the given logger.
 */
function emitLogLines(logger: Logger, lines: readonly LogLine[]): void {
  for (const line of lines) {
    if (line.level === 'warning') {
      logger.warning(line.text);
    } else {
      logger.info(line.text);
    }
  }
}

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

  // fallow-ignore-next-line complexity
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
    logger.info('');
    logger.debug(
      `🔧 Tool ${event.toolName} (${event.toolCallId}) update: ${truncateText(JSON.stringify(event.partialResult), 200)}`
    );
  });

  pi.on('turn_start', async event => {
    logger.info('');
    logger.debug(`🔄 Turn ${event.turnIndex} started`);
  });

  pi.on('turn_end', async event => {
    const toolCount = event.toolResults.length;
    logger.info('');
    logger.debug(`🔄 Turn ${event.turnIndex} completed (${toolCount} tool result(s))`);
  });

  pi.on('after_provider_response', async event => {
    logger.info('');
    logger.debug(`📡 Provider response: status ${event.status}`);
  });

  // Log context-compaction lifecycle. The `reason`/`willRetry` metadata
  // (Pi v0.79.10+) lets us distinguish manual, threshold, and overflow
  // compaction flows — especially useful when auto-compaction is enabled,
  // so longer sessions that fill the context window are visible in the logs.
  pi.on('session_before_compact', async event => {
    emitLogLines(logger, [formatCompactionLine('before', event.reason, event.willRetry)]);
  });

  pi.on('session_compact', async event => {
    emitLogLines(logger, [formatCompactionLine('after', event.reason, event.willRetry)]);
  });

  pi.on('before_agent_start', async (event, ctx) => {
    logger.startGroup?.('🤖 Agent Session settings');
    logger.info(`  Running @earendil-works/pi-coding-agent@${getPiVersion()}`);
    logger.info(SECTION_SEPARATOR);

    emitLogLines(logger, formatLLMSection(ctx.model, pi.getThinkingLevel()));

    if (extensionInfo) {
      emitLogLines(logger, formatExtensionsSection(extensionInfo));
    }

    emitLogLines(logger, formatToolsSection(pi.getAllTools()));
    emitLogLines(logger, formatSystemPromptSection(ctx.getSystemPrompt()));
    emitLogLines(logger, formatUserPromptSection(event.prompt, event.images));

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

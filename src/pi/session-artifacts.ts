/**
 * @file Session artifacts collector and exporter.
 *
 * Captures structured session data (tool executions, thinking output, timing,
 * configuration, token usage) during a Pi agent run and exports it as a JSON
 * artifact for debugging and transparency.
 *
 * The collector subscribes to Pi SDK events and accumulates data in memory.
 * After the session completes, {@link exportArtifacts} writes the data to a
 * JSON file and uploads it as a GitHub Actions artifact.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CoreAdapter, SessionStats } from '../types';

/**
 * Recorded tool execution event.
 */
export interface ToolExecutionRecord {
  /** Tool name (e.g. "read", "bash", "create_pull_request") */
  name: string;
  /** Tool call ID assigned by the Pi SDK */
  callId: string;
  /** Arguments passed to the tool */
  args: Record<string, unknown>;
  /** ISO timestamp when the tool started */
  startedAt: string;
  /** ISO timestamp when the tool ended (undefined if still running) */
  endedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Whether the tool was cancelled */
  cancelled: boolean;
  /** Error message if the tool failed */
  error?: string;
  /** Truncated result summary (max 500 chars) */
  resultSummary?: string;
}

/**
 * A captured thinking delta chunk.
 */
export interface ThinkingChunk {
  /** ISO timestamp of the delta */
  timestamp: string;
  /** The thinking text delta */
  delta: string;
}

/**
 * Complete session artifacts data structure.
 */
export interface SessionArtifacts {
  /** Schema version for forward compatibility */
  schemaVersion: 1;
  /** ISO timestamp when the session started */
  sessionStartedAt: string;
  /** ISO timestamp when the session ended */
  sessionEndedAt?: string;
  /** Total session duration in milliseconds */
  durationMs?: number;
  /** Configuration used for the session */
  config: {
    provider: string;
    model: string;
    thinkingLevel: string;
  };
  /** Session statistics (token usage, cost) */
  sessionStats?: SessionStats;
  /** Number of turns completed */
  turnCount: number;
  /** Recorded tool executions in chronological order */
  toolExecutions: ToolExecutionRecord[];
  /** Captured thinking chunks (may be empty if thinking is off) */
  thinkingChunks: ThinkingChunk[];
  /** Whether the session completed successfully */
  success?: boolean;
  /** Error message if the session failed */
  error?: string;
  /** Action version */
  actionVersion?: string;
  /** Pi SDK version */
  piSdkVersion?: string;
}

/**
 * Collector that accumulates session artifact data from Pi SDK events.
 *
 * Subscribe to events via the {@link createLoggingFactory} integration in
 * the Pi extension system. After the session ends, call {@link getArtifacts}
 * to retrieve the collected data.
 */
export class SessionArtifactsCollector {
  private toolExecutions: ToolExecutionRecord[] = [];
  private thinkingChunks: ThinkingChunk[] = [];
  private turnCount = 0;
  private sessionStartedAt: string;
  private sessionEndedAt?: string;
  private success?: boolean;
  private error?: string;

  /** Track in-flight tool executions by callId for pairing start/end events */
  private pendingTools = new Map<string, ToolExecutionRecord>();

  constructor(
    private readonly config: { provider: string; model: string; thinkingLevel: string },
    private readonly core: CoreAdapter
  ) {
    this.sessionStartedAt = new Date().toISOString();
  }

  /**
   * Record a tool execution start event.
   */
  recordToolStart(name: string, callId: string, args: Record<string, unknown>): void {
    const record: ToolExecutionRecord = {
      name,
      callId,
      args,
      startedAt: new Date().toISOString(),
      success: false,
      cancelled: false,
    };
    this.pendingTools.set(callId, record);
    this.core.debug(`[artifacts] tool started: ${name} (${callId})`);
  }

  /**
   * Record a tool execution end event.
   */
  recordToolEnd(callId: string, isError: boolean, cancelled: boolean, result?: unknown): void {
    const record = this.pendingTools.get(callId);
    if (!record) {
      this.core.debug(`[artifacts] tool end without matching start: ${callId}`);
      return;
    }

    const now = new Date().toISOString();
    record.endedAt = now;
    const started = new Date(record.startedAt).getTime();
    const ended = new Date(now).getTime();
    record.durationMs = ended - started;
    record.success = !isError && !cancelled;
    record.cancelled = cancelled;

    if (isError && result) {
      record.error = truncateString(String(result), 500);
    }

    if (result !== undefined) {
      record.resultSummary = truncateString(
        typeof result === 'string' ? result : JSON.stringify(result),
        500
      );
    }

    this.pendingTools.delete(callId);
    this.toolExecutions.push(record);
    this.core.debug(
      `[artifacts] tool ended: ${record.name} (${callId}) - ${record.success ? 'ok' : 'fail'}`
    );
  }

  /**
   * Record a thinking delta chunk.
   */
  recordThinkingDelta(delta: string): void {
    this.thinkingChunks.push({
      timestamp: new Date().toISOString(),
      delta,
    });
  }

  /**
   * Record a turn completion.
   */
  recordTurnEnd(): void {
    this.turnCount++;
  }

  /**
   * Mark the session as completed successfully or with an error.
   */
  finalize(success: boolean, error?: string): void {
    this.sessionEndedAt = new Date().toISOString();
    this.success = success;
    if (error) {
      this.error = error;
    }
  }

  /**
   * Get the collected session artifacts.
   */
  getArtifacts(sessionStats?: SessionStats, actionVersion?: string): SessionArtifacts {
    const artifacts: SessionArtifacts = {
      schemaVersion: 1,
      sessionStartedAt: this.sessionStartedAt,
      config: this.config,
      turnCount: this.turnCount,
      toolExecutions: this.toolExecutions,
      thinkingChunks: this.thinkingChunks,
    };

    if (this.sessionEndedAt) {
      artifacts.sessionEndedAt = this.sessionEndedAt;
      const started = new Date(this.sessionStartedAt).getTime();
      const ended = new Date(this.sessionEndedAt).getTime();
      artifacts.durationMs = ended - started;
    }

    if (sessionStats) {
      artifacts.sessionStats = sessionStats;
    }

    if (this.success !== undefined) {
      artifacts.success = this.success;
    }

    if (this.error) {
      artifacts.error = this.error;
    }

    if (actionVersion) {
      artifacts.actionVersion = actionVersion;
    }

    return artifacts;
  }
}

/**
 * Export session artifacts to a JSON file and upload as a GitHub Actions artifact.
 *
 * @param artifacts - The session artifacts data.
 * @param core - Core adapter for logging.
 * @returns The path to the written artifacts file, or undefined if export failed.
 */
export async function exportArtifacts(
  artifacts: SessionArtifacts,
  core: CoreAdapter
): Promise<string | undefined> {
  const artifactsDir = path.join(os.tmpdir(), 'pi-session-artifacts');
  const artifactsPath = path.join(artifactsDir, 'session-artifacts.json');

  try {
    // Write JSON file
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(artifactsPath, JSON.stringify(artifacts, null, 2), 'utf-8');
    core.info(`[artifacts] session artifacts written to ${artifactsPath}`);
    core.info(
      `[artifacts] ${artifacts.toolExecutions.length} tool execution(s), ${artifacts.thinkingChunks.length} thinking chunk(s), ${artifacts.turnCount} turn(s)`
    );

    // Upload as GitHub Actions artifact
    await uploadArtifact(artifactsDir, core);

    return artifactsPath;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    core.notice(`[artifacts] failed to export session artifacts: ${msg}`);
    return undefined;
  }
}

/**
 * Upload the artifacts directory as a GitHub Actions artifact.
 */
async function uploadArtifact(artifactsDir: string, core: CoreAdapter): Promise<void> {
  try {
    const { DefaultArtifactClient } = await import('@actions/artifact');
    const client = new DefaultArtifactClient();
    await client.uploadArtifact(
      'pi-session-artifacts',
      [path.join(artifactsDir, 'session-artifacts.json')],
      artifactsDir,
      { retentionDays: 14 }
    );
    core.info('[artifacts] uploaded pi-session-artifacts artifact');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    core.notice(
      `[artifacts] failed to upload artifact (artifacts file still written locally): ${msg}`
    );
  }
}

/**
 * Truncate a string to a maximum length.
 */
function truncateString(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength) + '...';
}

/**
 * Create a logging factory that records session events into a {@link SessionArtifactsCollector}.
 *
 * This integrates with the Pi SDK's extension system to capture tool executions,
 * thinking output, and turn information.
 */
export function createArtifactsCollectorFactory(collector: SessionArtifactsCollector) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (pi: any) => {
    // Subscribe to tool execution events
    pi.on(
      'tool_execution_start',
      async (event: { toolName: string; toolCallId: string; args: Record<string, unknown> }) => {
        collector.recordToolStart(event.toolName, event.toolCallId, event.args);
      }
    );

    pi.on(
      'tool_execution_end',
      async (event: { toolCallId: string; isError: boolean; result?: any }) => {
        const cancelled = event.result?.details?.cancelled === true;
        collector.recordToolEnd(event.toolCallId, event.isError, cancelled, event.result);
      }
    );

    pi.on('turn_end', async () => {
      collector.recordTurnEnd();
    });

    // Note: thinking deltas are captured directly from the Agent class since
    // they come through the session subscribe() handler, not through extensions.
    // The Agent class will forward them to the collector.
  };
}

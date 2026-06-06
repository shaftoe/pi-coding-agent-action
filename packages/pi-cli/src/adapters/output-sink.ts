/**
 * @file CLI implementation of the orchestrator's {@link OutputSink} interface.
 *
 * Collects outputs in memory and renders them on {@link flush} according to
 * the requested mode:
 *
 * - `stdout` (default): print only the `response` field to stdout. Token
 *   counts, cost, and duration are silently dropped (they're available via
 *   `--out json` in M2).
 * - `none`: print nothing — useful when the user pipes the response into
 *   another tool.
 * - `json`: deferred to M2; declared here so the type is closed.
 *
 * Failure reporting writes a single `✖ <message>` line to stderr and sets
 * `process.exitCode = 1` so the process exits non-zero without forcing a
 * hard `process.exit()` that could truncate pending I/O.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import type { OutputSink } from '@alexanderfortin/pi-orchestrator';

/** Output rendering mode for {@link CliOutputSink.flush}. */
export type OutMode = 'stdout' | 'json' | 'none';

/**
 * CLI implementation of the orchestrator's {@link OutputSink} interface.
 *
 * Stores outputs in memory until {@link flush} is called by the command
 * handler, then renders them according to the configured mode.
 */
export class CliOutputSink implements OutputSink {
  private readonly outputs: Record<string, string | number | boolean> = {};
  private failed?: Error;

  setOutput(name: string, value: string | number | boolean): void {
    this.outputs[name] = value;
  }

  setFailed(error: Error): void {
    this.failed = error;
  }

  getExportDirectory(format: 'html' | 'jsonl'): string {
    return path.join(os.tmpdir(), `pi-cli-${format}-${process.pid}`);
  }

  /**
   * Render the collected outputs to stdout/stderr.
   *
   * Called by the CLI command handler after `orchestrator.execute()`
   * completes (or throws). Sets `process.exitCode = 1` on failure.
   */
  flush(mode: OutMode): void {
    if (this.failed) {
      process.stderr.write(`✖ ${this.failed.message}\n`);
      process.exitCode = 1;
      return;
    }
    if (mode === 'none') {
      return;
    }
    if (mode === 'json') {
      // M2 will wire this up; M1 only supports 'stdout'.
      process.stderr.write(`✖ --out json is not supported yet (M1 only supports stdout)\n`);
      process.exitCode = 1;
      return;
    }
    // stdout: only the response text, plain.
    const response = this.outputs['response'];
    if (typeof response === 'string' && response.length > 0) {
      process.stdout.write(response);
      // Ensure trailing newline if the agent didn't include one.
      if (!response.endsWith('\n')) {
        process.stdout.write('\n');
      }
    }
  }
}

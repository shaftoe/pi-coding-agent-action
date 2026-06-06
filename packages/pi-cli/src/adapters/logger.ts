/**
 * @file CLI implementation of the orchestrator's {@link Logger} interface.
 *
 * All output goes to **stderr** so it never collides with the agent's
 * response on stdout (the orchestrator's response text is the only thing
 * that should ever hit stdout when `--out stdout` is in effect).
 *
 * Level filtering uses a numeric severity ranking:
 *
 *   error   = 0  (always shown unless level === 'silent')
 *   warning = 1
 *   notice  = 2
 *   info    = 3
 *   debug   = 4
 *
 * A message is emitted iff `messageSeverity <= configuredLevel`. So:
 *
 *   - default (`warning`): only error + warning are shown
 *   - `--verbose` (`debug`): everything
 *   - `--quiet` (`error`): only errors
 *
 * Group markers (`startGroup` / `endGroup`) are passed through to stderr
 * as a simple `▸ Title` line; nested grouping is not supported (matches
 * the orchestrator's usage which only groups tool-execution logs).
 */

import type { Logger } from '@alexanderfortin/pi-orchestrator';

/** Configurable level for {@link CliLogger}. */
export type LogLevel = 'error' | 'warning' | 'notice' | 'info' | 'debug';

const SEVERITY: Record<LogLevel, number> = {
  error: 0,
  warning: 1,
  notice: 2,
  info: 3,
  debug: 4,
};

/**
 * CLI implementation of the orchestrator's {@link Logger} interface.
 *
 * Routes all output to stderr with optional level filtering. Group markers
 * are rendered as plain text headers — no ANSI sequences — so the output
 * is safe to pipe.
 */
export class CliLogger implements Logger {
  private readonly levelValue: number;

  constructor(level: LogLevel) {
    this.levelValue = SEVERITY[level];
  }

  /** True if a message at the given level would be emitted. Exposed for tests. */
  wouldEmit(level: LogLevel): boolean {
    return SEVERITY[level] <= this.levelValue;
  }

  debug(message: string): void {
    if (this.wouldEmit('debug')) {
      process.stderr.write(`[debug] ${message}\n`);
    }
  }

  info(message: string): void {
    if (this.wouldEmit('info')) {
      process.stderr.write(`${message}\n`);
    }
  }

  warning(message: string): void {
    if (this.wouldEmit('warning')) {
      process.stderr.write(`⚠ ${message}\n`);
    }
  }

  notice(message: string): void {
    if (this.wouldEmit('notice')) {
      process.stderr.write(`${message}\n`);
    }
  }

  error(message: string): void {
    // errors always emitted unless someone introduces a 'silent' level
    process.stderr.write(`✖ ${message}\n`);
  }

  startGroup?(title: string): void {
    process.stderr.write(`▸ ${title}\n`);
  }

  endGroup?(): void {
    // no-op: keep output compact for terminal use
  }
}

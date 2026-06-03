/**
 * @file Real implementation of CoreAdapter using @actions/core.
 *
 * Provides the production implementation for GitHub Actions core operations.
 * Extends the platform-neutral Logger interface with GitHub Actions-specific
 * methods (getInput, setOutput, setFailed).
 */

import * as core from '@actions/core';
import type { CoreAdapter } from '@alexanderfortin/pi-orchestrator';

/**
 * Production adapter for GitHub Actions core operations.
 *
 * Implements both the Logger interface (debug/info/warning/notice/error +
 * startGroup/endGroup) and the GitHub Actions-specific CoreAdapter methods
 * (getInput, setOutput, setFailed).
 */
export class RealCoreAdapter implements CoreAdapter {
  // ── Logger interface ──────────────────────────────────────

  debug(message: string): void {
    core.debug(message);
  }

  info(message: string): void {
    core.info(message);
  }

  warning(message: string): void {
    core.warning(message);
  }

  notice(message: string): void {
    core.notice(message);
  }

  error(message: string): void {
    core.error(message);
  }

  startGroup(title: string): void {
    core.startGroup(title);
  }

  endGroup(): void {
    core.endGroup();
  }

  // ── CoreAdapter extensions ────────────────────────────────

  getInput(name: string): string {
    return core.getInput(name);
  }

  setFailed(error: Error): void {
    core.setFailed(error);
  }

  setOutput(name: string, value: string | number | boolean): void {
    core.setOutput(name, value);
  }
}

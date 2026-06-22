/**
 * @file GitHub Actions output sink implementation.
 *
 * Implements the {@link OutputSink} interface using `@actions/core` for
 * output setting, failure reporting, and temp directory resolution.
 */

import * as core from '@actions/core';
import * as os from 'node:os';
import * as path from 'node:path';
import type { OutputSink } from '@alexanderfortin/pi-orchestrator';

/**
 * GitHub Actions implementation of the OutputSink interface.
 *
 * Uses `@actions/core` for setting outputs and reporting failures, and
 * GitHub Actions environment variables (`RUNNER_TEMP`, `GITHUB_RUN_ID`)
 * for resolving export directories.
 */
export class ActionsOutputSink implements OutputSink {
  setOutput(name: string, value: string | number | boolean): void {
    core.setOutput(name, value);
  }

  setFailed(error: Error): void {
    core.setFailed(error);
  }

  getExportDirectory(format: 'html' | 'jsonl'): string {
    return path.join(
      process.env.RUNNER_TEMP ?? os.tmpdir(),
      `pi-session-${format}-${process.env.GITHUB_RUN_ID ?? 'local'}`
    );
  }

  /**
   * Append markdown to the GitHub Actions job summary (`$GITHUB_STEP_SUMMARY`).
   *
   * Uses `@actions/core`'s `summary` helper, which appends (rather than
   * overwrites) so multiple calls compose. No-op outside a GitHub Actions
   * runner (the env var is unset).
   */
  async appendSummary(markdown: string): Promise<void> {
    await core.summary.addRaw(markdown).write();
  }
}

/**
 * @file Real implementation of CoreAdapter using @actions/core.
 *
 * Provides the production implementation for core operations.
 */

import * as core from '@actions/core';
import type { CoreAdapter } from '../types';

/**
 * Production adapter for GitHub Actions core operations.
 */
export class RealCoreAdapter implements CoreAdapter {
  getInput(name: string): string {
    return core.getInput(name);
  }

  setFailed(error: Error): void {
    core.setFailed(error);
  }

  notice(message: string): void {
    core.notice(message);
  }

  debug(message: string): void {
    core.debug(message);
  }

  info(message: string): void {
    core.info(message);
  }

  warning(message: string): void {
    core.warning(message);
  }

  setOutput(name: string, value: string): void {
    core.setOutput(name, value);
  }
}

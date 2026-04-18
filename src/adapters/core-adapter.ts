/**
 * @file Core adapter implementations.
 *
 * Provides two implementations of the {@link CoreAdapter} interface:
 *
 * - **{@link RealCoreAdapter}** – Production adapter that delegates to
 *   `@actions/core`. Used when running inside a CI environment (GitHub Actions,
 *   Forgejo Actions).
 *
 * - **{@link ConsoleCoreAdapter}** – Fallback adapter that uses `console.*`
 *   methods. Used when running outside of a CI environment (e.g., standalone
 *   mode, local development, or environments without `@actions/core`).
 */

import type { CoreAdapter } from '../types';

/**
 * Production adapter for CI environments using `@actions/core`.
 *
 * Delegates all operations to the `@actions/core` package, which provides
 * workflow commands (e.g., `::notice::`, `::debug::`) understood by
 * GitHub Actions and Forgejo Actions runners.
 */
export class RealCoreAdapter implements CoreAdapter {
  private readonly core: typeof import('@actions/core');

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.core = require('@actions/core');
  }

  getInput(name: string): string {
    return this.core.getInput(name);
  }

  setFailed(error: Error): void {
    this.core.setFailed(error);
  }

  notice(message: string): void {
    this.core.notice(message);
  }

  debug(message: string): void {
    this.core.debug(message);
  }

  info(message: string): void {
    this.core.info(message);
  }

  warning(message: string): void {
    this.core.warning(message);
  }
}

/**
 * Fallback adapter for non-CI environments using `console.*`.
 *
 * Provides the same interface as {@link RealCoreAdapter} but routes
 * all output through Node.js `console` methods. Useful for local
 * development, standalone execution, or any environment where
 * `@actions/core` is not available.
 *
 * Input values are read from `INPUT_{NAME}` environment variables,
 * matching the convention used by GitHub Actions and Forgejo Actions.
 */
export class ConsoleCoreAdapter implements CoreAdapter {
  getInput(name: string): string {
    return process.env[`INPUT_${name.toUpperCase()}`] ?? '';
  }

  setFailed(error: Error): void {
    console.error(`::error::${error.message}`);
  }

  notice(message: string): void {
    console.info(`::notice::${message}`);
  }

  debug(message: string): void {
    console.info(`[debug] ${message}`);
  }

  info(message: string): void {
    console.info(message);
  }

  warning(message: string): void {
    console.warn(`::warning::${message}`);
  }
}

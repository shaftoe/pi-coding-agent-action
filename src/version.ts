/**
 * @file Runtime version resolution.
 *
 * Replaces the former build-time constants (`__VERSION__` and
 * `__PI_CODING_AGENT_VERSION__` injected by esbuild `define`) with runtime
 * lookups that work in any environment — bundled GitHub Action, library, or
 * test runner.
 *
 * When running inside the esbuild-bundled action, the `define` entries still
 * override the `declare`d globals, so the fallback paths are never hit.
 * When running as a library or in tests (no esbuild), the functions read the
 * version from the nearest `package.json`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The project root directory, used to locate `package.json` and
 * `node_modules/`. Defaults to `process.cwd()`.
 *
 * - **Bundled action**: cwd is the workspace root where `package.json` lives.
 * - **Tests**: bun test runs from the project root.
 * - **Library**: consumers' `process.cwd()` is their project root.
 */
const projectRoot = process.cwd();

/** Cache for the action's own package version. */
let _actionVersion: string | undefined;

/** Cache for the Pi SDK package version. */
let _piVersion: string | undefined;

/**
 * Read the action's own package version at runtime.
 *
 * Resolution order:
 * 1. The esbuild-injected `__VERSION__` global (when bundled).
 * 2. The `version` field from `package.json` in the project root.
 * 3. Falls back to `'unknown'`.
 */
export function getActionVersion(): string {
  if (_actionVersion !== undefined) {
    return _actionVersion;
  }

  let version = 'unknown';

  // Check for esbuild-injected global first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.__VERSION__ === 'string') {
    version = g.__VERSION__;
  } else {
    try {
      const pkgPath = join(projectRoot, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const v: string | undefined = pkg.version;
        if (v !== undefined) {
          version = v;
        }
      }
    } catch {
      // Fall through — version stays 'unknown'
    }
  }

  _actionVersion = version;
  return version;
}

/**
 * Read the Pi SDK package version at runtime.
 *
 * Resolution order:
 * 1. The esbuild-injected `__PI_CODING_AGENT_VERSION__` global (when bundled).
 * 2. The `version` field from the Pi SDK's `package.json`.
 * 3. Falls back to `'unknown'`.
 */
export function getPiVersion(): string {
  if (_piVersion !== undefined) {
    return _piVersion;
  }

  let version = 'unknown';

  // Check for esbuild-injected global first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (typeof g.__PI_CODING_AGENT_VERSION__ === 'string') {
    version = g.__PI_CODING_AGENT_VERSION__;
  } else {
    try {
      const pkgPath = join(
        projectRoot,
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'package.json'
      );
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        const v: string | undefined = pkg.version;
        if (v !== undefined) {
          version = v;
        }
      }
    } catch {
      // Fall through — version stays 'unknown'
    }
  }

  _piVersion = version;
  return version;
}

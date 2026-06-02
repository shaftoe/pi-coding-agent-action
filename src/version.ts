/**
 * @file Runtime version resolution.
 *
 * Replaces the former build-time constants (`__VERSION__` and
 * `__PI_CODING_AGENT_VERSION__` injected by esbuild `define`) with runtime
 * lookups that work in any environment — bundled GitHub Action, library, or
 * test runner.
 *
 * When running inside the esbuild-bundled action, the `define` entries replace
 * the bare `__VERSION__` / `__PI_CODING_AGENT_VERSION__` identifiers with
 * version string literals, so the `package.json` fallback is never hit.
 * When running as a library or in tests (no esbuild), the functions read the
 * version from the nearest `package.json`.
 *
 * ⚠️  esbuild `define` only replaces **bare identifier references**, not
 * property accesses. That means `globalThis.__VERSION__` would NOT be
 * replaced — always use `__VERSION__` as a bare identifier.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Declared globals for esbuild `define` injection.
// At bundle time esbuild replaces these bare identifiers with version string
// literals. At runtime (test or library use) they are `undefined`, causing a
// fallback to package.json.
/* eslint-disable no-var */
declare var __VERSION__: string | undefined;
declare var __PI_CODING_AGENT_VERSION__: string | undefined;

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
 * 1. The esbuild-injected `__VERSION__` identifier (when bundled).
 * 2. The `version` field from `package.json` in the project root.
 * 3. Falls back to `'unknown'`.
 */
export function getActionVersion(): string {
  if (_actionVersion !== undefined) {
    return _actionVersion;
  }

  let version = 'unknown';

  // Check for esbuild-injected define first — esbuild replaces the bare
  // __VERSION__ identifier with a version-string literal at bundle time.
  if (typeof __VERSION__ !== 'undefined') {
    version = __VERSION__;
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
 * 1. The SDK package.json next to the installed SDK (in `node_modules/`).
 *    This reflects the actual runtime version, which may differ from the
 *    build-time version when `pi_version` is specified.
 * 2. The esbuild-injected `__PI_CODING_AGENT_VERSION__` identifier (when
 *    bundled, as a fallback when the SDK is not yet installed).
 * 3. The `version` field from the Pi SDK's `package.json` in the project root.
 * 4. Falls back to `'unknown'`.
 */
export function getPiVersion(): string {
  if (_piVersion !== undefined) {
    return _piVersion;
  }

  let version = 'unknown';

  // Try to read from the runtime-installed SDK.  When the action runs from
  // dist/index.js, __dirname is the dist/ directory and the SDK is installed
  // in dist/node_modules/@earendil-works/pi-coding-agent/.
  try {
    // Use require.resolve to find the SDK regardless of where node_modules is.
    // This works both when the SDK is installed via npm (in dist/node_modules)
    // and during development (in project root node_modules).
    const sdkEntry = require.resolve(
      '@earendil-works/pi-coding-agent/package.json'
    );
    const pkg = JSON.parse(readFileSync(sdkEntry, 'utf-8'));
    const v: string | undefined = pkg.version;
    if (v !== undefined) {
      version = v;
      _piVersion = version;
      return version;
    }
  } catch {
    // SDK package.json not resolvable — fall through
  }

  // Check for esbuild-injected define (the version baked in at build time).
  if (typeof __PI_CODING_AGENT_VERSION__ !== 'undefined') {
    version = __PI_CODING_AGENT_VERSION__;
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

/**
 * Clear the cached Pi version so the next call to getPiVersion() re-reads it.
 *
 * Useful in tests where the SDK install state changes between test cases.
 */
export function clearPiVersionCache(): void {
  _piVersion = undefined;
}

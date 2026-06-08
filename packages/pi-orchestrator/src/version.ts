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
 *
 * ## Version scheme
 *
 * - **Release builds** (built from a release branch like `v2`): bare semver,
 *   e.g. `2.19.3`
 * - **Development builds** (built from any other branch):
 *   `<base>-<branch>.<sha>`, e.g. `2.19.3-develop.9272858`
 * - **Local builds** (no CI env vars):
 *   `<base>-unknown.unknown`, e.g. `2.19.3-unknown.unknown`
 *
 * The suffix lives in the semver **prerelease** slot (`-`) so that
 * `2.19.3-develop.abc < 2.19.3` (correct precedence).
 *
 * See {@link formatActionVersion} for the human-readable display format.
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

// ---------------------------------------------------------------------------
// Action build info types
// ---------------------------------------------------------------------------

/**
 * Structured metadata about the action build provenance.
 *
 * When running from a released build (`isDev === false`), `branch` and `sha`
 * will be `undefined` because the bare semver contains no build metadata.
 */
export interface ActionBuildInfo {
  /** The base semver version (always the `package.json` version). */
  version: string;
  /** Whether this is a development build (not from the `v2` release branch). */
  isDev: boolean;
  /** Git branch name, if available from build metadata, or `undefined`. */
  branch: string | undefined;
  /** Short commit SHA, if available from build metadata, or `undefined`. */
  sha: string | undefined;
  /** The full composed version string (includes build metadata when dev). */
  fullVersion: string;
}

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
 * Read the `version` field from a `package.json` file, returning `undefined`
 * when the file is missing, unreadable, or has no `version` field.
 */
function readPackageVersion(pkgPath: string): string | undefined {
  try {
    if (!existsSync(pkgPath)) {
      return undefined;
    }
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const v: string | undefined = pkg.version;
    return v;
  } catch {
    return undefined;
  }
}

/**
 * Read the action's own package version at runtime.
 *
 * Returns the full composed version string, which may include a prerelease
 * segment for development builds (e.g. `2.19.3-develop.9272858`).
 *
 * For a human-readable display format, use {@link formatActionVersion}.
 * For structured build provenance data, see the {@link ActionBuildInfo} type.
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
    const pkgPath = join(projectRoot, 'package.json');
    const v = readPackageVersion(pkgPath);
    if (v !== undefined) {
      version = v;
    }
  }

  _actionVersion = version;
  return version;
}

/**
 * Parse a (possibly composed) action version string into structured build info.
 *
 * Handles these formats:
 * - `2.19.3`                      → `{ version: '2.19.3', isDev: false, ... }`
 * - `2.19.3-develop.9272858`      → `{ version: '2.19.3', isDev: true, branch: 'develop', sha: '9272858', ... }`
 * - `2.19.3-unknown.unknown`      → `{ version: '2.19.3', isDev: true, branch: 'unknown', sha: 'unknown', ... }`
 * - `unknown`                     → `{ version: 'unknown', isDev: false, ... }`
 */
// fallow-ignore-next-line complexity
function parseActionBuildInfo(fullVersion: string): ActionBuildInfo {
  if (fullVersion === 'unknown') {
    return {
      version: 'unknown',
      isDev: false,
      branch: undefined,
      sha: undefined,
      fullVersion: 'unknown',
    };
  }

  // Parse semver with optional prerelease:
  //   <semver>[-<branch>.<sha>]
  // We expect: <baseVersion>-<branch>.<sha> (prerelease format)
  const dashIndex = fullVersion.indexOf('-');

  if (dashIndex === -1) {
    // No prerelease → release build
    return { version: fullVersion, isDev: false, branch: undefined, sha: undefined, fullVersion };
  }

  const version = fullVersion.slice(0, dashIndex);
  const prerelease = fullVersion.slice(dashIndex + 1); // e.g. "develop.9272858"

  // Split on last dot: everything before is branch, last segment is sha
  const dot = prerelease.lastIndexOf('.');
  const branch = dot === -1 ? prerelease : prerelease.slice(0, dot);
  const sha = dot === -1 ? undefined : prerelease.slice(dot + 1);

  return {
    version,
    isDev: true,
    branch,
    sha,
    fullVersion,
  };
}

/**
 * Format an action version string for human-readable display (no `v` prefix —
 * callers add their own prefix when needed).
 *
 * - Release builds: `2.19.3`
 * - Development builds: `2.19.3-develop (develop @ 9272858)`
 * - Unknown: `unknown`
 *
 * When called without an argument, reads the running action's version.
 * When called with a version string, parses and formats that string.
 *
 * Callers do `v${formatActionVersion()}` to get display-ready output.
 */
// fallow-ignore-next-line complexity
export function formatActionVersion(version?: string): string {
  const info = parseActionBuildInfo(version ?? getActionVersion());

  if (!info.isDev || !info.branch || !info.sha) {
    return info.version;
  }

  return `${info.version}-${info.branch} (${info.branch} @ ${info.sha})`;
}

/**
 * Read the Pi SDK package version at runtime.
 *
 * Resolution order:
 * 1. The esbuild-injected `__PI_CODING_AGENT_VERSION__` identifier (when bundled).
 * 2. The `version` field from the Pi SDK's `package.json`.
 * 3. Falls back to `'unknown'`.
 */
export function getPiVersion(): string {
  if (_piVersion !== undefined) {
    return _piVersion;
  }

  let version = 'unknown';

  // Check for esbuild-injected define first — esbuild replaces the bare
  // __PI_CODING_AGENT_VERSION__ identifier with a version-string literal
  // at bundle time.
  if (typeof __PI_CODING_AGENT_VERSION__ !== 'undefined') {
    version = __PI_CODING_AGENT_VERSION__;
  } else {
    const pkgPath = join(
      projectRoot,
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'package.json'
    );
    const v = readPackageVersion(pkgPath);
    if (v !== undefined) {
      version = v;
    }
  }

  _piVersion = version;
  return version;
}

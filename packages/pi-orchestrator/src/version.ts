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
 * - **Release builds** (`RELEASE_BUILD=true`): bare semver, e.g. `2.19.2`
 * - **Development builds** (default): `2.19.2-dev+<branch>.<sha>`,
 *   e.g. `2.19.2-dev+develop.a1b2c3d`
 *
 * Whether a build is a release is determined **explicitly** by the
 * `RELEASE_BUILD` env var at build time (see `scripts/package.ts`), never by
 * sniffing the git branch. This avoids cross-branch dist contamination where
 * a dev-built `dist/index.js` committed on `develop` is carried to `v2`
 * via fast-forward.
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
 * Returns the full composed version string, which may include build metadata
 * for development builds (e.g. `2.19.2-dev+develop.a1b2c3d`).
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
 * - `2.19.2`                    → `{ version: '2.19.2', isDev: false, ... }`
 * - `2.19.2-dev+develop.a1b2c3d` → `{ version: '2.19.2', isDev: true, branch: 'develop', sha: 'a1b2c3d', ... }`
 * - `unknown`                   → `{ version: 'unknown', isDev: false, ... }`
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

  // Parse semver with optional pre-release and build metadata:
  //   <semver>[-<pre>][+<build>]
  // The build metadata portion uses dot-separated identifiers.
  // We expect: <baseVersion>-dev+<branch>.<sha>
  const plusIndex = fullVersion.indexOf('+');

  if (plusIndex === -1) {
    // No build metadata → release build
    return { version: fullVersion, isDev: false, branch: undefined, sha: undefined, fullVersion };
  }

  // Extract the base version (before the pre-release tag like `-dev`)
  const dashIndex = fullVersion.indexOf('-');
  const version = dashIndex > 0 ? fullVersion.slice(0, dashIndex) : fullVersion.slice(0, plusIndex);

  // Parse build metadata: <branch>.<sha>
  const buildMeta = fullVersion.slice(plusIndex + 1); // e.g. "develop.a1b2c3d"
  const parts = buildMeta.split('.');

  // Take the last part as SHA, everything before as branch
  const sha: string | undefined = parts.length > 0 ? parts[parts.length - 1] : undefined;
  const branch: string | undefined =
    parts.length > 1 ? parts.slice(0, parts.length - 1).join('.') : undefined;

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
 * - Release builds: `2.19.2`
 * - Development builds: `2.19.2-dev (develop @ a1b2c3d)`
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

  return `${info.version}-dev (${info.branch} @ ${info.sha})`;
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

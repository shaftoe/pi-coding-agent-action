/**
 * Pure helpers for the README dependency-table generator
 * (`update-readme-deps.ts`). Kept dependency-free (only `node:fs`/`node:path`
 * I/O on caller-supplied paths) so they are trivially unit-testable — see
 * `scripts/tests/update-readme-deps.spec.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PI_SDK_PACKAGE } from '../packages/pi-action/scripts/pi-sdk';

export { PI_SDK_PACKAGE };

const MARKER_START = '<!-- DEPS_TABLE_START -->';
const MARKER_END = '<!-- DEPS_TABLE_END -->';

const BADGE_MARKER_START = '<!-- PI_SDK_BADGE_START -->';
const BADGE_MARKER_END = '<!-- PI_SDK_BADGE_END -->';

/** npm URL for a package (used to link the Pi SDK summary line). */
export function npmPackageUrl(name: string): string {
  return `https://www.npmjs.com/package/${name}`;
}

export interface DepInfo {
  name: string;
  version: string;
  description: string;
}

/** Friendly descriptions for known dependencies */
const DEP_DESCRIPTIONS: Record<string, string> = {
  '@actions/core': 'GitHub Actions core I/O (inputs, outputs, logging)',
  '@actions/github': 'GitHub API client (Octokit wrapper)',
  '@earendil-works/pi-agent-core': 'Pi Agent Core — agent orchestration primitives',
  '@earendil-works/pi-ai': 'Pi AI — AI model abstractions and providers',
  '@earendil-works/pi-coding-agent': 'Pi SDK — AI coding agent runtime',
  '@js-temporal/polyfill': 'Temporal API polyfill',
  '@octokit/core': 'Octokit REST API client core',
  '@octokit/plugin-rest-endpoint-methods': 'Octokit REST API endpoint methods',
  ignore: '`.gitignore`-style pattern matching',
  typebox: 'JSON Schema Type Builder',
};

export function depDescription(name: string): string {
  return DEP_DESCRIPTIONS[name] ?? '';
}

function isWorkspaceSpec(spec: string): boolean {
  return /^workspace:/.test(spec);
}

/** Strip npm range prefixes (^, ~, =, >=, >, <=, <) and tag suffixes. */
function cleanVersion(spec: string): string {
  return spec
    .replace(/^[=~^<>]?=?\s*/, '')
    .replace(/-.*$/, '')
    .trim();
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

interface PkgJson {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Starting from the entry-point package (pi-action), recursively resolve
 * `workspace:` dependencies and collect all non-workspace dep specs that end
 * up in the esbuild bundle.
 *
 * Returns a map of dep name → declared spec + owning package dir. The owner
 * dir is needed afterwards to resolve the *installed* copy: pnpm does not
 * hoist transitive deps to the root `node_modules`, so resolution must start
 * from the package that declares the dependency.
 */
export interface DepEntry {
  spec: string;
  /** Absolute path of the workspace package that declared the dependency. */
  ownerDir: string;
}

export function collectDeclaredDeps(
  packagesDir: string,
  entryPointPkg = 'pi-action'
): Map<string, DepEntry> {
  const entryPkgPath = join(packagesDir, entryPointPkg, 'package.json');
  if (!existsSync(entryPkgPath)) {
    throw new Error(`Entry-point package not found at ${entryPkgPath}`);
  }

  const merged = new Map<string, DepEntry>();
  const visited = new Set<string>();

  function resolvePackage(pkgDirName: string): void {
    const pkgJsonPath = join(packagesDir, pkgDirName, 'package.json');
    if (!existsSync(pkgJsonPath) || visited.has(pkgDirName)) {
      return;
    }
    visited.add(pkgDirName);
    const pkgDir = dirname(pkgJsonPath);

    const pkg = readJson(pkgJsonPath) as PkgJson;

    const allDeps: Record<string, string> = {
      ...(pkg.peerDependencies ?? {}),
      ...(pkg.dependencies ?? {}),
    };

    for (const [name, spec] of Object.entries(allDeps)) {
      if (isWorkspaceSpec(spec)) {
        // Resolve workspace link → recurse into the target package
        const targetDir = name.startsWith('@') ? name.split('/').pop()! : name;
        resolvePackage(targetDir);
      } else if (!merged.has(name)) {
        merged.set(name, { spec, ownerDir: pkgDir });
      }
    }
  }

  resolvePackage(entryPointPkg);
  return merged;
}

/**
 * Resolve the on-disk `package.json` of an installed dependency by walking
 * `node_modules` directories up from the owning package — plain filesystem
 * lookups, no `import.meta.resolve` / `createRequire`, so it behaves
 * identically under ESM and CJS (tsx compiles root scripts as CJS) and
 * matches pnpm's non-hoisted layout.
 *
 * @returns The path, or `undefined` when the package isn't installed.
 */
export function resolveInstalledPackagePath(pkgName: string, ownerDir: string): string | undefined {
  let dir = ownerDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', pkgName, 'package.json');
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/**
 * Resolve the *installed* version of a dependency — the exact version esbuild
 * bundles and `getPiVersion()` stamps onto issue-comment footers — falling
 * back to the cleaned declared spec when the package isn't resolvable.
 *
 * @param name - Package name.
 * @param declaredSpec - Declared range from `package.json` (fallback source).
 * @param resolvePath - Injectable resolver (tests); defaults to a no-op
 *   (declared-spec fallback only) since installed-path lookup needs an owner
 *   dir — use {@link buildDepInfos} or wire {@link resolveInstalledPackagePath}
 *   yourself.
 */
export function resolveDepVersion(
  name: string,
  declaredSpec: string,
  resolvePath: (pkgName: string) => string | undefined = () => undefined
): { version: string; resolved: boolean } {
  const pkgJsonPath = resolvePath(name);
  if (pkgJsonPath) {
    try {
      const v = (readJson(pkgJsonPath) as { version?: string }).version;
      if (v) {
        return { version: v, resolved: true };
      }
    } catch {
      // fall through to declared spec
    }
  }
  return { version: cleanVersion(declaredSpec), resolved: false };
}

/**
 * Build the full README section (summary line + deps table) rendered between
 * the `DEPS_TABLE_*` markers.
 */
export function buildReadmeSection(deps: DepInfo[], piSdkVersion: string | undefined): string {
  const header = `| Dependency | Version | Description |`;
  const separator = `|---|---|---|`;
  const rows = deps.map(d => `| \`${d.name}\` | \`${d.version}\` | ${d.description} |`);
  const table = [header, separator, ...rows].join('\n');

  if (piSdkVersion && piSdkVersion !== 'unknown') {
    const summary =
      `This build bundles the [Pi SDK](${npmPackageUrl(PI_SDK_PACKAGE)}) ` +
      `(\`${PI_SDK_PACKAGE}\`) **v${piSdkVersion}** — the same version stamped ` +
      `on the action's issue-comment reports.`;
    return `${summary}\n\n${table}`;
  }
  return table;
}

/**
 * Splice the generated section into the README between the markers.
 * @returns The updated README content.
 * @throws when either marker is missing.
 */
export function spliceReadmeSection(readme: string, section: string): string {
  const startIdx = readme.indexOf(MARKER_START);
  const endIdx = readme.indexOf(MARKER_END);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`README.md is missing ${MARKER_START} and/or ${MARKER_END} markers`);
  }

  return (
    readme.slice(0, startIdx + MARKER_START.length) +
    '\n\n' +
    section +
    '\n\n' +
    readme.slice(endIdx)
  );
}

/**
 * Resolve the installed Pi SDK version for a workspace checkout — the same
 * version the esbuild bundler injects via `__PI_CODING_AGENT_VERSION__` and
 * `getPiVersion()` stamps onto issue-comment footers.
 *
 * @returns The version, or `undefined` when the SDK isn't installed.
 */
export function resolvePiSdkVersion(packagesDir: string): string | undefined {
  const declared = collectDeclaredDeps(packagesDir);
  const entry = declared.get(PI_SDK_PACKAGE);
  if (!entry) {
    return undefined;
  }
  const { version, resolved } = resolveDepVersion(PI_SDK_PACKAGE, entry.spec, name =>
    resolveInstalledPackagePath(name, entry.ownerDir)
  );
  return resolved ? version : undefined;
}

/**
 * Build the Pi SDK version badge for the README header (HTML `<a><img>` block,
 * wrapped in dedicated markers so it survives manual edits).
 */
export function buildSdkBadge(piSdkVersion: string): string {
  const label = `Pi%20SDK-v${piSdkVersion}`;
  const badge =
    `<a href="${npmPackageUrl(PI_SDK_PACKAGE)}">` +
    `<img alt="Pi SDK v${piSdkVersion}" src="https://img.shields.io/badge/${label}-2C8EBB?logo=pi">` +
    `</a>`;
  return badge;
}

/**
 * Splice the generated badge into the README between the badge markers.
 * @returns The updated README content.
 * @throws when either badge marker is missing.
 */
export function spliceSdkBadge(readme: string, badge: string): string {
  const startIdx = readme.indexOf(BADGE_MARKER_START);
  const endIdx = readme.indexOf(BADGE_MARKER_END);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `README.md is missing ${BADGE_MARKER_START} and/or ${BADGE_MARKER_END} markers`
    );
  }

  return (
    readme.slice(0, startIdx + BADGE_MARKER_START.length) +
    '\n  ' +
    badge +
    '\n  ' +
    readme.slice(endIdx)
  );
}

/**
 * Compose the final {@link DepInfo} list: declared specs collected from the
 * workspace graph, versions resolved from the installed tree (lockfile
 * truth), sorted by name.
 */
export function buildDepInfos(
  packagesDir: string,
  resolvePath: (
    pkgName: string,
    ownerDir: string
  ) => string | undefined = resolveInstalledPackagePath
): DepInfo[] {
  const declared = collectDeclaredDeps(packagesDir);
  return Array.from(declared.entries())
    .map(([name, entry]) => {
      const { version } = resolveDepVersion(name, entry.spec, pkgName =>
        resolvePath(pkgName, entry.ownerDir)
      );
      return { name, version, description: depDescription(name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

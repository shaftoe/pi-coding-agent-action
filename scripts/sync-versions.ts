/**
 * @file Sync versions across all workspace packages to match root package.json.
 *
 * Two concerns are kept in lockstep across every workspace package:
 *
 * 1. The package `version` field — so all packages track the root release
 *    version (driven by semantic-release).
 * 2. The `@earendil-works/*` SDK dependency specs — the pi SDK trio
 *    (`pi-agent-core`, `pi-ai`, `pi-coding-agent`) must move together across
 *    the monorepo. The root `package.json` is the single source of truth; this
 *    script propagates its `@earendil-works/*` specs into every package's
 *    `dependencies`, `devDependencies`, `optionalDependencies` and
 *    `peerDependencies`. This prevents
 *    drift where (for example) a dep bump lands in the root and action but a
 *    bridge `devDependency` is left behind, causing duplicate resolutions and
 *    peer-dependency mismatches in the lockfile.
 *
 * Run via: bun run sync-versions
 * Called by semantic-release post-version hook to keep all packages aligned.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Dependency scope whose versions are synced from the root. */
const SYNCED_SCOPE = '@earendil-works';
/** package.json fields that may hold dependency version specs. */
const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

const rootPkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = rootPkg.version;

/**
 * Map of `<scope>/<name>` -> version spec, sourced from the root package.json
 * (dependencies take precedence over devDependencies). Only packages under the
 * synced scope are considered, so unrelated deps are never touched.
 */
const syncedDeps: Record<string, string> = Object.fromEntries(
  Object.entries<string>({
    ...(rootPkg.devDependencies ?? {}),
    ...(rootPkg.dependencies ?? {}),
  }).filter(([name]) => name.startsWith(`${SYNCED_SCOPE}/`))
);

const packages = readdirSync('packages', { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

for (const pkg of packages) {
  const path = join('packages', pkg, 'package.json');
  const pkgJson = JSON.parse(readFileSync(path, 'utf-8'));
  let changed = false;

  // 1. Sync the package version field.
  if (pkgJson.version !== version) {
    pkgJson.version = version;
    changed = true;
    console.info(`↑ ${pkg} version → v${version}`);
  } else {
    console.info(`✓ ${pkg} version already at v${version}`);
  }

  // 2. Sync @earendil-works/* specs from the root into every dep field.
  for (const field of DEP_FIELDS) {
    const deps: Record<string, string> | undefined = pkgJson[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const name of Object.keys(deps)) {
      if (!(name in syncedDeps)) continue;
      const current = deps[name]!;
      const target = syncedDeps[name]!;
      if (current === target) {
        console.info(`✓ ${pkg} ${field}.${name} already at ${target}`);
        continue;
      }
      deps[name] = target;
      changed = true;
      console.info(`↑ ${pkg} ${field}.${name} ${current} → ${target}`);
    }
  }

  if (changed) {
    writeFileSync(path, JSON.stringify(pkgJson, null, 2) + '\n');
  }
}

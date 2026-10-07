/**
 * Updates the dependency versions section in README.md between
 * <!-- DEPS_TABLE_START --> and <!-- DEPS_TABLE_END --> markers.
 *
 * Collects only the dependencies that end up in dist/ by starting from the
 * pi-action package (the esbuild entry point) and recursively resolving
 * workspace: dependencies. Versions are resolved from the *installed* tree
 * (lockfile truth) — the exact versions esbuild bundles into dist/index.js
 * and `getPiVersion()` stamps onto issue-comment footers — falling back to
 * the cleaned declared spec when a package isn't resolvable.
 *
 * Pure logic lives in `readme-deps.ts` (unit-tested in
 * `scripts/tests/update-readme-deps.spec.ts`).
 *
 * Wired into the `update-readme` job in .github/workflows/develop.yml so the
 * section is refreshed whenever dist/ is rebuilt on develop.
 *
 * Usage: pnpm run update-readme
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import prettier from 'prettier';
import {
  buildDepInfos,
  buildReadmeSection,
  buildSdkBadge,
  resolvePiSdkVersion,
  spliceReadmeSection,
  spliceSdkBadge,
} from './readme-deps';

// CJS-safe script-dir resolution (tsx compiles root scripts as CJS, where
// `import.meta` is unavailable — see bump-readme-version.ts for precedent).
const scriptDir = dirname(resolve(process.argv[1] ?? '.'));
const REPO_ROOT = join(scriptDir, '..');
const README_PATH = join(REPO_ROOT, 'README.md');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

async function main(): Promise<void> {
  if (!existsSync(README_PATH)) {
    console.error(`README not found at ${README_PATH}`);
    process.exit(1);
  }

  const deps = buildDepInfos(PACKAGES_DIR);
  const piSdkVersion = resolvePiSdkVersion(PACKAGES_DIR);
  const section = buildReadmeSection(deps, piSdkVersion);

  const readme = readFileSync(README_PATH, 'utf-8');
  const updated = spliceSdkBadge(
    spliceReadmeSection(readme, section),
    buildSdkBadge(piSdkVersion ?? 'unknown')
  );

  // Format with the repo's Prettier config so generated sections land in
  // the same (table-column-padded) style as the hand-maintained parts —
  // keeps diffs minimal and the file stable across runs.
  const formatted = await prettier.format(updated, {
    ...(await prettier.resolveConfig(README_PATH)),
    filepath: README_PATH,
  });
  writeFileSync(README_PATH, formatted);

  console.info('README dependency section updated successfully.');
  console.info(`Pi SDK v${piSdkVersion ?? 'unknown'}`);
  console.info(deps.map(d => `  ${d.name}@${d.version}`).join('\n'));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

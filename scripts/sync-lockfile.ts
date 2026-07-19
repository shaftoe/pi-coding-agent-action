/**
 * @file Sync pnpm-lock.yaml after a version bump.
 *
 * semantic-release bumps the root `package.json` version
 * (`@semantic-release/npm`) and `sync-versions` propagates it into every
 * workspace `package.json`. The last artifact that needs updating is
 * `pnpm-lock.yaml`.
 *
 * Unlike the old bun.lock approach (surgical text replacement), pnpm provides
 * `--lockfile-only` which regenerates the lockfile metadata without touching
 * `node_modules` or hitting the network for already-resolved packages.
 *
 * Run via: pnpm run sync-lockfile
 * Called by the semantic-release prepareCmd, immediately after sync-versions.
 */

import { execSync } from 'node:child_process';

try {
  execSync('pnpm install --lockfile-only', { stdio: 'inherit' });
  console.info('sync-lockfile: pnpm-lock.yaml updated');
} catch (err) {
  console.error('sync-lockfile: failed to update pnpm-lock.yaml', err);
  process.exit(1);
}

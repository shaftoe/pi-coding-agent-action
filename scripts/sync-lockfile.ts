/**
 * @file Sync workspace version fields in bun.lock to the released version.
 *
 * semantic-release bumps the root `package.json` version
 * (`@semantic-release/npm`) and `sync-versions` propagates it into every
 * workspace `package.json`. The last artifact still carrying the stale
 * version is `bun.lock`, whose `workspaces` section records a `version` for
 * each workspace package.
 *
 * Rather than running a full `bun install` — which hits the network and can
 * drag unrelated dependency resolutions into the lockfile — this script
 * surgically updates *only* the workspace `version` fields. A version bump
 * changes no dependency ranges, so the resolved package set is unaffected:
 * the sole lockfile delta is the workspace versions.
 *
 * Note: `bun install` cannot be used for this purpose. When only `version`
 * fields change (no dependency-spec changes — exactly the release scenario),
 * bun considers the lockfile valid ("no changes") and leaves the workspace
 * versions stale. A dependency-spec change (e.g. in a `chore(deps)` commit) is
 * what forces a re-resolution that refreshes the lockfile as a side effect.
 *
 * Run via: bun run sync-lockfile
 * Called by the semantic-release prepareCmd, immediately after sync-versions.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const rootPkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const version = rootPkg.version;

if (!version) {
  console.error('sync-lockfile: could not determine version from package.json');
  process.exit(1);
}

const lockfile = 'bun.lock';
const content = readFileSync(lockfile, 'utf-8');

/**
 * Within the `workspaces` object each workspace entry records a `version`
 * field at 6-space indentation:
 *
 *     "packages/pi-action": {
 *       "name": "@alexanderfortin/pi-action",
 *       "version": "2.25.0",
 *
 * The root workspace ("") has no version, and the trailing `packages` map
 * embeds versions inside resolved-id strings (e.g. "@actions/core@3.0.1")
 * rather than as a standalone `"version"` key — so matching a 6-space-indented
 * `"version"` key is unambiguous.
 */
const VERSION_RE = /^      "version": "[^"]+",$/gm;

const matches = content.match(VERSION_RE);
if (!matches) {
  console.info('bun.lock: no workspace version fields found — nothing to sync');
  process.exit(0);
}

const updated = content.replace(VERSION_RE, `      "version": "${version}",`);

if (updated !== content) {
  writeFileSync(lockfile, updated);
  console.info(`bun.lock: synced ${matches.length} workspace version(s) → v${version}`);
} else {
  console.info(`bun.lock: workspace versions already at v${version}`);
}

/**
 * @file Print the structured, provenance-rich commit message for a dist rebuild.
 *
 * Composed from `package.json` + Pi SDK `package.json` + ambient CI env vars.
 * The CI dist-rebuild workflow captures this and passes it to `git commit`, so
 * every `dist/` landing on `develop` self-documents which source SHA and Pi SDK
 * version it was bundled from.
 *
 * In CI, also exports the message as the `message` workflow output (via
 * `$GITHUB_OUTPUT`) so it can be consumed across jobs if needed.
 *
 * Usage: tsx scripts/dist-commit-msg.ts
 */

import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  composeActionVersion,
  composeDistCommitMessage,
  readJsonVersion,
  resolveBranch,
} from '../packages/pi-action/scripts/version';

const baseVersion = readJsonVersion(join(process.cwd(), 'package.json'));
const branch = resolveBranch();
const fullVersion = composeActionVersion(baseVersion, branch);
const sourceSha = process.env.GITHUB_SHA ?? 'unknown';

// Resolve the Pi SDK version the same way the bundler does, so the provenance
// message matches what actually got inlined into dist/index.js.
const require = createRequire(import.meta.url);
const piPkgPath = require.resolve('@earendil-works/pi-coding-agent/package.json');
const piSdkVersion = readJsonVersion(piPkgPath);

const message = composeDistCommitMessage({ fullVersion, branch, sourceSha, piSdkVersion });

// Export as a workflow output when running inside GitHub Actions.
const ghOutput = process.env.GITHUB_OUTPUT;
if (ghOutput) {
  appendFileSync(ghOutput, `message<<EOF\n${message}\nEOF\n`);
}

console.info(message);

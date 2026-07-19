/**
 * @file Print the composed action version string for the current build.
 *
 * Derived from `package.json` + the ambient GitHub-native env vars
 * (`GITHUB_REF_NAME`, `GITHUB_SHA`). Used by the CI dist-rebuild job to assert
 * that the bundled `dist/index.js` actually carries the expected version stamp
 * (esbuild injects this exact string via the `__VERSION__` define).
 *
 * Must stay in lock-step with `packages/pi-action/scripts/package.ts`'s
 * `buildDist()`, which uses the same `composeActionVersion()` call — both read
 * the same env vars, so the produced strings match byte-for-byte.
 *
 * Usage: pnpm run dist-version
 */

import { join } from 'node:path';
import { composeActionVersion, readJsonVersion } from '../packages/pi-action/scripts/version';

const baseVersion = readJsonVersion(join(process.cwd(), 'package.json'));
console.info(composeActionVersion(baseVersion));

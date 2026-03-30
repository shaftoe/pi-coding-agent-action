/**
 * @file Version information utilities.
 *
 * Provides utilities to retrieve the action version and Pi SDK version.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Get the action version from package.json.
 *
 * @returns The action version string.
 */
export function getActionVersion(): string {
  try {
    // When bundled by esbuild, the working directory is the project root
    const packagePath = join(process.cwd(), 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version ?? 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

/**
 * Get the Pi SDK version from its package.json.
 *
 * @returns The Pi SDK version string.
 */
export function getPiSdkVersion(): string {
  try {
    // When bundled by esbuild, the working directory is the project root
    const packagePath = join(
      process.cwd(),
      'node_modules/@mariozechner/pi-coding-agent/package.json'
    );
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version ?? 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

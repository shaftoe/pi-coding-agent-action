import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { build, type Plugin } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePiSdkPackagePath } from './pi-sdk';

// Pure version/provenance helpers live in `./version` so they can be shared
// with the CI dist-rebuild scripts (and unit-tested) without pulling in esbuild.
import {
  composeActionVersion,
  composeDistCommitMessage,
  readJsonVersion,
  RELEASE_BRANCH_RE,
  resolveBranch,
  resolveSha,
  sanitizeSemverIdent,
  type DistBuildProvenance,
} from './version';

// Re-export for backward compatibility — tests import these from this module.
export {
  composeActionVersion,
  composeDistCommitMessage,
  readJsonVersion,
  RELEASE_BRANCH_RE,
  resolveBranch,
  resolveSha,
  sanitizeSemverIdent,
  type DistBuildProvenance,
};

/**
 * esbuild plugin that makes SDK extensions resolve the bundled host modules.
 *
 * The deployed GitHub Action has no runtime `node_modules`: the SDK and its Pi
 * dependencies are all inlined into `dist/index.js`. Npm extensions are loaded
 * from a temporary installation directory, where their Pi peer dependencies
 * cannot resolve back to the bundled host runtime.
 *
 * The SDK already exposes those inlined modules through `VIRTUAL_MODULES` for
 * Bun. Use the same mechanism for bundled Node.js instead of asking jiti to
 * resolve packages from the temporary npm directory. `tryNative: false` keeps
 * jiti from bypassing the map and loading a second copy from the filesystem.
 *
 * This patch can be removed once the SDK uses virtual modules for bundled Node
 * by default.
 */
const SDK_LOADER_NODE_BRANCH = /: \{ alias: getAliases\(\) \}\),/;

/** Apply the bundled Node extension-loader patch to SDK source. */
export function patchSDKLoaderSource(source: string): string {
  const patched = source.replace(
    SDK_LOADER_NODE_BRANCH,
    ': { virtualModules: VIRTUAL_MODULES, tryNative: false }),'
  );
  if (patched === source) {
    throw new Error(
      '[patch-sdk-loader] Bundled Node extension loader pattern not matched; the SDK may have changed.'
    );
  }
  return patched;
}

function patchSDKLoaderPlugin(): Plugin {
  return {
    name: 'patch-sdk-loader',
    setup(build) {
      build.onLoad({ filter: /extensions\/loader\.js$/ }, async args => ({
        contents: patchSDKLoaderSource(readFileSync(args.path, 'utf-8')),
        loader: 'js',
      }));
    },
  };
}

/**
 * Pi SDK runtime assets that must be copied to `dist/pi-sdk/` because they're
 * read by file I/O at runtime (not bundled by esbuild).
 *
 * Each tuple is `[relativeDirectory, files]` relative to the SDK `dist/` dir.
 */
const SDK_ASSETS: ReadonlyArray<readonly [string, readonly string[]]> = [
  // HTML session export templates (read by export-html/index.js)
  ['core/export-html', ['template.html', 'template.css', 'template.js']],
  // Vendor libs for HTML export (read by export-html/index.js)
  ['core/export-html/vendor', ['marked.min.js', 'highlight.min.js']],
  // Built-in theme definitions (read by theme/theme.js via getThemesDir())
  ['modes/interactive/theme', ['dark.json', 'light.json']],
];

/**
 * Copy a single SDK asset directory, creating the destination as needed and
 * silently skipping missing source files. Exported for unit testing.
 */
export function copySdkAssetDir(
  srcDir: string,
  destDir: string,
  files: readonly string[]
): void {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const file of files) {
    const src = join(srcDir, file);
    if (existsSync(src)) {
      copyFileSync(src, join(destDir, file));
    }
  }
}

/**
 * Copy the minimal set of Pi SDK runtime assets to the destination directory.
 * Exported for unit testing.
 */
export function copyAllSdkAssets(sdkDistDir: string, piSdkDest: string): void {
  for (const [relDir, files] of SDK_ASSETS) {
    copySdkAssetDir(join(sdkDistDir, relDir), join(piSdkDest, relDir), files);
  }
}

export async function buildDist(cwd: string = process.cwd()): Promise<void> {
  const baseVersion = readJsonVersion(join(cwd, 'package.json'));
  const version = composeActionVersion(baseVersion);

  // Resolve the Pi SDK package.json via the shared helper (see pi-sdk.ts).
  const piPkgPath = resolvePiSdkPackagePath();
  const piVersion = readJsonVersion(piPkgPath);

  const branch = process.env.GITHUB_REF_NAME ?? 'unknown';
  const sha = (process.env.GITHUB_SHA ?? 'unknown').slice(0, 7);
  console.log(
    `[package] Building action v${version} (base: ${baseVersion}, branch: ${branch}, sha: ${sha})`
  );

  await build({
    entryPoints: [join(cwd, 'packages/pi-action/src/run.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    outfile: join(cwd, 'dist/index.js'),
    format: 'cjs',
    minify: true,
    plugins: [patchSDKLoaderPlugin()],
    define: {
      'import.meta.url': 'importMetaUrl',
      __PI_CODING_AGENT_VERSION__: JSON.stringify(piVersion),
      __VERSION__: JSON.stringify(version),
    },
    inject: [join(cwd, 'packages/pi-action/src/import-meta-url.js')],
  });

  // Clean previous SDK assets before copying the minimal set
  const piSdkDir = join(cwd, 'dist/pi-sdk');
  if (existsSync(piSdkDir)) {
    rmSync(piSdkDir, { recursive: true, force: true });
  }

  // Copy only the Pi SDK assets that are read at runtime via getPackageDir().
  // The JS code is already fully inlined by esbuild — only non-code assets
  // (templates, vendor libs, theme JSON) need to be present on disk so the
  // SDK's file I/O can find them when PI_PACKAGE_DIR points to dist/pi-sdk/.
  copyAllSdkAssets(join(dirname(piPkgPath), 'dist'), join(cwd, 'dist/pi-sdk/dist'));
}

// If run directly, execute the build
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  buildDist().catch(error => {
    console.error('Build failed:', error);
    process.exit(1);
  });
}

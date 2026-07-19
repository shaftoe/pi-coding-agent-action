import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * esbuild plugin that patches the SDK's `getAliases()` function to handle
 * the bundled action context.
 *
 * In the deployed GitHub Action, `node_modules` doesn't exist — everything
 * is bundled into `dist/index.js`. The SDK's `getAliases()` calls
 * `require.resolve("typebox")` which throws `MODULE_NOT_FOUND` in this
 * context, causing jiti creation to fail and preventing extension loading.
 *
 * This plugin wraps the body of `getAliases()` in a try-catch so that if
 * `require.resolve` fails, the function returns an empty aliases object.
 * Extensions that only use `import type` (which are erased by jiti) will
 * still load correctly without any aliases.
 *
 * This patch can be removed once the SDK handles the bundled context natively.
 */
function patchSDKLoaderPlugin(): Plugin {
  return {
    name: 'patch-sdk-loader',
    setup(build) {
      build.onLoad({ filter: /extensions\/loader\.js$/ }, async args => {
        const source = readFileSync(args.path, 'utf-8');

        // Wrap getAliases() body in try-catch to handle missing node_modules
        const patched = source
          .replace(
            // Match the start of getAliases() and inject a try { after the early return
            /function getAliases\(\) \{\s*\n(\s*if \(_aliases\)\s*\n\s*return _aliases;\s*\n)/,
            'function getAliases() {\n$1    try {\n'
          )
          .replace(
            // Match _aliases assignment + return + function closing brace, insert catch block
            /(_aliases = \{[^}]+\};\s*\n)(\s*return _aliases;\s*\n)(\})/,
            '$1    $2    } catch { _aliases = {}; return _aliases; }\n$3'
          );

        if (patched === source) {
          console.warn(
            '[patch-sdk-loader] WARNING: getAliases() pattern not matched — patch not applied. ' +
              'The SDK may have changed. Extension loading may fail in the bundled action.'
          );
          return { contents: source, loader: 'js' };
        }

        return { contents: patched, loader: 'js' };
      });
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

  // Resolve Pi SDK path dynamically. We can't use `require.resolve('.../package.json')`
  // because the Pi SDK's `exports` map doesn't expose it (and pnpm enforces
  // `exports` strictly). The package also only has an `import` export
  // condition (no `require`), so CJS require.resolve fails entirely. We use
  // `import.meta.resolve` (ESM) which honours the `import` condition, then
  // walk up to the nearest package.json.
  const piMainUrl = import.meta.resolve('@earendil-works/pi-coding-agent');
  let piDir = dirname(fileURLToPath(piMainUrl));
  while (!existsSync(join(piDir, 'package.json'))) {
    const parent = dirname(piDir);
    if (parent === piDir) {
      throw new Error('Could not locate @earendil-works/pi-coding-agent/package.json');
    }
    piDir = parent;
  }
  const piPkgPath = join(piDir, 'package.json');
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

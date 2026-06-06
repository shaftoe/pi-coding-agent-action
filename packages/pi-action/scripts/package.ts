import fs, { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'esbuild';
import { join, dirname } from 'node:path';
import git from 'isomorphic-git';

/**
 * Result of reading git metadata at build time.
 */
interface GitBuildMetadata {
  /** Git branch name, or `'unknown'` if unavailable. */
  branch: string;
  /** Short (7-char) commit SHA, or `'unknown'` if unavailable. */
  sha: string;
}

/**
 * Pure formatter for git-build metadata. Coerces nullable inputs to
 * `'unknown'` and truncates the head commit SHA to 7 characters.
 *
 * Exported for unit testing.
 */
export function formatGitMetadata(
  branch: string | null | void,
  headOid: string | undefined
): GitBuildMetadata {
  return {
    branch: branch ?? 'unknown',
    sha: (headOid ?? 'unknown').slice(0, 7),
  };
}

/**
 * Resolve the git branch and short commit SHA using `isomorphic-git`.
 *
 * Uses the pure-JS git implementation instead of shelling out to the `git`
 * CLI, so it works reliably even in environments where the git binary has
 * restricted permissions (e.g. some CI runner setups).
 *
 * Falls back to `{ branch: 'unknown', sha: 'unknown' }` when the current
 * directory is not a git repository or any other error occurs.
 */
async function getGitBuildMetadata(dir: string): Promise<GitBuildMetadata> {
  try {
    const [branch, log] = await Promise.all([
      git.currentBranch({ fs, dir }),
      git.log({ fs, dir, depth: 1 }),
    ]);
    return formatGitMetadata(branch, log[0]?.oid);
  } catch {
    return { branch: 'unknown', sha: 'unknown' };
  }
}

/**
 * Resolve git metadata for the build, returning `'unknown'` placeholders when
 * `cwd` is not a git checkout (no `.git` directory). Exported for unit testing.
 */
export async function resolveGitMeta(cwd: string): Promise<GitBuildMetadata> {
  if (!existsSync(join(cwd, '.git'))) {
    return { branch: 'unknown', sha: 'unknown' };
  }
  return getGitBuildMetadata(cwd);
}

/**
 * Sanitize a string for use in semver build metadata.
 *
 * Semver build metadata allows only `[0-9a-zA-Z-]` plus `.` separators.
 * Characters like `/` in branch names (e.g. `feature/foo`) are replaced with `-`.
 */
function sanitizeSemverIdent(ident: string): string {
  return ident.replace(/[^0-9a-zA-Z-]/g, '-');
}

/**
 * Compose the action version string.
 *
 * - **Release builds** (`isRelease === true`): bare semver, e.g. `2.19.3`.
 * - **Dev builds**: `<baseVersion>-dev+<branch>.<sha>` using semver build metadata
 *   syntax, e.g. `2.19.3-dev+develop.a1b2c3d`.
 *
 * Whether a build is a release is determined **explicitly** by the caller (via
 * the `RELEASE_BUILD` env var, see {@link buildDist}) — never by sniffing the
 * git branch. This avoids the cross-branch dist-contamination problem where
 * a dev-built `dist/index.js` committed on `develop` gets carried to `v2`
 * via fast-forward and persists when semantic-release finds no new release.
 *
 * Exported for unit testing.
 */
export function composeActionVersion(
  baseVersion: string,
  meta: GitBuildMetadata,
  isRelease: boolean
): string {
  if (isRelease) {
    return baseVersion;
  }
  const branch = sanitizeSemverIdent(meta.branch);
  const sha = sanitizeSemverIdent(meta.sha);
  return `${baseVersion}-dev+${branch}.${sha}`;
}

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
 * Read the `version` field from a JSON file at `path`. Throws if the file
 * is missing, unreadable, or its JSON lacks a `version` field.
 *
 * Exported for unit testing.
 */
export function readJsonVersion(path: string): string {
  return JSON.parse(readFileSync(path, 'utf-8')).version;
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

  // Release vs dev is determined explicitly via the RELEASE_BUILD env var —
  // never by sniffing the git branch. This is set by the release/promote
  // workflows and by the semantic-release prepareCmd. When unset (default,
  // e.g. the develop package.yml workflow or local builds), a dev version is
  // produced with git build metadata.
  const isRelease = process.env.RELEASE_BUILD === 'true';
  const gitMeta = await resolveGitMeta(cwd);
  const version = composeActionVersion(baseVersion, gitMeta, isRelease);

  // Resolve Pi SDK path dynamically — in Bun workspaces, deps are hoisted to root node_modules,
  // but the prepare lifecycle may run before the full tree is materialized.
  const require = createRequire(import.meta.url);
  const piPkgPath = require.resolve('@earendil-works/pi-coding-agent/package.json');
  const piVersion = readJsonVersion(piPkgPath);

  const buildType = isRelease ? 'release' : 'dev';
  console.log(
    `[package] Building action v${version} (${buildType}, base: ${baseVersion}, branch: ${gitMeta.branch}, sha: ${gitMeta.sha})`
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
// Bun sets isMain property on the module
// @ts-expect-error - Bun runtime property
if (import.meta.main || process.argv[1].endsWith('/package.ts')) {
  buildDist().catch(error => {
    console.error('Build failed:', error);
    process.exit(1);
  });
}

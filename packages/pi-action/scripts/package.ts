import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'esbuild';
import { join, dirname } from 'node:path';

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

export async function buildDist(cwd: string = process.cwd()): Promise<void> {
  const version = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')).version;

  // Resolve Pi SDK path dynamically — in Bun workspaces, deps are hoisted to root node_modules,
  // but the prepare lifecycle may run before the full tree is materialized.
  const require = createRequire(import.meta.url);
  const piPkgPath = require.resolve('@earendil-works/pi-coding-agent/package.json');
  const piVersion = JSON.parse(readFileSync(piPkgPath, 'utf-8')).version;

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
  //
  // Asset map: SDK source -> destination under dist/pi-sdk/dist/
  const sdkDistDir = join(dirname(piPkgPath), 'dist');
  const piSdkDest = join(cwd, 'dist/pi-sdk/dist');
  const sdkAssets: [string, string[]][] = [
    // HTML session export templates (read by export-html/index.js)
    ['core/export-html', ['template.html', 'template.css', 'template.js']],
    // Vendor libs for HTML export (read by export-html/index.js)
    ['core/export-html/vendor', ['marked.min.js', 'highlight.min.js']],
    // Built-in theme definitions (read by theme/theme.js via getThemesDir())
    ['modes/interactive/theme', ['dark.json', 'light.json']],
  ];
  for (const [relDir, files] of sdkAssets) {
    const srcDir = join(sdkDistDir, relDir);
    const destDir = join(piSdkDest, relDir);
    if (existsSync(srcDir)) {
      mkdirSync(destDir, { recursive: true });
      for (const file of files) {
        const src = join(srcDir, file);
        if (existsSync(src)) {
          copyFileSync(src, join(destDir, file));
        }
      }
    }
  }
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

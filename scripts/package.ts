import { existsSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
import { join } from 'node:path';

/**
 * Generate the banner that installs the Pi SDK at the requested version
 * before the main bundle loads.
 *
 * The banner is prepended to the CJS bundle and runs synchronously before
 * any `require()` calls. It:
 *
 * 1. Reads the `pi_version` input from the `INPUT_PI_VERSION` env var
 *    (set by the GitHub Actions runner for the `pi_version` action input).
 * 2. Falls back to the version baked in at build time
 *    (`__DEFAULT_PI_VERSION__`).
 * 3. Checks if the SDK is already installed at the target version.
 * 4. If not, installs it via `npm install` in the bundle's directory.
 *
 * This approach lets the user choose any Pi SDK version while keeping the
 * default case fast (already-installed check is a single JSON read).
 */
function generateInstallBanner(defaultPiVersion: string): string {
  return `(function(){var v=process.env.INPUT_PI_VERSION||${JSON.stringify(defaultPiVersion)};if(!v)return;var fs=require("fs"),path=require("path"),cp=require("child_process"),p=path.join(__dirname,"node_modules","@earendil-works","pi-coding-agent","package.json");try{var pkg=JSON.parse(fs.readFileSync(p,"utf-8"));if(pkg.version===v)return}catch(e){}try{cp.execSync("npm install --no-save --no-audit --no-fund @earendil-works/pi-coding-agent@"+v,{cwd:__dirname,stdio:"pipe",timeout:120000})}catch(e){var msg=e.stderr?e.stderr.toString():e.message;console.error("Failed to install Pi SDK v"+v+": "+msg);process.exit(1)}})();`;
}

export async function buildDist(cwd: string = process.cwd()): Promise<void> {
  const version = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')).version;
  const piVersion = JSON.parse(
    readFileSync(join(cwd, 'node_modules/@earendil-works/pi-coding-agent/package.json'), 'utf-8')
  ).version;

  await build({
    entryPoints: [join(cwd, 'src/run.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    outfile: join(cwd, 'dist/index.js'),
    format: 'cjs',
    minify: true,
    // Mark the Pi SDK as external so it is loaded at runtime via require().
    // The banner (above) installs it before the first require() call.
    // Node.js 24 supports require() for ESM modules natively, so this works
    // even though the SDK package has "type": "module".
    external: ['@earendil-works/pi-coding-agent'],
    banner: {
      js: generateInstallBanner(piVersion),
    },
    define: {
      'import.meta.url': 'importMetaUrl',
      __PI_CODING_AGENT_VERSION__: JSON.stringify(piVersion),
      __VERSION__: JSON.stringify(version),
    },
    inject: [join(cwd, 'src/import-meta-url.js')],
  });

  // Clean previous SDK assets — they are no longer needed because the SDK
  // is now installed via npm with all its assets in node_modules.
  const piSdkDir = join(cwd, 'dist/pi-sdk');
  if (existsSync(piSdkDir)) {
    rmSync(piSdkDir, { recursive: true, force: true });
  }
}

// If run directly, execute the build
// Bun sets isMain property on the module
// @ts-ignore - Bun runtime property
if (import.meta.main || process.argv[1].endsWith('/package.ts')) {
  buildDist().catch(error => {
    console.error('Build failed:', error);
    process.exit(1);
  });
}

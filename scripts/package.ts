import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { build } from 'esbuild';
import { join } from 'node:path';

/**
 * Recursively copy a directory and its contents.
 */
function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

export async function buildDist(cwd: string = process.cwd()): Promise<void> {
  const version = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8')).version;
  const piVersion = JSON.parse(
    readFileSync(join(cwd, 'node_modules/@mariozechner/pi-coding-agent/package.json'), 'utf-8')
  ).version;

  await build({
    entryPoints: [join(cwd, 'src/run.ts')],
    bundle: true,
    platform: 'node',
    target: 'node24',
    outfile: join(cwd, 'dist/index.js'),
    format: 'cjs',
    minify: true,
    define: {
      'import.meta.url': 'importMetaUrl',
      __PI_CODING_AGENT_VERSION__: JSON.stringify(piVersion),
      __VERSION__: JSON.stringify(version),
    },
    inject: [join(cwd, 'src/import-meta-url.js')],
  });

  // Copy the Pi SDK's dist/ directory into dist/pi-sdk/dist/ so runtime asset
  // reads (templates, themes, etc.) work in the bundled action. The SDK's
  // getPackageDir() walks up from __dirname to find package.json, but in the
  // bundle it finds the action's package.json. At runtime we set PI_PACKAGE_DIR
  // to dist/pi-sdk/ so the SDK locates its own assets correctly.
  const sdkDistDir = join(cwd, 'node_modules/@mariozechner/pi-coding-agent/dist');
  const destDir = join(cwd, 'dist/pi-sdk/dist');
  if (existsSync(sdkDistDir)) {
    copyDirRecursive(sdkDistDir, destDir);
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

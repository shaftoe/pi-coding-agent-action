import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
import { join } from 'node:path';

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
  const sdkDistDir = join(cwd, 'node_modules/@mariozechner/pi-coding-agent/dist');
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
// @ts-ignore - Bun runtime property
if (import.meta.main || process.argv[1].endsWith('/package.ts')) {
  buildDist().catch(error => {
    console.error('Build failed:', error);
    process.exit(1);
  });
}

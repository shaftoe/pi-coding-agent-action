/**
 * Tests that verify the bedrock provider is correctly bundled into the
 * action's dist artifact.
 *
 * The pi-ai SDK lazily loads the bedrock implementation through a
 * variable-specifier dynamic import (deliberately hidden from bundlers).
 * Without explicit static registration via `setBedrockProviderModule()`,
 * the dynamic import resolves to a non-existent file at runtime — the bug
 * reported in #398 ("Cannot find module '.../dist/bedrock-converse-stream.js'").
 *
 * These tests guard against regression by checking that:
 * 1. The source (`run.ts`) imports and registers the bedrock provider.
 * 2. The built `dist/index.js` includes the AWS Bedrock SDK and the
 *    `setBedrockProviderModule` registration call.
 */

import { describe, expect, test } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '..', '..', '..', 'dist', 'index.js');
const runTsPath = join(__dirname, '..', 'src', 'run.ts');

describe('bedrock provider bundling (#398)', () => {
  test('run.ts statically imports and registers the bedrock provider module', () => {
    const source = readFileSync(runTsPath, 'utf-8');

    // The static import pulls the AWS SDK into the bundle (esbuild can follow
    // the string-literal import in bedrock-provider.js).
    expect(source).toMatch(/from ['"]@earendil-works\/pi-ai\/bedrock-provider['"]/);
    expect(source).toMatch(/from ['"]@earendil-works\/pi-ai\/compat['"]/);

    // The registration call must be present so the lazy wrapper uses the
    // statically bundled module instead of the (non-existent) dynamic import.
    expect(source).toMatch(/setBedrockProviderModule\s*\(/);
  });

  test('built dist/index.js contains the AWS Bedrock SDK', () => {
    if (!existsSync(distPath)) {
      // dist/ is built by `pnpm run package` (the `prepare` script). In CI it
      // always exists; skip locally if the user hasn't built yet.
      test.skip('dist/index.js not built — run `pnpm run package` first');
      return;
    }

    const bundle = readFileSync(distPath, 'utf-8');

    // Core AWS SDK symbols that the bedrock stream implementation uses.
    expect(bundle).toContain('BedrockRuntimeClient');
    expect(bundle).toContain('ConverseStreamCommand');
  });

  test('built dist/index.js contains the setBedrockProviderModule registration', () => {
    if (!existsSync(distPath)) {
      test.skip('dist/index.js not built — run `pnpm run package` first');
      return;
    }

    const bundle = readFileSync(distPath, 'utf-8');

    // The registration function must be present in the bundle.
    expect(bundle).toContain('setBedrockProviderModule');
  });
});

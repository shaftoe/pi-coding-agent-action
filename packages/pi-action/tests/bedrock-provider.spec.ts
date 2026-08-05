/**
 * Tests for bedrock provider bundling & registration (#398).
 *
 * Background: the @earendil-works/pi-ai SDK lazily loads the bedrock
 * implementation through a variable-specifier dynamic import (deliberately
 * hidden from bundlers). Without explicit static registration via
 * `setBedrockProviderModule()`, the dynamic import resolves to a non-existent
 * file at runtime — the bug reported in #398
 * ("Cannot find module '.../dist/bedrock-converse-stream.js'").
 *
 * These tests guard against regression by verifying that:
 *  1. `run.ts` statically imports and registers the bedrock provider (source).
 *  2. The built `dist/index.js` bundles the AWS Bedrock SDK + registration.
 *  3. At runtime `run()` actually invokes `setBedrockProviderModule()` — which
 *     also covers the registration lines in `run.ts` for Codecov.
 */

import { describe, expect, test, vi, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const runTsPath = join(__dirname, '..', 'src', 'run.ts');
const distPath = join(repoRoot, 'dist', 'index.js');

// ---------------------------------------------------------------------------
// 1. Source wiring (no build required)
// ---------------------------------------------------------------------------

describe('bedrock provider source wiring (#398)', () => {
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
});

// ---------------------------------------------------------------------------
// 2. Built bundle (requires `pnpm run package` / the `prepare` script)
//
// `describe.skipIf` (NOT `test.skip()` inside the test body) gracefully skips
// the whole group when the bundle hasn't been built yet. Calling
// `test.skip()` inside an already-running test throws in Vitest
// ("Calling the test function inside another test function is not allowed").
// ---------------------------------------------------------------------------

describe.skipIf(!existsSync(distPath))('built dist/index.js bundles the bedrock provider', () => {
  test('inlines the AWS Bedrock SDK', () => {
    const bundle = readFileSync(distPath, 'utf-8');

    // Core AWS SDK symbols that the bedrock stream implementation uses.
    expect(bundle).toContain('BedrockRuntimeClient');
    expect(bundle).toContain('ConverseStreamCommand');
  });

  test('contains the setBedrockProviderModule registration', () => {
    const bundle = readFileSync(distPath, 'utf-8');

    // The registration function must be present in the bundle.
    expect(bundle).toContain('setBedrockProviderModule');
  });
});

// ---------------------------------------------------------------------------
// 3. Runtime registration (covers run.ts -> ensureBedrockProviderRegistered)
//
// `run.ts` auto-executes `run()` at module load. We mock `@actions/core` so
// that `getInput` returns '' for everything: `gatherActionsConfig()` then
// throws "Missing required input: provider" — but only AFTER `run()` has
// already invoked `ensureBedrockProviderRegistered()` (the lines under test).
// The mocked `setFailed` swallows the failure so it never pollutes
// `process.exitCode`. The mocked SDK modules let us assert the registration
// call without pulling in the (heavy) AWS SDK.
// ---------------------------------------------------------------------------

const { setBedrockProviderModule, bedrockProviderModule } = vi.hoisted(() => ({
  // Spy so we can assert it was called with the bedrock module.
  setBedrockProviderModule: vi.fn(),
  // Stand-in for the real (AWS-SDK-backed) provider module.
  bedrockProviderModule: { __bedrockProviderModule: true },
}));

vi.mock('@earendil-works/pi-ai/compat', () => ({ setBedrockProviderModule }));
vi.mock('@earendil-works/pi-ai/bedrock-provider', () => ({ bedrockProviderModule }));

vi.mock('@actions/core', () => {
  const noop = (): void => undefined;
  return {
    // No provider/model inputs → gatherActionsConfig() throws early.
    getInput: (): string => '',
    setFailed: noop,
    setOutput: noop,
    setSecret: noop,
    exportVariable: noop,
    debug: noop,
    info: noop,
    warning: noop,
    notice: noop,
    error: noop,
    startGroup: noop,
    endGroup: noop,
    summary: { addRaw: () => ({ write: noop }) },
  };
});

// run()'s auto-execution logs an "Unhandled error in run()" via console.error
// when it (intentionally) throws at gatherActionsConfig(). Silence it so CI
// logs stay clean; restore afterwards.
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

describe('bedrock provider runtime registration (#398)', () => {
  let savedPkgDir: string | undefined;

  beforeAll(async () => {
    savedPkgDir = process.env.PI_PACKAGE_DIR;
    // Importing run.ts triggers its top-level `run()` — which executes (and
    // covers) ensurePackageDirOverride() + ensureBedrockProviderRegistered()
    // before throwing at gatherActionsConfig().
    await import('../src/run');
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
    if (savedPkgDir === undefined) {
      delete process.env.PI_PACKAGE_DIR;
    } else {
      process.env.PI_PACKAGE_DIR = savedPkgDir;
    }
  });

  test('ensureBedrockProviderRegistered() registers the bedrock provider module', () => {
    // The lazy wrapper checks the override first (`override ?? dynamicImport`),
    // so registering here means the broken dynamic import is never reached.
    expect(setBedrockProviderModule).toHaveBeenCalledWith(bedrockProviderModule);
  });
});

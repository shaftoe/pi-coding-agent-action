/**
 * Regression tests for the build-time SDK loader patch (patchSDKLoaderPlugin).
 *
 * The deployed GitHub Action has no runtime `node_modules` — Pi and its runtime
 * dependencies are bundled into `dist/index.js`. Npm extensions are installed
 * in a temporary directory, so their Pi peer dependencies cannot be resolved
 * from that directory. The patch makes jiti use the SDK's bundled VIRTUAL_MODULES
 * map instead, preserving the host runtime's module identity.
 *
 * These tests verify that:
 * 1. The SDK's bundled Node loader branch still matches the patch pattern
 * 2. The patch replaces it with virtual-module resolution and fails closed when it changes
 * 3. A temporary extension can import the Pi peer packages from the host runtime
 *
 * If these tests fail after a Pi SDK upgrade, the loader patch or its test paths
 * need to be updated to match the new SDK layout and loading behavior.
 */

import { describe, expect, test } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { patchSDKLoaderSource } from '../../../pi-action/scripts/package';

function getLoaderPath(): string {
  return join(
    process.cwd(),
    'node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js'
  );
}

function getSdkPackagePath(): string {
  const loaderPath = realpathSync(getLoaderPath());
  return dirname(dirname(dirname(dirname(loaderPath))));
}

describe('SDK bundled extension loader patch', () => {
  test('loader.js exists at expected path', () => {
    expect(existsSync(getLoaderPath())).toBe(true);
  });

  test('replaces the bundled Node branch with host virtual modules', () => {
    const source = readFileSync(getLoaderPath(), 'utf-8');
    const patched = patchSDKLoaderSource(source);

    expect(patched).toContain('{ virtualModules: VIRTUAL_MODULES, tryNative: false })');
    expect(patched).not.toContain(': { alias: getAliases() }),');
  });

  test('fails when the SDK loader pattern changes', () => {
    const source = readFileSync(getLoaderPath(), 'utf-8').replace(
      'alias: getAliases()',
      'alias: changed()'
    );

    expect(() => patchSDKLoaderSource(source)).toThrow('loader pattern not matched');
  });

  test('loads peer imports from the host runtime through virtual modules', async () => {
    const sdkPackagePath = getSdkPackagePath();
    const hostDir = mkdtempSync(join(sdkPackagePath, '.pi-extension-host-'));
    const hostPath = join(hostDir, 'index.mjs');

    writeFileSync(
      hostPath,
      [
        "import * as codingAgent from '@earendil-works/pi-coding-agent';",
        "import * as agentCore from '@earendil-works/pi-agent-core';",
        "import * as piAi from '@earendil-works/pi-ai/compat';",
        "import * as piAiOauth from '@earendil-works/pi-ai/oauth';",
        "import * as piAiProviders from '@earendil-works/pi-ai/providers/all';",
        "import * as piTui from '@earendil-works/pi-tui';",
        "import * as typebox from 'typebox';",
        "import * as typeboxCompile from 'typebox/compile';",
        "import * as typeboxValue from 'typebox/value';",
        "import { createJiti } from 'jiti/static';",
        'export { codingAgent, agentCore, piAi, piAiOauth, piAiProviders, piTui, typebox, typeboxCompile, typeboxValue, createJiti };',
      ].join('\n')
    );

    try {
      const {
        createJiti,
        codingAgent,
        agentCore,
        piAi,
        piAiOauth,
        piAiProviders,
        piTui,
        typebox,
        typeboxCompile,
        typeboxValue,
      } = await import(`${pathToFileURL(hostPath).href}?test=${Date.now()}`);
      const virtualModules = {
        typebox,
        'typebox/compile': typeboxCompile,
        'typebox/value': typeboxValue,
        '@earendil-works/pi-agent-core': agentCore,
        '@earendil-works/pi-tui': piTui,
        '@earendil-works/pi-ai': piAi,
        '@earendil-works/pi-ai/compat': piAi,
        '@earendil-works/pi-ai/oauth': piAiOauth,
        '@earendil-works/pi-ai/providers/all': piAiProviders,
        '@earendil-works/pi-coding-agent': codingAgent,
      };
      const extensionDir = mkdtempSync(join(tmpdir(), 'pi-extension-'));
      const extensionPath = join(extensionDir, 'index.ts');

      writeFileSync(
        extensionPath,
        [
          "import { AgentSession } from '@earendil-works/pi-coding-agent';",
          "import { Agent } from '@earendil-works/pi-agent-core';",
          "import { EventStream } from '@earendil-works/pi-ai';",
          "import { EventStream as CompatEventStream } from '@earendil-works/pi-ai/compat';",
          "import * as oauth from '@earendil-works/pi-ai/oauth';",
          "import { builtinProviders } from '@earendil-works/pi-ai/providers/all';",
          "import { Box } from '@earendil-works/pi-tui';",
          "import { Type } from 'typebox';",
          "import { Compile } from 'typebox/compile';",
          "import { Check } from 'typebox/value';",
          'export default () => ({ AgentSession, Agent, EventStream, CompatEventStream, oauth, builtinProviders, Box, Type, Compile, Check });',
        ].join('\n')
      );

      try {
        const jiti = createJiti(import.meta.url, {
          moduleCache: false,
          virtualModules,
          tryNative: false,
        });
        const factory = (await jiti.import(extensionPath, { default: true })) as () => Record<
          string,
          unknown
        >;
        const loaded = factory();

        expect(loaded.AgentSession).toBe(codingAgent.AgentSession);
        expect(loaded.Agent).toBe(agentCore.Agent);
        expect(loaded.EventStream).toBe(piAi.EventStream);
        expect(loaded.CompatEventStream).toBe(piAi.EventStream);
        expect(loaded.builtinProviders).toBe(piAiProviders.builtinProviders);
        expect(loaded.Box).toBe(piTui.Box);
        expect(loaded.Type).toBe(typebox.Type);
        expect(loaded.Compile).toBe(typeboxCompile.Compile);
        expect(loaded.Check).toBe(typeboxValue.Check);
        expect(loaded.oauth).toBeDefined();
      } finally {
        rmSync(extensionDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });
});

/**
 * E2E tests for custom provider registered via extension.
 *
 * These tests verify the full integration path:
 *   extension loads → provider registers → model found → LLM call succeeds
 *
 * This guards against regressions where the bundled action fails to load
 * extensions (e.g. because getAliases() crashes on missing node_modules)
 * or where model resolution runs before extensions have registered their
 * providers.
 *
 * Required environment variables (all three):
 *   E2E_TOKEN_CUSTOM     – API key for the provider
 *   E2E_PROVIDER_CUSTOM  – Provider name registered in the extension
 *                           (will be prefixed with "e2e-custom-" to guarantee
 *                            it is NOT a built-in provider)
 *   E2E_MODEL_CUSTOM     – Model ID (e.g., "liquid/lfm-2.5-1.2b-instruct:free")
 *
 * Optional environment variables:
 *   E2E_BASEURL_CUSTOM   – Provider base URL (default: OpenRouter)
 *   E2E_API_CUSTOM       – API type (default: "openai-completions")
 *
 * Enable with: RUN_E2E_TESTS=1
 *
 * Running the tests:
 *   RUN_E2E_TESTS=1 \
 *     E2E_TOKEN_CUSTOM=sk-or-... \
 *     E2E_PROVIDER_CUSTOM=openrouter \
 *     E2E_MODEL_CUSTOM=liquid/lfm-2.5-1.2b-instruct:free \
 *     bun test tests/e2e/pi-agent-custom-provider.spec.ts
 *
 * When RUN_E2E_TESTS is not set or env vars are missing, every test is
 * reported as **skip** (not pass).
 */

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  E2E_TIMEOUT,
  setupE2E,
  readE2EEnvVars,
  isE2EEnabled,
  registerE2ESkip,
} from './helpers/e2e-setup';

const { platformProvider: mockPlatformProvider } = setupE2E();
const noop = (): void => {};

// ============================================================================
// Env-var validation at describe-time
// ============================================================================

const {
  token: E2E_TOKEN,
  provider: E2E_PROVIDER,
  model: E2E_MODEL,
} = readE2EEnvVars({
  token: Bun.env.E2E_TOKEN_CUSTOM ?? '',
  provider: Bun.env.E2E_PROVIDER_CUSTOM ?? '',
  model: Bun.env.E2E_MODEL_CUSTOM ?? '',
});

const canRun = isE2EEnabled({ token: E2E_TOKEN, provider: E2E_PROVIDER, model: E2E_MODEL });

/**
 * The provider name used inside the test is prefixed with "e2e-custom-".
 * This guarantees it is NOT a built-in provider, so the only way the model
 * can be found is if the extension actually loads and registers it.
 */
const TEST_PROVIDER = `e2e-custom-${E2E_PROVIDER}`;

/**
 * Absolute path to the custom-provider fixture extension.
 * The extension reads E2E_*_CUSTOM env vars at runtime.
 */
const CUSTOM_PROVIDER_EXTENSION = resolve(__dirname, '../fixtures/extensions/custom-provider.ts');

// ============================================================================
// Shared logger mock
// ============================================================================

const logger = { notice: noop, debug: noop, info: noop, warning: noop, error: noop };

// ============================================================================
// Tests — conditional registration
// ============================================================================

if (!canRun) {
  registerE2ESkip(
    'E2E: Custom provider registered via extension',
    'requires RUN_E2E_TESTS=1 + E2E_TOKEN_CUSTOM, E2E_PROVIDER_CUSTOM, E2E_MODEL_CUSTOM'
  );
} else {
  describe('E2E: Custom provider registered via extension', () => {
    test(
      'extension registers provider, model is found, LLM call succeeds',
      async () => {
        const { Agent } = await import('@alexanderfortin/pi-orchestrator');

        const agent = new Agent(logger, mockPlatformProvider, {
          model: E2E_MODEL,
          provider: TEST_PROVIDER,
          token: E2E_TOKEN,
          thinkingLevel: 'off',
          promptInput: '',
          extensions: [CUSTOM_PROVIDER_EXTENSION],
        });

        // ready() must succeed — the extension loads and registers the provider
        // under TEST_PROVIDER, then the model lookup finds it in the registry.
        const readyResult = await agent.ready();
        expect(readyResult).toBe(agent);

        // Make a real LLM call through the custom provider.
        const { result: text, sessionStats } = await agent.run(
          'Answer with just the word "OK" and nothing else.'
        );

        expect(text).toBeTruthy();
        expect(text.length).toBeGreaterThan(0);
        expect(text.toLowerCase()).toContain('ok');
        expect(sessionStats).toBeDefined();
        expect(sessionStats!.totalTokens).toBeGreaterThan(0);
      },
      E2E_TIMEOUT
    );

    test(
      'custom provider model is NOT found without the extension',
      async () => {
        const { Agent } = await import('@alexanderfortin/pi-orchestrator');

        // Create an agent referencing the custom model but WITHOUT the extension.
        // Since TEST_PROVIDER is "e2e-custom-<provider>", it is never a built-in
        // provider, so ready() MUST throw "Model not found".
        const agent = new Agent(logger, mockPlatformProvider, {
          model: E2E_MODEL,
          provider: TEST_PROVIDER,
          token: E2E_TOKEN,
          thinkingLevel: 'off',
          promptInput: '',
          // No extensions — provider must not be registered.
        });

        await expect(agent.ready()).rejects.toThrow('Model not found');
      },
      E2E_TIMEOUT
    );

    test(
      'multiple prompts on the same session work',
      async () => {
        const { Agent } = await import('@alexanderfortin/pi-orchestrator');

        const agent = new Agent(logger, mockPlatformProvider, {
          model: E2E_MODEL,
          provider: TEST_PROVIDER,
          token: E2E_TOKEN,
          thinkingLevel: 'off',
          promptInput: '',
          extensions: [CUSTOM_PROVIDER_EXTENSION],
        });

        await agent.ready();

        const r1 = await agent.run('Say "alpha"');
        const r2 = await agent.run('Say "beta"');

        expect(r1.result.toLowerCase()).toContain('alpha');
        expect(r2.result.toLowerCase()).toContain('beta');
      },
      E2E_TIMEOUT * 2
    );
  });
}

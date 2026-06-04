/**
 * E2E tests for Pi agent integration.
 *
 * These tests run a real Pi SDK instance with mocked GitHub dependencies.
 * They are confidence tests that validate our integration works after Pi SDK updates.
 *
 * NOTE: these tests make real API calls to LLM provider and may incur costs.
 * They only run when RUN_E2E_TESTS=1 environment variable is set.
 *
 * Required environment variables:
 *   export E2E_PROVIDER           # Provider name (e.g., openrouter, zai, anthropic)
 *   export E2E_MODEL              # Model to use (e.g., google/gemma-3-4b-it:free)
 *   export E2E_TOKEN              # API key for the provider
 *   export RUN_E2E_TESTS=1        # Enable E2E tests
 *
 * Running the tests:
 *   bun test tests/e2e/pi-agent.spec.ts
 */

import { describe, expect, test } from 'bun:test';
import type { Agent } from '@alexanderfortin/pi-orchestrator';
import {
  E2E_TIMEOUT,
  setupE2E,
  validateE2EEnvVars,
  isE2EEnabled,
  registerE2ESkip,
} from './helpers/e2e-setup';

const { coreAdapter: mockCoreAdapter, platformProvider: mockPlatformProvider } = setupE2E();

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Validate and return E2E test environment variables.
 * @throws {Error} If required environment variables are missing.
 */
function validateLocalE2EEnvVars() {
  return validateE2EEnvVars(
    {
      token: Bun.env.E2E_TOKEN ?? '',
      provider: Bun.env.E2E_PROVIDER ?? '',
      model: Bun.env.E2E_MODEL ?? '',
    },
    {
      token: 'E2E_TOKEN',
      provider: 'E2E_PROVIDER',
      model: 'E2E_MODEL',
    }
  );
}

/**
 * Create a new Agent instance with test configuration.
 */
async function createAgent(): Promise<Agent> {
  const { provider, model, token } = validateLocalE2EEnvVars();
  const { Agent } = await import('@alexanderfortin/pi-orchestrator');
  return new Agent(mockCoreAdapter, mockPlatformProvider, {
    model,
    provider,
    token,
    thinkingLevel: 'off',
    promptInput: '',
  });
}

// ============================================================================
// Env-var gating at describe-time
// ============================================================================

const E2E_ENABLED = isE2EEnabled({
  token: Bun.env.E2E_TOKEN,
  provider: Bun.env.E2E_PROVIDER,
  model: Bun.env.E2E_MODEL,
});

// ============================================================================
// E2E Tests
// ============================================================================

// When env vars are missing or RUN_E2E_TESTS is not set, register one
// test.skip so the suite reports as "skipped" instead of silently passing.
if (!E2E_ENABLED) {
  registerE2ESkip(
    'E2E: Real Pi Agent with Mocked GitHub',
    'requires RUN_E2E_TESTS=1 + E2E_TOKEN, E2E_PROVIDER, E2E_MODEL'
  );
} else {
  describe('E2E: Real Pi Agent with Mocked GitHub', () => {
    describe('basic functionality', () => {
      test(
        'runs minimal prompt without tool calling',
        async () => {
          const agent = await createAgent();
          await agent.ready();
          const { result, sessionStats } = await agent.run('Say "hello world"');

          expect(result).toBeTruthy();
          expect(result).toMatch(/hello world/i);
          expect(sessionStats).toBeDefined();
          expect(sessionStats?.totalTokens).toBeGreaterThan(0);
        },
        E2E_TIMEOUT
      );

      test(
        'handles simple arithmetic prompt without tools',
        async () => {
          const agent = await createAgent();
          await agent.ready();
          const { result, sessionStats } = await agent.run(
            'What is 2 + 2? Answer with just a number.'
          );

          expect(result).toBeTruthy();
          expect(result).toMatch(/4/);
          expect(sessionStats).toBeDefined();
          expect(sessionStats?.totalTokens).toBeGreaterThan(0);
        },
        E2E_TIMEOUT
      );

      test(
        'invalid model throws during ready (model resolution deferred after extension load)',
        async () => {
          const { token, provider } = validateLocalE2EEnvVars();
          const { Agent } = await import('@alexanderfortin/pi-orchestrator');

          const agent = new Agent(mockCoreAdapter, mockPlatformProvider, {
            model: 'invalid-model-xyz',
            provider,
            token,
            thinkingLevel: 'off',
            promptInput: '',
          });

          // Constructor no longer throws — model resolution is deferred to
          // ready() so that extension-provided providers are available.
          await expect(agent.ready()).rejects.toThrow('Model not found');
        },
        E2E_TIMEOUT
      );

      test(
        'empty prompt throws from run method',
        async () => {
          const agent = await createAgent();
          await agent.ready();

          await expect(agent.run('')).rejects.toThrow('no text, skipping prompt');
          await expect(agent.run(undefined as unknown as string)).rejects.toThrow(
            'no text, skipping prompt'
          );
        },
        E2E_TIMEOUT
      );

      test(
        'agent can be called multiple times after ready',
        async () => {
          const agent = await createAgent();
          await agent.ready();

          const result1 = await agent.run('Say "one"');
          const result2 = await agent.run('Say "two"');

          expect(result1.result).toMatch(/one/i);
          expect(result2.result).toMatch(/two/i);
          expect(result1.sessionStats).toBeDefined();
          expect(result2.sessionStats).toBeDefined();
        },
        E2E_TIMEOUT
      );

      test(
        'when valid credentials are provided, test connects successfully',
        async () => {
          const agent = await createAgent();
          await agent.ready();
          const { result } = await agent.run('Hi');

          expect(result).toBeTruthy();
        },
        E2E_TIMEOUT
      );

      test(
        'session includes version from logging module',
        async () => {
          const agent = await createAgent();
          await agent.ready();
          const { sessionStats } = await agent.run('Say "test"');

          expect(sessionStats).toBeDefined();
          expect(sessionStats?.version).toMatch(/^\d+\.\d+\.\d+/);
          expect(sessionStats?.version.length).toBeGreaterThan(0);
        },
        E2E_TIMEOUT
      );
    });

    describe('session management', () => {
      test(
        'empty prompt throws from run method',
        async () => {
          const agent = await createAgent();
          await agent.ready();

          await expect(agent.run('')).rejects.toThrow('no text, skipping prompt');
          await expect(agent.run(undefined as unknown as string)).rejects.toThrow(
            'no text, skipping prompt'
          );
        },
        E2E_TIMEOUT
      );
    });

    describe('action outputs data', () => {
      test(
        'PromptResult contains all fields needed for action outputs',
        async () => {
          const agent = await createAgent();
          await agent.ready();
          const { result, sessionStats } = await agent.run('Say "test"');

          // response output — must be a non-empty string
          expect(result).toBeTruthy();
          expect(typeof result).toBe('string');

          // success is determined by the orchestrator (no error thrown),
          // but we can verify sessionStats has the fields needed for
          // the token/cost/duration outputs
          expect(sessionStats).toBeDefined();
          expect(sessionStats!.inputTokens).toBeGreaterThan(0);
          expect(sessionStats!.outputTokens).toBeGreaterThan(0);
          expect(typeof sessionStats!.cost).toBe('number');
          expect(sessionStats!.cost).toBeGreaterThanOrEqual(0);
        },
        E2E_TIMEOUT
      );
    });
  });
}

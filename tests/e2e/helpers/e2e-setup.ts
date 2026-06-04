/**
 * Shared helpers for E2E specs in `tests/e2e/`.
 *
 * The two E2E specs (`pi-agent.spec.ts` and `pi-agent-custom-provider.spec.ts`)
 * both:
 *   1. Build a mock `@actions/github` context + register it via `mock.module`
 *   2. Install the standard `INPUT_*` env vars
 *   3. Build a mock `PlatformProvider` and (for the main spec) a `CoreAdapter`
 *   4. Initialize the Pi SDK theme for telemetry
 *   5. Gate tests on `RUN_E2E_TESTS=1` + required env vars
 *
 * This file consolidates that boilerplate. Each spec calls `setupE2E()`
 * at module top level and then either skips or runs its `describe` block.
 */

import { mock, describe, test } from 'bun:test';
import type { CoreAdapter } from '@alexanderfortin/pi-orchestrator';
import { initTheme } from '@earendil-works/pi-coding-agent';
// Re-export `createMockProvider` so e2e specs that want a richer provider
// (with all tool methods returning canonical placeholders) get it for free.
import { createMockProvider } from '../../../packages/pi-orchestrator/tests/helpers/tool-mocks';
import type { PlatformProvider } from '@alexanderfortin/pi-orchestrator';

/** 60s — E2E tests hit real LLM APIs. */
export const E2E_TIMEOUT = 60_000;

/** Canonical mock GitHub webhook context used by both E2E specs. */
export const mockGitHubContext = {
  eventName: 'issue_comment' as const,
  repo: { owner: 'test-owner', repo: 'test-repo' },
  issue: { number: 123 },
  serverUrl: 'https://github.com',
  runId: 123456789,
  payload: {
    comment: { body: '/pi test' },
    issue: { number: 123 },
  },
};

/**
 * Mock `@actions/github` + install the standard `INPUT_*` env vars expected
 * by `@alexanderfortin/pi-action`'s config loader. Safe to call from multiple
 * specs (Bun's `mock.module` is first-call-wins).
 */
export function setupE2EGitHubMocks(): void {
  mock.module('@actions/github', () => ({ context: mockGitHubContext }));
  process.env.INPUT_TRIGGER = '/pi';
  process.env.INPUT_GITHUB_TOKEN = 'fake-token';
  process.env.INPUT_MAX_COMMENTS = '100';
}

/**
 * Initialize the Pi SDK theme so that Z.ai usage tracking (telemetry) works
 * in E2E tests. Failures are swallowed — theme init is not critical for E2E.
 */
export function setupE2ETheme(): void {
  try {
    initTheme(undefined, false);
  } catch {
    // Non-critical for E2E tests
  }
}

/**
 * Mock `CoreAdapter` with the standard input defaults used by E2E specs.
 * Each adapter method is a fresh `mock()` so individual specs can spy on it.
 */
export function createE2ECoreAdapter(): CoreAdapter {
  const mockGetInput = mock((name: string): string => {
    const defaults: Record<string, string> = {
      github_token: 'fake-token',
      trigger: '/pi',
      max_comments: '100',
      provider: '',
      model: '',
      token: 'test-token',
      thinking_level: '',
      prompt: '',
    };
    return defaults[name] ?? '';
  });

  return {
    getInput: mockGetInput,
    setFailed: mock(),
    setOutput: mock(),
    notice: mock(),
    debug: mock(),
    info: mock(),
    warning: mock(),
    error: mock(),
  };
}

/**
 * Minimal mock `PlatformProvider` for E2E specs. Delegates to the shared
 * `createMockProvider()` factory so we stay in sync with the rest of the
 * test-suite (single canonical GitHub-shaped provider).
 */
export function createE2EPlatformProvider(): PlatformProvider {
  return createMockProvider();
}

/**
 * Bundle: do GitHub mocks, env vars, theme init. Returns the canonical
 * E2E mocks. Call at module top-level of each E2E spec.
 */
export function setupE2E(): {
  coreAdapter: CoreAdapter;
  platformProvider: PlatformProvider;
} {
  setupE2EGitHubMocks();
  setupE2ETheme();
  return {
    coreAdapter: createE2ECoreAdapter(),
    platformProvider: createE2EPlatformProvider(),
  };
}

/**
 * Standard E2E env-var validation. Returns the validated triple or throws.
 * Used by both E2E specs (with different env var names).
 */
export function validateE2EEnvVars(
  env: { token: string; provider: string; model: string },
  labels: { token: string; provider: string; model: string }
): { token: string; provider: string; model: string } {
  if (!env.token) {
    throw new Error(`${labels.token} environment variable is required for E2E tests`);
  }
  if (!env.provider) {
    throw new Error(`${labels.provider} environment variable is required for E2E tests`);
  }
  if (!env.model) {
    throw new Error(`${labels.model} environment variable is required for E2E tests`);
  }
  return env;
}

/**
 * Helper to gate E2E tests on `RUN_E2E_TESTS=1` plus required env vars.
 * Returns `true` if the suite should run, `false` if it should be skipped.
 */
export function isE2EEnabled(requiredEnvVars: Record<string, string | undefined>): boolean {
  if (Bun.env.RUN_E2E_TESTS !== '1') {
    return false;
  }
  return Object.values(requiredEnvVars).every(v => Boolean(v));
}

/**
 * Register a single `test.skip` placeholder so the suite reports as "skipped"
 * instead of silently passing when E2E is disabled.
 *
 * ```ts
 * if (!enabled) {
 *   registerE2ESkip('E2E: My suite', 'requires RUN_E2E_TESTS=1 + ...');
 * } else {
 *   describe('E2E: My suite', () => { ... });
 * }
 * ```
 */
export function registerE2ESkip(describeName: string, reason: string): void {
  describe(describeName, () => {
    test.skip(reason, () => {});
  });
}

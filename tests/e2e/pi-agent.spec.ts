/**
 * E2E tests for Pi agent integration.
 *
 * These tests run a real Pi SDK instance with mocked GitHub dependencies.
 * They are confidence tests that validate our integration works after Pi SDK updates.
 *
 * NOTE: These tests make real API calls to LLM provider and may incur costs.
 * They only run when RUN_E2E_TESTS=1 environment variable is set.
 *
 * Required environment variables:
 *   export E2E_PROVIDER           # Provider name (e.g., openrouter, zai, anthropic)
 *   export E2E_MODEL              # Model to use (e.g., google/gemma-3-4b-it:free)
 *   export E2E_TOKEN              # API key for the provider
 *   export RUN_E2E_TESTS=1         # Enable E2E tests
 *
 * Running the tests:
 *   bun test tests/e2e/pi-agent.spec.ts
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { Agent } from '../../src/pi/agent.js';
import type { PlatformProvider } from '../../src/platform';

// E2E tests involve real LLM API calls — give them a generous timeout.
const E2E_TIMEOUT = 10_000;

// ============================================================================
// Build-time constants (normally injected by esbuild define)
// ============================================================================

// E2E tests run directly with bun test, bypassing the build step.
// We must define build-time constants manually to match production behavior.
const piVersion = JSON.parse(
  readFileSync('node_modules/@mariozechner/pi-coding-agent/package.json', 'utf-8')
).version;

declare global {
  var __PI_CODING_AGENT_VERSION__: string;
}
globalThis.__PI_CODING_AGENT_VERSION__ = piVersion;

// ============================================================================
// Mock GitHub Dependencies (we only test Pi SDK integration)
// ============================================================================

// Mock @actions/core
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

const mockSetFailed = mock();
const mockNotice = mock();
const mockInfo = mock();
const mockDebug = mock();
const mockWarning = mock();

import type { CoreAdapter } from '../../src/types.ts';

const mockCoreAdapter: CoreAdapter = {
  getInput: mockGetInput,
  setFailed: mockSetFailed,
  notice: mockNotice,
  debug: mockDebug,
  info: mockInfo,
  warning: mockWarning,
};

// Mock platform provider for Agent constructor
const mockPlatformProvider: PlatformProvider = {
  type: 'github',
  getContext: () => ({
    repo: { owner: 'test-owner', repo: 'test-repo' },
    issue: { number: 1 },
    eventName: 'issue_comment',
    payload: {},
    serverUrl: 'https://github.com',
    runId: 123,
    workspace: '/tmp',
  }),
  addReaction: async () => undefined,
  deleteReaction: async () => {},
  createFinalComment: async () => {},
  getPrompt: async () => undefined,
  getStartTime: () => undefined,
  createPullRequest: async () => ({
    content: [],
    details: {
      pullRequestNumber: 1,
      pullRequestUrl: '',
      headBranch: 'main',
      baseBranch: 'main',
      dryRun: false,
    },
  }),
  updatePullRequest: async () => ({
    content: [],
    details: {
      pullRequestNumber: 1,
      pullRequestUrl: '',
      headBranch: 'main',
      baseBranch: 'main',
      dryRun: false,
    },
  }),
  getIssueOrPRThread: async () => undefined,
};

mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mockNotice,
  info: mockInfo,
  debug: mockDebug,
  setFailed: mockSetFailed,
  warning: mockWarning,
}));

// Mock @actions/github context
const mockGitHubContext = {
  eventName: 'issue_comment' as const,
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 123,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  payload: {
    comment: {
      body: '/pi test',
    },
    issue: {
      number: 123,
    },
  },
};

mock.module('@actions/github', () => ({
  context: mockGitHubContext,
}));

// Set env vars that modules might read
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.INPUT_MAX_COMMENTS = '100';

// Initialize theme to enable Z.ai usage tracking in E2E tests.
// The Pi SDK's Z.ai usage tracking (telemetry) requires theme initialization.
// We call initTheme() directly to satisfy this requirement without needing
// full theme loading (which we disabled with noThemes: true in resource-loader).
// This allows telemetry to work while keeping the action headless-friendly.
import { initTheme } from '@mariozechner/pi-coding-agent';

try {
  // Initialize theme with defaults (minimal, no file watcher)
  initTheme(undefined, false);
} catch {
  // If theme init fails, it's not critical for E2E tests
  // We intentionally ignore this error - theme initialization is for UI/telemetry
  // which isn't critical for E2E testing purposes.
}

// ============================================================================
// Mock GitHub Functions for Tool Testing
// ============================================================================

// Mock getIssueOrPRThread to provide fake issue data for tool testing
let _mockGetIssueOrPRThread: ReturnType<typeof mock> | undefined;

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Validate and return E2E test environment variables.
 * @throws {Error} If required environment variables are missing.
 */
function validateE2EEnvVars() {
  const token = Bun.env.E2E_TOKEN;
  const provider = Bun.env.E2E_PROVIDER;
  const model = Bun.env.E2E_MODEL;

  if (!token) {
    throw new Error('E2E_TOKEN environment variable is required for E2E tests');
  }
  if (!provider) {
    throw new Error('E2E_PROVIDER environment variable is required for E2E tests');
  }
  if (!model) {
    throw new Error('E2E_MODEL environment variable is required for E2E tests');
  }

  return { token, provider, model };
}

/**
 * Create a new Agent instance with test configuration.
 */
async function createAgent(): Promise<Agent> {
  const { provider, model, token } = validateE2EEnvVars();
  const { Agent } = await import('../../src/pi/agent.js');
  return new Agent(model, provider, token, 'off', mockCoreAdapter, mockPlatformProvider);
}

// ============================================================================
// E2E Tests
// ============================================================================

describe('E2E: Real Pi Agent with Mocked GitHub', () => {
  let skipTests = false;

  beforeEach(() => {
    // Skip if E2E tests are not enabled
    skipTests = Bun.env.RUN_E2E_TESTS !== '1';
    if (skipTests) {
      return;
    }

    // Reset tool-specific mocks
    _mockGetIssueOrPRThread = undefined;
  });

  describe('basic functionality', () => {
    test(
      'runs minimal prompt without tool calling',
      async () => {
        if (skipTests) {
          return;
        }

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
        if (skipTests) {
          return;
        }

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
      'invalid model throws during constructor',
      async () => {
        if (skipTests) {
          return;
        }

        const { token, provider } = validateE2EEnvVars();
        const { Agent } = await import('../../src/pi/agent.js');

        expect(() => {
          new Agent(
            'invalid-model-xyz',
            provider,
            token,
            'off',
            mockCoreAdapter,
            mockPlatformProvider
          );
        }).toThrow('Model not found');
      },
      E2E_TIMEOUT
    );

    test(
      'empty prompt throws from run method',
      async () => {
        if (skipTests) {
          return;
        }

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
        if (skipTests) {
          return;
        }

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
        if (skipTests) {
          return;
        }

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
        if (skipTests) {
          return;
        }

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
        if (skipTests) {
          return;
        }

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
});

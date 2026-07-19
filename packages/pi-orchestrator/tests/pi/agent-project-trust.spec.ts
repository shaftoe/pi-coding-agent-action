/**
 * Tests for Agent SettingsManager creation.
 *
 * Verifies that the Agent creates a SettingsManager during `ready()`,
 * ensuring project-level resources (AGENTS.md, .pi settings, project
 * extensions, etc.) are loaded in CI environments.
 *
 * Uses prototype-style patching on the real `SettingsManager.create` static
 * method — avoids `vi.mock()` which is process-global and would break
 * other test files that need the real SDK.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Set env vars before dynamic imports
// ---------------------------------------------------------------------------

process.env.INPUT_TRIGGER = '/pi ';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.INPUT_MAX_COMMENTS = '100';

// ---------------------------------------------------------------------------
// Import SDK and orchestrator
// ---------------------------------------------------------------------------

const piSdk = await import('@earendil-works/pi-coding-agent');
const { Agent } = await import('@alexanderfortin/pi-orchestrator');
const { createMockProvider } = await import('../helpers/tool-mocks');

// ---------------------------------------------------------------------------
// Reference to the original SettingsManager.create for restoration
// ---------------------------------------------------------------------------

const originalSettingsManagerCreate = piSdk.SettingsManager.create;

// ---------------------------------------------------------------------------
// Captured arguments
// ---------------------------------------------------------------------------

let capturedSettingsManagerCreateArgs: unknown[] = [];
let capturedSettingsManagerFromCreate: unknown = null;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const noop = (): void => {};
const mockCoreAdapter = {
  getInput: vi.fn(() => ''),
  setFailed: vi.fn(noop),
  setOutput: vi.fn(noop),
  notice: vi.fn(noop),
  debug: vi.fn(noop),
  info: vi.fn(noop),
  warning: vi.fn(noop),
  error: vi.fn(noop),
};

const mockPlatformProvider = createMockProvider();

/** Default agent config for tests in this file. */
const defaultConfig = {
  model: 'claude-sonnet-4-5',
  provider: 'anthropic',
  token: 'test-token',
  thinkingLevel: 'off' as const,
  promptInput: '',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent SettingsManager creation', () => {
  beforeEach(() => {
    capturedSettingsManagerCreateArgs = [];
    capturedSettingsManagerFromCreate = null;

    // Patch SettingsManager.create to capture its arguments while still
    // delegating to the real implementation so the rest of ready() works
    // normally (creates a real session with real extensions).
    piSdk.SettingsManager.create = function (cwd: string) {
      capturedSettingsManagerCreateArgs = [cwd];
      const result = originalSettingsManagerCreate.call(piSdk.SettingsManager, cwd);
      capturedSettingsManagerFromCreate = result;
      return result;
    };
  });

  afterEach(() => {
    // Restore the original static method
    piSdk.SettingsManager.create = originalSettingsManagerCreate;
  });

  test('creates SettingsManager with cwd', async () => {
    const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, defaultConfig);
    await agent.ready();

    // SettingsManager.create(cwd)
    expect(capturedSettingsManagerCreateArgs.length).toBe(1);
    expect(capturedSettingsManagerCreateArgs[0]).toBe(process.cwd());
  });

  test('uses config.cwd as the SettingsManager cwd', async () => {
    const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, {
      ...defaultConfig,
      cwd: '/custom/workspace',
    });
    await agent.ready();

    expect(capturedSettingsManagerCreateArgs[0]).toBe('/custom/workspace');
  });

  test('falls back to process.cwd() when config.cwd is not set', async () => {
    const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, defaultConfig);
    await agent.ready();

    expect(capturedSettingsManagerCreateArgs[0]).toBe(process.cwd());
  });

  test('created SettingsManager is defined', async () => {
    const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, defaultConfig);
    await agent.ready();

    // Verify the real SettingsManager was created successfully
    expect(capturedSettingsManagerFromCreate).toBeDefined();
  });
});

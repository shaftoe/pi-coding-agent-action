/**
 * Tests for Agent project trust settings.
 *
 * Verifies that the Agent creates a SettingsManager with `projectTrusted: true`
 * during `ready()`, ensuring project-level resources (AGENTS.md, .pi settings,
 * project extensions, etc.) are always loaded in CI environments.
 *
 * This prevents regressions of the fix for issue #281.
 *
 * Uses prototype-style patching on the real `SettingsManager.create` static
 * method — avoids `mock.module()` which is process-global and would break
 * other test files that need the real SDK.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';

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
  getInput: mock(() => ''),
  setFailed: mock(noop),
  setOutput: mock(noop),
  notice: mock(noop),
  debug: mock(noop),
  info: mock(noop),
  warning: mock(noop),
  error: mock(noop),
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

describe('Agent project trust', () => {
  beforeEach(() => {
    capturedSettingsManagerCreateArgs = [];
    capturedSettingsManagerFromCreate = null;

    // Patch SettingsManager.create to capture its arguments while still
    // delegating to the real implementation so the rest of ready() works
    // normally (creates a real session with real extensions).
    piSdk.SettingsManager.create = function (
      cwd: string,
      agentDir?: string,
      options?: { projectTrusted?: boolean }
    ) {
      capturedSettingsManagerCreateArgs = [cwd, agentDir, options];
      const result = originalSettingsManagerCreate.call(
        piSdk.SettingsManager,
        cwd,
        agentDir,
        options
      );
      capturedSettingsManagerFromCreate = result;
      return result;
    };
  });

  afterEach(() => {
    // Restore the original static method
    piSdk.SettingsManager.create = originalSettingsManagerCreate;
  });

  test('creates SettingsManager with projectTrusted: true', async () => {
    const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, defaultConfig);
    await agent.ready();

    // SettingsManager.create(cwd, undefined, { projectTrusted: true })
    expect(capturedSettingsManagerCreateArgs.length).toBe(3);
    expect(capturedSettingsManagerCreateArgs[2]).toEqual({ projectTrusted: true });
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

  test('passes undefined as agentDir to SettingsManager.create', async () => {
    const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, defaultConfig);
    await agent.ready();

    // Second arg (agentDir) should be undefined, letting the SDK use its default
    expect(capturedSettingsManagerCreateArgs[1]).toBeUndefined();
  });

  test('created SettingsManager reports projectTrusted as true', async () => {
    const agent = new Agent(mockCoreAdapter as any, mockPlatformProvider, defaultConfig);
    await agent.ready();

    // Verify the real SettingsManager created by the agent has projectTrusted=true
    const sm = capturedSettingsManagerFromCreate as {
      isProjectTrusted: () => boolean;
    };
    expect(sm.isProjectTrusted()).toBe(true);
  });
});

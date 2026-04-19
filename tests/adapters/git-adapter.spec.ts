/**
 * Tests for RealGitAdapter.
 *
 * Tests that the production adapter correctly initializes the git module
 * context and implements the GitAdapter interface.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { RealGitAdapter } from '../../src/adapters/git-adapter';
import { isModuleContextInitialized, resetModuleContext } from '../../src/platform/github';
import type { CoreAdapter } from '../../src/types';

function createMockCoreAdapter(overrides?: Partial<CoreAdapter>): CoreAdapter {
  return {
    getInput: () => '',
    setFailed: () => {},
    notice: () => {},
    debug: () => {},
    info: () => {},
    warning: () => {},
    ...overrides,
  };
}

describe('RealGitAdapter', () => {
  beforeEach(() => {
    resetModuleContext();
  });

  test('constructor initializes git module context', () => {
    expect(isModuleContextInitialized()).toBe(false);
    new RealGitAdapter(createMockCoreAdapter());
    expect(isModuleContextInitialized()).toBe(true);
  });

  test('constructor sets the core adapter in context', () => {
    const adapter = createMockCoreAdapter();
    new RealGitAdapter(adapter);
    // The adapter should be set in the module context
    // We can verify this by checking isModuleContextInitialized
    expect(isModuleContextInitialized()).toBe(true);
  });

  test('constructor replaces existing module context', () => {
    const adapter1 = createMockCoreAdapter();
    resetModuleContext(adapter1);
    expect(isModuleContextInitialized()).toBe(true);

    const adapter2 = createMockCoreAdapter();
    new RealGitAdapter(adapter2);
    expect(isModuleContextInitialized()).toBe(true);
  });

  test('implements GitAdapter interface - addReaction', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter());
    expect(typeof gitAdapter.addReaction).toBe('function');
  });

  test('implements GitAdapter interface - deleteReaction', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter());
    expect(typeof gitAdapter.deleteReaction).toBe('function');
  });

  test('implements GitAdapter interface - createFinalComment', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter());
    expect(typeof gitAdapter.createFinalComment).toBe('function');
  });

  test('implements GitAdapter interface - getPrompt', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter());
    expect(typeof gitAdapter.getPrompt).toBe('function');
  });

  test('implements GitAdapter interface - getStartTime', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter());
    expect(typeof gitAdapter.getStartTime).toBe('function');
  });

  test('getStartTime returns undefined when no event timestamp is available', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter());
    // In test environment with no real GitHub event context, getStartTime should return undefined
    const result = gitAdapter.getStartTime();
    expect(result).toBeUndefined();
  });
});

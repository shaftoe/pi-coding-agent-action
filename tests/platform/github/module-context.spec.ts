/**
 * Tests for git module context management (GitHubModuleContext).
 *
 * Tests the singleton module context that manages the CoreAdapter
 * dependency for the git/ module.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import {
  setCoreAdapter,
  getCoreAdapter,
  resetModuleContext,
  isModuleContextInitialized,
} from '../../../src/platform/github';
import type { CoreAdapter } from '../../../src/types';

function createMockCoreAdapter(overrides?: Partial<CoreAdapter>): CoreAdapter {
  return {
    getInput: () => '',
    setFailed: () => {},
    setOutput: () => {},
    notice: () => {},
    debug: () => {},
    info: () => {},
    warning: () => {},
    ...overrides,
  };
}

describe('git module context management', () => {
  beforeEach(() => {
    resetModuleContext();
  });

  describe('isModuleContextInitialized', () => {
    test('returns false before setCoreAdapter is called', () => {
      expect(isModuleContextInitialized()).toBe(false);
    });

    test('returns true after setCoreAdapter is called', () => {
      setCoreAdapter(createMockCoreAdapter());
      expect(isModuleContextInitialized()).toBe(true);
    });

    test('returns false after resetModuleContext is called', () => {
      setCoreAdapter(createMockCoreAdapter());
      resetModuleContext();
      expect(isModuleContextInitialized()).toBe(false);
    });

    test('returns true after resetModuleContext is called with adapter', () => {
      setCoreAdapter(createMockCoreAdapter());
      resetModuleContext(createMockCoreAdapter());
      expect(isModuleContextInitialized()).toBe(true);
    });
  });

  describe('getCoreAdapter', () => {
    test('throws when context is not initialized', () => {
      expect(() => getCoreAdapter()).toThrow(/not initialized/);
    });

    test('throws with helpful error message when not initialized', () => {
      expect(() => getCoreAdapter()).toThrow(/setCoreAdapter/);
    });

    test('returns adapter after setCoreAdapter is called', () => {
      const adapter = createMockCoreAdapter();
      setCoreAdapter(adapter);
      expect(getCoreAdapter()).toBe(adapter);
    });

    test('returns same adapter on multiple calls', () => {
      const adapter = createMockCoreAdapter();
      setCoreAdapter(adapter);
      expect(getCoreAdapter()).toBe(adapter);
      expect(getCoreAdapter()).toBe(adapter);
    });

    test('returns new adapter after resetModuleContext with adapter', () => {
      const adapter1 = createMockCoreAdapter();
      setCoreAdapter(adapter1);
      const adapter2 = createMockCoreAdapter();
      resetModuleContext(adapter2);
      expect(getCoreAdapter()).toBe(adapter2);
      expect(getCoreAdapter()).not.toBe(adapter1);
    });
  });

  describe('setCoreAdapter', () => {
    test('sets the adapter', () => {
      const adapter = createMockCoreAdapter();
      setCoreAdapter(adapter);
      expect(getCoreAdapter()).toBe(adapter);
    });

    test('replaces existing adapter', () => {
      const adapter1 = createMockCoreAdapter();
      setCoreAdapter(adapter1);
      const adapter2 = createMockCoreAdapter();
      setCoreAdapter(adapter2);
      expect(getCoreAdapter()).toBe(adapter2);
    });

    test('throws for undefined adapter', () => {
      expect(() => setCoreAdapter(undefined as unknown as CoreAdapter)).toThrow(/undefined/);
    });

    test('does not corrupt state when called with undefined', () => {
      const adapter = createMockCoreAdapter();
      setCoreAdapter(adapter);
      try {
        setCoreAdapter(undefined as unknown as CoreAdapter);
      } catch {
        // Expected
      }
      // Previous adapter should still be set
      expect(getCoreAdapter()).toBe(adapter);
    });
  });

  describe('resetModuleContext', () => {
    test('clears the adapter', () => {
      setCoreAdapter(createMockCoreAdapter());
      resetModuleContext();
      expect(isModuleContextInitialized()).toBe(false);
    });

    test('sets new adapter when provided', () => {
      const adapter = createMockCoreAdapter();
      resetModuleContext(adapter);
      expect(getCoreAdapter()).toBe(adapter);
    });

    test('supports multiple resets', () => {
      const adapter1 = createMockCoreAdapter();
      setCoreAdapter(adapter1);
      resetModuleContext();
      expect(isModuleContextInitialized()).toBe(false);

      const adapter2 = createMockCoreAdapter();
      setCoreAdapter(adapter2);
      expect(getCoreAdapter()).toBe(adapter2);
    });

    test('allows setCoreAdapter after reset', () => {
      setCoreAdapter(createMockCoreAdapter());
      resetModuleContext();
      expect(() => setCoreAdapter(createMockCoreAdapter())).not.toThrow();
    });
  });
});

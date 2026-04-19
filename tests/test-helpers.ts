/**
 * @file Test helper utilities for creating mock adapters.
 */

import { mock } from 'bun:test';
import type { CoreAdapter } from '../src/types';

/**
 * Create a mock CoreAdapter with all required methods.
 */
export function createMockCoreAdapter(overrides?: Partial<CoreAdapter>): CoreAdapter {
  return {
    getInput: mock(() => ''),
    setFailed: mock(() => {}),
    notice: mock(() => {}),
    debug: mock(() => {}),
    info: mock(() => {}),
    warning: mock(() => {}),
    setOutput: mock(() => {}),
    ...overrides,
  } as CoreAdapter;
}

/**
 * Shared @actions/core mock for tests.
 *
 * Uses `vi.hoisted()` so the mock object is available both to the
 * `vi.mock('@actions/core')` factory and to test code that imports
 * `coreMock`. Importing this module automatically mocks `@actions/core`
 * (the `vi.mock` call is hoisted to the top of the module graph).
 *
 * Usage:
 *   import { coreMock } from './helpers/core-mock';
 *   // ...later in tests:
 *   coreMock.setOutput.mockImplementation(...);
 *   expect(coreMock.setOutput).toHaveBeenCalledWith(...);
 *
 * Clear spies in `beforeEach` via `coreMock.setOutput.mockClear()`.
 * Test files that need per-file `getInput` overrides can call
 * `vi.mock('@actions/core', ...)` directly in the spec — the spec's own
 * mock takes precedence over this shared one.
 */
import { vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  coreMock: {
    getInput: vi.fn((_name: string) => ''),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    notice: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    isDebug: vi.fn(() => false),
    exportVariable: vi.fn(),
    setSecret: vi.fn(),
    addPath: vi.fn(),
    setCommandEcho: vi.fn(),
    summary: {
      // addRaw returns `this` so `core.summary.addRaw(md).write()` chains
      addRaw: vi.fn(function (this: unknown) {
        return this;
      }),
      write: vi.fn(async () => {}),
    },
  },
}));

// `any` is required (not laziness): the inferred Mock<…> type references
// `Procedure` from `@vitest/spy` (a transitive vitest dep), which triggers
// TS2883 ("inferred type cannot be named without a reference to …") under
// this repo's `declaration: true` tsconfig. A bare re-export is not portable.
export const coreMock: any = hoisted.coreMock;

// Register the mock at module top-level so it is hoisted before any test-file
// imports resolve. The factory returns the shared `coreMock` object so all
// specs spy on the same instances.
vi.mock('@actions/core', () => coreMock);

/**
 * No-op kept for backward compatibility. The mock is now auto-registered at
 * import time (above), so explicit registration is unnecessary.
 */
export function registerCoreMock(): void {
  /* auto-registered via top-level vi.mock */
}

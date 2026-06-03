/**
 * Shared @actions/core mock for tests.
 *
 * `mock.module()` in Bun is process-global and first-call-wins: if multiple
 * test files register a mock for the same module, only the first registration
 * takes effect. To avoid order-dependent test failures across packages, every
 * test file that needs to mock `@actions/core` must use this shared helper.
 *
 * Usage:
 *   import { coreMock, registerCoreMock } from './helpers/core-mock';
 *   registerCoreMock();          // call once at file top-level, before imports
 *   // ...later in tests:
 *   coreMock.setOutput.mockImplementation(...);
 *   expect(coreMock.setOutput).toHaveBeenCalledWith(...);
 *
 * The mock object is shared across all test files in the process — clear spies
 * in `beforeEach` via `coreMock.setOutput.mockClear()`.
 */
import { mock } from 'bun:test';

export const coreMock = {
  getInput: mock((_name: string) => ''),
  setOutput: mock(),
  setFailed: mock(),
  debug: mock(),
  info: mock(),
  notice: mock(),
  warning: mock(),
  error: mock(),
  isDebug: mock(() => false),
  exportVariable: mock(),
  setSecret: mock(),
  addPath: mock(),
  setCommandEcho: mock(),
};

let registered = false;

/**
 * Register the @actions/core mock. Safe to call from multiple test files —
 * only the first call registers; subsequent calls are no-ops against the
 * same shared object.
 */
export function registerCoreMock(): void {
  if (registered) {
    return;
  }
  registered = true;
  mock.module('@actions/core', () => coreMock);
}

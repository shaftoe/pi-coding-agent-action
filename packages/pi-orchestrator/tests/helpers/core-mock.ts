/**
 * Shared @actions/core mock for tests.
 *
 * NOTE: Bun's mock.module() snapshots the factory's return value —
 * subsequent mockImplementation() calls on coreMock.* have NO effect on
 * the module-level exports.  Do NOT call registerCoreMock() and then
 * try to mockImplementation(); instead, in each test file that needs a
 * custom mock, call mock.module() directly in beforeEach (see
 * packages/pi-action/tests/adapters/config.spec.ts for an example).
 *
 * This module exists so test files that need the mock struct (setOutput,
 * setFailed, etc.) can import coreMock and refer to it in expectations:
 *
 *   import { coreMock } from './helpers/core-mock';
 *   expect(coreMock.setOutput).toHaveBeenCalledWith(...);
 *
 * The registerCoreMock() call is intentionally a no-op — it exists for
 * backward compat / to document where the initial registration used to
 * live.  New test files should ignore it.
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
 * @deprecated mock.module() creates snapshots — modifying coreMock after
 *   registration has no effect.  Call mock.module() directly in your test
 *   file's beforeEach instead (see config.spec.ts for the pattern).
 */
export function registerCoreMock(): void {
  if (registered) {
    return;
  }
  registered = true;
  // Intentionally left empty — module-level mock.module() snapshots are
  // incompatible with per-test mockImplementation() updates.
}

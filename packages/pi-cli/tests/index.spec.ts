/**
 * Tests for the commander exit-code handler extracted from `buildProgram`.
 *
 * `handleCommanderExit` is the named replacement for the inline `exitOverride`
 * arrow that Fallow previously flagged as a high-CRAP function (cyclomatic 5,
 * cognitive 4, estimated CRAP 30). Branch coverage here converts that estimate
 * into measured coverage.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CommanderError } from 'commander';
import { handleCommanderExit } from '../src/index';

function makeCommanderError(code: string, exitCode = 1): CommanderError {
  // CommanderError constructor signature: (exitCode, code, message).
  return new CommanderError(exitCode, code, 'message');
}

describe('handleCommanderExit', () => {
  // handleCommanderExit mutates the process-global `process.exitCode`.
  // Snapshot it before each test and restore it afterwards so a leftover
  // non-zero value never leaks out and makes `vitest run` (or a co-running
  // test file) exit non-zero despite 0 failures.
  let exitCodeBefore: typeof process.exitCode;

  beforeEach(() => {
    exitCodeBefore = process.exitCode;
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = exitCodeBefore;
  });

  test('treats commander.help as success', () => {
    process.exitCode = 99; // ensure it gets overwritten, not appended
    handleCommanderExit(makeCommanderError('commander.help'));
    expect(process.exitCode).toBe(0);
  });

  test('treats commander.helpDisplayed as success', () => {
    handleCommanderExit(makeCommanderError('commander.helpDisplayed'));
    expect(process.exitCode).toBe(0);
  });

  test('treats commander.version as success', () => {
    handleCommanderExit(makeCommanderError('commander.version'));
    expect(process.exitCode).toBe(0);
  });

  test('surfaces a real error exitCode', () => {
    handleCommanderExit(makeCommanderError('commander.unknown', 2));
    expect(process.exitCode).toBe(2);
  });

  test('defaults to exitCode 1 when the error carries none', () => {
    // exitCode omitted → constructor defaults differ per code; force NaN/0 path
    const err = makeCommanderError('commander.unknown');
    Object.defineProperty(err, 'exitCode', { value: undefined });
    handleCommanderExit(err);
    expect(process.exitCode).toBe(1);
  });
});

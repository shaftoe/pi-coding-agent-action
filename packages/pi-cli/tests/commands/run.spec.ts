/**
 * @file Tests for {@link packages/pi-cli/src/commands/run.ts}.
 *
 * Covers the pure helper `resolveLogLevel` (the command's integration
 * wiring is tested via smoke tests in the Makefile / CI).
 */

import { describe, it, expect } from 'bun:test';
import { resolveLogLevel } from '../../src/commands/run.js';

describe('resolveLogLevel', () => {
  it('returns debug when verbose is set', () => {
    expect(resolveLogLevel({ verbose: true, quiet: false })).toBe('debug');
  });

  it('returns error when quiet is set', () => {
    expect(resolveLogLevel({ verbose: false, quiet: true })).toBe('error');
  });

  it('returns warning when neither is set', () => {
    expect(resolveLogLevel({ verbose: false, quiet: false })).toBe('warning');
  });

  it('returns warning when both are false (M1 default)', () => {
    expect(resolveLogLevel({ verbose: false, quiet: false })).toBe('warning');
  });

  it('throws when both verbose and quiet are set', () => {
    expect(() => resolveLogLevel({ verbose: true, quiet: true })).toThrow(/mutually exclusive/);
  });
});

/**
 * Tests for the shared {@link formatCost} formatting helper.
 */

import { describe, expect, test } from 'bun:test';
import { formatCost } from '@alexanderfortin/pi-orchestrator';

describe('formatCost', () => {
  test('formats positive cost to the given precision', () => {
    expect(formatCost(0.042, 4)).toBe('0.0420');
    expect(formatCost(0.05, 2)).toBe('0.05');
  });

  test('normalizes negative cost via Math.abs', () => {
    expect(formatCost(-0.12, 2)).toBe('0.12');
    expect(formatCost(-0.005, 4)).toBe('0.0050');
  });

  test('returns undefined when cost is exactly zero', () => {
    expect(formatCost(0, 4)).toBeUndefined();
    expect(formatCost(-0, 2)).toBeUndefined();
  });

  test('omits tiny positive costs that round to zero at the given precision', () => {
    // 0.00001 > 0 but rounds to "0.0000" at 4 decimals — must be omitted
    // rather than displayed as a confusing "$0.0000".
    expect(formatCost(0.00001, 4)).toBeUndefined();
    expect(formatCost(0.00004, 4)).toBeUndefined();
  });

  test('keeps tiny costs that survive rounding at the given precision', () => {
    expect(formatCost(0.00005, 4)).toBe('0.0001');
  });
});

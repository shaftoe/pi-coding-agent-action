import { describe, expect, test, mock } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
const realStdoutWrite = process.stdout.write.bind(process.stdout);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stdout.write accepts variable args
const _mockedWrite = mock((...args: any[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock @actions/core
const noop = (): void => {};
const mockGetInput = mock((name: string) => {
  if (name === 'github_token') {
    return 'fake-token';
  }
  return '';
});
mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  warning: mock(noop),
}));

// Mock the octokit module before importing comments.ts
const mockOctokit = {
  rest: {
    issues: {
      createComment: mock(() => Promise.resolve({ data: { id: 123 } })),
    },
  },
};

mock.module('../../src/github/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

// Set env vars for GitHub context before importing comments.ts
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, '{}');

import { Temporal } from '@js-temporal/polyfill';

// Dynamic import to ensure mocks are set up before module loads
// @ts-expect-error TS1309 -- Top-level await not supported in CommonJS, but Bun test runner handles it
const { formatExecutionTime, formatNumber } = await import('../../src/github/comments');

describe('formatExecutionTime', () => {
  test('formats seconds only', () => {
    const duration = Temporal.Duration.from({ seconds: 30 });
    expect(formatExecutionTime(duration)).toBe('30s');
  });

  test('formats zero seconds', () => {
    const duration = Temporal.Duration.from({ seconds: 0 });
    expect(formatExecutionTime(duration)).toBe('0s');
  });

  test('formats minutes and seconds', () => {
    const duration = Temporal.Duration.from({ minutes: 1, seconds: 30 });
    expect(formatExecutionTime(duration)).toBe('1m 30s');
  });

  test('formats minutes without seconds', () => {
    const duration = Temporal.Duration.from({ minutes: 5 });
    expect(formatExecutionTime(duration)).toBe('5m');
  });

  test('formats hours, minutes, and seconds', () => {
    const duration = Temporal.Duration.from({ hours: 1, minutes: 5, seconds: 30 });
    expect(formatExecutionTime(duration)).toBe('1h 5m 30s');
  });

  test('formats hours and minutes', () => {
    const duration = Temporal.Duration.from({ hours: 2, minutes: 45 });
    expect(formatExecutionTime(duration)).toBe('2h 45m');
  });

  test('formats hours without minutes or seconds', () => {
    const duration = Temporal.Duration.from({ hours: 3 });
    expect(formatExecutionTime(duration)).toBe('3h');
  });

  test('handles large values', () => {
    const duration = Temporal.Duration.from({ hours: 10, minutes: 59, seconds: 59 });
    expect(formatExecutionTime(duration)).toBe('10h 59m 59s');
  });

  test('rounds sub-second durations to nearest second', () => {
    const duration = Temporal.Duration.from({ seconds: 30, milliseconds: 700 });
    expect(formatExecutionTime(duration)).toBe('31s');
  });

  test('rounds down sub-second durations below .5', () => {
    const duration = Temporal.Duration.from({ seconds: 30, milliseconds: 300 });
    expect(formatExecutionTime(duration)).toBe('30s');
  });

  test('handles mixed values with zero seconds', () => {
    const duration = Temporal.Duration.from({ hours: 1, minutes: 30, seconds: 0 });
    expect(formatExecutionTime(duration)).toBe('1h 30m');
  });

  test('handles single unit values', () => {
    expect(formatExecutionTime(Temporal.Duration.from({ seconds: 1 }))).toBe('1s');
    expect(formatExecutionTime(Temporal.Duration.from({ minutes: 1 }))).toBe('1m');
    expect(formatExecutionTime(Temporal.Duration.from({ hours: 1 }))).toBe('1h');
  });
});

describe('formatNumber', () => {
  test('formats small numbers', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(500)).toBe('500');
    expect(formatNumber(999)).toBe('999');
  });

  test('formats thousands', () => {
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(9999)).toBe('10.0K');
    expect(formatNumber(10000)).toBe('10.0K');
    expect(formatNumber(999999)).toBe('1000.0K');
  });

  test('formats millions', () => {
    expect(formatNumber(1000000)).toBe('1.0M');
    expect(formatNumber(1500000)).toBe('1.5M');
    expect(formatNumber(10000000)).toBe('10.0M');
    expect(formatNumber(999999999)).toBe('1000.0M');
  });

  test('handles boundary values', () => {
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(999999)).toBe('1000.0K');
    expect(formatNumber(1000000)).toBe('1.0M');
  });

  test('handles negative numbers gracefully', () => {
    expect(formatNumber(-1)).toBe('-1');
    expect(formatNumber(-500)).toBe('-500');
    expect(formatNumber(-1000)).toBe('-1000');
    expect(formatNumber(-1500000)).toBe('-1500000');
  });

  test('handles very large numbers', () => {
    expect(formatNumber(1000000000)).toBe('1000.0M');
    expect(formatNumber(9999999999)).toBe('10000.0M');
  });

  test('formats with one decimal place', () => {
    expect(formatNumber(1234)).toBe('1.2K');
    expect(formatNumber(12345)).toBe('12.3K');
    expect(formatNumber(1234567)).toBe('1.2M');
  });
});

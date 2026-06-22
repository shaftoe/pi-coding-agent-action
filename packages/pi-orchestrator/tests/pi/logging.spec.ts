import { describe, expect, test } from 'bun:test';
import { truncateText, ExtensionLoadingInfo } from '@alexanderfortin/pi-orchestrator';
import { getPiVersion } from '@alexanderfortin/pi-orchestrator';
import { createLoggingFactory } from '@alexanderfortin/pi-orchestrator';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { CoreAdapter } from '@alexanderfortin/pi-orchestrator';

describe('truncateText', () => {
  test('returns text unchanged when shorter than maxLength', () => {
    const text = 'Short text';
    const result = truncateText(text, 100);
    expect(result).toBe(text);
  });

  test('returns text unchanged when exactly maxLength', () => {
    const text = 'Exactly twenty chars';
    const result = truncateText(text, 20);
    expect(result).toBe(text);
  });

  test('truncates text longer than maxLength', () => {
    const text = 'This is a much longer text that exceeds the maximum length';
    const result = truncateText(text, 20);
    expect(result.length).toBeLessThanOrEqual(24); // 20 + '...' = 23, but may be more if word boundary
    expect(result).toContain('...');
  });

  test('preserves word boundaries when truncating', () => {
    const text = 'This is a longer text that should be truncated at a word boundary';
    const result = truncateText(text, 30);
    expect(result.endsWith('...')).toBe(true);
    // Should not cut off in the middle of a word unless necessary
    const beforeEllipsis = result.slice(0, -3);
    // The function truncates at the last space if it's within 80% of maxLength
    expect(beforeEllipsis).toBe('This is a longer text that');
  });

  test('truncates mid-word if word boundary too far back', () => {
    const text = 'ThisIsAVeryLongWordWithoutSpacesThatShouldBeTruncatedMidWord';
    const result = truncateText(text, 20);
    expect(result.endsWith('...')).toBe(true);
    const beforeEllipsis = result.slice(0, -3);
    // With such a long word, it won't find a space in the last 20% (4 chars)
    expect(beforeEllipsis.length).toBe(20);
  });

  test('handles empty string', () => {
    const result = truncateText('', 100);
    expect(result).toBe('');
  });

  test('handles whitespace-only text', () => {
    const text = '   ';
    const result = truncateText(text, 100);
    expect(result).toBe(text);
  });

  test('handles text shorter than maxLength word boundary threshold', () => {
    const text = 'Short';
    const result = truncateText(text, 100);
    expect(result).toBe(text);
  });

  test('handles maxLength of 1', () => {
    const text = 'Hello';
    const result = truncateText(text, 1);
    expect(result.length).toBeGreaterThan(1); // At least '...'
    expect(result).toContain('...');
  });
});

describe('getPiVersion', () => {
  test('returns a valid version string', () => {
    // The version is resolved at runtime from package.json.
    // When running tests with bun, it reads the Pi SDK's package.json.
    // Falls back to 'unknown' if not found.
    const result = getPiVersion();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('ExtensionLoadingInfo', () => {
  test('type is exported and can be instantiated', () => {
    const info: ExtensionLoadingInfo = {
      requested: ['npm:some-package'],
      loaded: ['/path/to/extension'],
      warnings: [],
    };
    expect(info.requested).toEqual(['npm:some-package']);
    expect(info.loaded).toEqual(['/path/to/extension']);
    expect(info.warnings).toEqual([]);
  });

  test('supports empty arrays', () => {
    const info: ExtensionLoadingInfo = {
      requested: [],
      loaded: [],
      warnings: [],
    };
    expect(info.requested).toEqual([]);
    expect(info.loaded).toEqual([]);
    expect(info.warnings).toEqual([]);
  });

  test('supports warnings array', () => {
    const info: ExtensionLoadingInfo = {
      requested: ['invalid-package'],
      loaded: [],
      warnings: ['No extensions resolved from: invalid-package'],
    };
    expect(info.warnings).toContain('No extensions resolved from: invalid-package');
  });
});

describe('createLoggingFactory', () => {
  test('returns a factory function that accepts ExtensionAPI', () => {
    const mockCore: CoreAdapter = {
      getInput: () => '',
      setFailed: () => {},
      setOutput: () => {},
      notice: () => {},
      debug: () => {},
      info: () => {},
      warning: () => {},
      error: () => {},
    };

    const factory = createLoggingFactory(mockCore);
    expect(typeof factory).toBe('function');

    // The factory should accept an ExtensionAPI
    const mockPi = {
      on: () => {},
      getAllTools: () => [],
      getThinkingLevel: () => 'off',
    } as unknown as ExtensionAPI;

    expect(() => factory(mockPi)).not.toThrow();
  });

  test('accepts optional extensionInfo parameter', () => {
    const mockCore: CoreAdapter = {
      getInput: () => '',
      setFailed: () => {},
      setOutput: () => {},
      notice: () => {},
      debug: () => {},
      info: () => {},
      warning: () => {},
      error: () => {},
    };

    const extensionInfo: ExtensionLoadingInfo = {
      requested: ['npm:example'],
      loaded: ['/tmp/example'],
      warnings: [],
    };

    const factory = createLoggingFactory(mockCore, extensionInfo);
    const mockPi = {
      on: () => {},
      getAllTools: () => [],
      getThinkingLevel: () => 'off',
    } as unknown as ExtensionAPI;

    expect(() => factory(mockPi)).not.toThrow();
  });
});

describe('createLoggingFactory compaction events', () => {
  // Build a capturing logger + ExtensionAPI so we can drive individual event
  // handlers and assert on the routed log output.
  function setup() {
    const messages: { level: 'info' | 'warning' | 'debug' | 'notice' | 'error'; text: string }[] =
      [];
    const logger = {
      debug: (m: string) => messages.push({ level: 'debug', text: m }),
      info: (m: string) => messages.push({ level: 'info', text: m }),
      warning: (m: string) => messages.push({ level: 'warning', text: m }),
      notice: (m: string) => messages.push({ level: 'notice', text: m }),
      error: (m: string) => messages.push({ level: 'error', text: m }),
    };
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const mockPi = {
      on: (event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler);
      },
      getAllTools: () => [],
      getThinkingLevel: () => 'off',
    } as unknown as ExtensionAPI;

    createLoggingFactory(logger)(mockPi);
    return { messages, handlers };
  }

  test('subscribes to session_before_compact and session_compact', () => {
    const { handlers } = setup();
    expect(handlers.has('session_before_compact')).toBe(true);
    expect(handlers.has('session_compact')).toBe(true);
  });

  test('session_before_compact routes overflow-retry to warning level', async () => {
    const { messages, handlers } = setup();
    const handler = handlers.get('session_before_compact')!;
    await handler({
      type: 'session_before_compact',
      preparation: { tokensBefore: 185000 },
      branchEntries: [],
      reason: 'overflow',
      willRetry: true,
      signal: new AbortController().signal,
    });

    const warnings = messages.filter(m => m.level === 'warning').map(m => m.text);
    const infos = messages.filter(m => m.level === 'info').map(m => m.text);
    expect(infos).toEqual([]);
    expect(warnings).toContain('🗜️  Context compaction starting');
    expect(warnings).toContain('  Reason:           overflow · turn retried');
    expect(warnings).toContain('  Tokens before:    185,000');
    expect(warnings.some(t => t.includes('overflowed mid-turn'))).toBe(true);
  });

  test('session_compact routes threshold compaction to info level', async () => {
    const { messages, handlers } = setup();
    const handler = handlers.get('session_compact')!;
    await handler({
      type: 'session_compact',
      compactionEntry: { tokensBefore: 120000 },
      fromExtension: false,
      reason: 'threshold',
      willRetry: false,
    });

    const warnings = messages.filter(m => m.level === 'warning').map(m => m.text);
    const infos = messages.filter(m => m.level === 'info').map(m => m.text);
    expect(warnings).toEqual([]);
    expect(infos).toContain('🗜️  Context compaction completed');
    expect(infos).toContain('  Reason:           threshold');
    expect(infos).toContain('  Tokens before:    120,000');
  });
});

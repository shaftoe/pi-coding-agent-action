import { describe, expect, test } from 'bun:test';
import { truncateText, getVersion, ExtensionLoadingInfo } from '../../src/pi/logging';
import { createLoggingFactory } from '../../src/pi/logging';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { CoreAdapter } from '../../src/types';

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

describe('getVersion', () => {
  test('returns a valid version string', () => {
    // The global constant is defined at build time via esbuild.
    // When running tests without the esbuild define, it returns 'unknown'.
    // On some CI platforms Bun resolves it to the pi-coding-agent package version.
    const result = getVersion();
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

  test('agent_end handler only logs session completion once on duplicate events', () => {
    const infoMessages: string[] = [];
    const debugMessages: string[] = [];
    const mockCore: CoreAdapter = {
      getInput: () => '',
      setFailed: () => {},
      setOutput: () => {},
      notice: () => {},
      debug: (msg: string) => debugMessages.push(msg),
      info: (msg: string) => infoMessages.push(msg),
      warning: () => {},
    };

    // Capture event handlers registered via pi.on()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: Record<string, ((...args: any[]) => any)[]> = {};
    const mockPi = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: (event: string, handler: (...args: any[]) => any) => {
        if (!handlers[event]) {
          handlers[event] = [];
        }
        handlers[event].push(handler);
      },
      getAllTools: () => [],
      getThinkingLevel: () => 'off',
    } as unknown as ExtensionAPI;

    const factory = createLoggingFactory(mockCore);
    factory(mockPi);

    // Simulate multiple agent_end events (e.g. from SDK retries)
    const agentEndHandlers = handlers['agent_end'];
    expect(agentEndHandlers).toBeDefined();
    expect(agentEndHandlers!.length).toBe(1);

    const emitAgentEnd = () => agentEndHandlers?.[0]?.({ type: 'agent_end', messages: [] });

    // First agent_end should log completion
    emitAgentEnd();
    const firstCallCount = infoMessages.filter(m => m.includes('Agent session completed')).length;
    expect(firstCallCount).toBe(1);

    // Second agent_end should NOT log completion again
    emitAgentEnd();
    const secondCallCount = infoMessages.filter(m => m.includes('Agent session completed')).length;
    expect(secondCallCount).toBe(1); // Still 1, not 2

    // Should have logged a debug message about the duplicate
    expect(debugMessages.some(m => m.includes('duplicate agent_end'))).toBe(true);

    // Third agent_end should also NOT log completion
    emitAgentEnd();
    const thirdCallCount = infoMessages.filter(m => m.includes('Agent session completed')).length;
    expect(thirdCallCount).toBe(1); // Still 1
  });
});

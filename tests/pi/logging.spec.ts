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
      afterProviderResponse: () => {},
    } as unknown as ExtensionAPI;

    expect(() => factory(mockPi)).not.toThrow();
  });

  test('accepts optional extensionInfo parameter', () => {
    const mockCore: CoreAdapter = {
      getInput: () => '',
      setFailed: () => {},
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
      afterProviderResponse: () => {},
    } as unknown as ExtensionAPI;

    expect(() => factory(mockPi)).not.toThrow();
  });

  describe('afterProviderResponse hook', () => {
    test('logs provider response status', () => {
      const debugLogs: string[] = [];
      const warningLogs: string[] = [];

      const mockCore: CoreAdapter = {
        getInput: () => '',
        setFailed: () => {},
        notice: () => {},
        debug: (message: string) => debugLogs.push(message),
        info: () => {},
        warning: (message: string) => warningLogs.push(message),
      };

      const factory = createLoggingFactory(mockCore);

      let afterProviderCallback:
        | ((response: { status: number; headers: Record<string, string> }) => void)
        | null = null;

      const mockPi = {
        on: () => {},
        getAllTools: () => [],
        getThinkingLevel: () => 'off',
        afterProviderResponse: (
          callback: (response: { status: number; headers: Record<string, string> }) => void
        ) => {
          afterProviderCallback = callback;
        },
      } as unknown as ExtensionAPI;

      factory(mockPi);

      expect(afterProviderCallback).not.toBeNull();

      // Simulate a provider response
      afterProviderCallback!({
        status: 200,
        headers: {
          'x-request-id': 'req-123',
        },
      });

      expect(debugLogs).toContain('[provider] Response status: 200');
      expect(debugLogs).toContain('[provider] Request ID: req-123');
      expect(warningLogs.length).toBe(0);
    });

    test('logs rate limit information when available', () => {
      const debugLogs: string[] = [];

      const mockCore: CoreAdapter = {
        getInput: () => '',
        setFailed: () => {},
        notice: () => {},
        debug: (message: string) => debugLogs.push(message),
        info: () => {},
        warning: () => {},
      };

      const factory = createLoggingFactory(mockCore);

      let afterProviderCallback:
        | ((response: { status: number; headers: Record<string, string> }) => void)
        | null = null;

      const mockPi = {
        on: () => {},
        getAllTools: () => [],
        getThinkingLevel: () => 'off',
        afterProviderResponse: (
          callback: (response: { status: number; headers: Record<string, string> }) => void
        ) => {
          afterProviderCallback = callback;
        },
      } as unknown as ExtensionAPI;

      factory(mockPi);

      // Simulate a response with rate limit headers
      afterProviderCallback!({
        status: 200,
        headers: {
          'x-ratelimit-remaining': '42',
          'x-ratelimit-reset': '1713528000',
        },
      });

      expect(debugLogs).toContain('[provider] Rate limit remaining: 42');
      expect(debugLogs).toContain('[provider] Rate limit resets at: 1713528000');
    });

    test('warns about non-success response status', () => {
      const debugLogs: string[] = [];
      const warningLogs: string[] = [];

      const mockCore: CoreAdapter = {
        getInput: () => '',
        setFailed: () => {},
        notice: () => {},
        debug: (message: string) => debugLogs.push(message),
        info: () => {},
        warning: (message: string) => warningLogs.push(message),
      };

      const factory = createLoggingFactory(mockCore);

      let afterProviderCallback:
        | ((response: { status: number; headers: Record<string, string> }) => void)
        | null = null;

      const mockPi = {
        on: () => {},
        getAllTools: () => [],
        getThinkingLevel: () => 'off',
        afterProviderResponse: (
          callback: (response: { status: number; headers: Record<string, string> }) => void
        ) => {
          afterProviderCallback = callback;
        },
      } as unknown as ExtensionAPI;

      factory(mockPi);

      // Simulate a 429 rate limit response
      afterProviderCallback!({
        status: 429,
        headers: {},
      });

      expect(debugLogs).toContain('[provider] Response status: 429');
      expect(warningLogs).toContain('[provider] Non-success response status: 429');
    });

    test('handles both request-id header formats', () => {
      const debugLogs: string[] = [];

      const mockCore: CoreAdapter = {
        getInput: () => '',
        setFailed: () => {},
        notice: () => {},
        debug: (message: string) => debugLogs.push(message),
        info: () => {},
        warning: () => {},
      };

      const factory = createLoggingFactory(mockCore);

      let afterProviderCallback:
        | ((response: { status: number; headers: Record<string, string> }) => void)
        | null = null;

      const mockPi = {
        on: () => {},
        getAllTools: () => [],
        getThinkingLevel: () => 'off',
        afterProviderResponse: (
          callback: (response: { status: number; headers: Record<string, string> }) => void
        ) => {
          afterProviderCallback = callback;
        },
      } as unknown as ExtensionAPI;

      factory(mockPi);

      // Test with x-request-id header
      afterProviderCallback!({
        status: 200,
        headers: {
          'x-request-id': 'req-123',
        },
      });

      expect(debugLogs).toContain('[provider] Request ID: req-123');

      // Clear logs and test with request-id header
      debugLogs.length = 0;

      afterProviderCallback!({
        status: 200,
        headers: {
          'request-id': 'req-456',
        },
      });

      expect(debugLogs).toContain('[provider] Request ID: req-456');
    });
  });
});

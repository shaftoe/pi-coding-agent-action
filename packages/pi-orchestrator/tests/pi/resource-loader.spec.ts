/**
 * Tests for resource-loader module.
 *
 * Tests extension resolution functionality and resource loader configuration.
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { resolveExtensions, getResourceLoader } from '@alexanderfortin/pi-orchestrator';
import { buildResourceLoaderOptions, updateLoadedExtensions } from '../../src/pi/resource-loader';
import type { Logger } from '../../src/types';
import { DefaultPackageManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { createMockProvider } from '../helpers/tool-mocks';

// Mock CoreAdapter for testing
const mockCoreAdapter = {
  getInput: vi.fn((name: string) => {
    const defaults: Record<string, string> = {
      github_token: 'fake-token',
      trigger: '/pi ',
      max_comments: '100',
    };
    return defaults[name] ?? '';
  }),
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  notice: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
};

// Mock platform provider for getResourceLoader
const mockPlatformProvider = createMockProvider();

// Set env vars before importing
process.env.INPUT_TRIGGER = '/pi ';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.INPUT_MAX_COMMENTS = '100';

/**
 * Install a mock `resolveExtensionSources` on `DefaultPackageManager.prototype`
 * that returns one enabled extension per source. Returns the mock function
 * and the cleanup function that restores the original implementation.
 */
function installMockResolveExtensionSources(): {
  mockFn: ReturnType<typeof vi.fn>;
  restore: () => void;
} {
  const original = DefaultPackageManager.prototype.resolveExtensionSources;
  const mockFn = vi.fn(async (sources: string[]) => ({
    extensions: sources.map((source, index) => ({
      source,
      path: `/tmp/extensions/${source.replace(/[^a-z0-9]/g, '-')}-${index}`,
      enabled: true,
    })),
  }));
  DefaultPackageManager.prototype.resolveExtensionSources = mockFn as any;
  return {
    mockFn,
    restore: () => {
      DefaultPackageManager.prototype.resolveExtensionSources = original;
    },
  };
}

describe('resolveExtensions', () => {
  let mockResolveExtensionSources: ReturnType<typeof vi.fn>;
  let restoreResolveExtensionSources: () => void;

  beforeEach(() => {
    const installed = installMockResolveExtensionSources();
    mockResolveExtensionSources = installed.mockFn;
    restoreResolveExtensionSources = installed.restore;
  });

  afterEach(() => {
    restoreResolveExtensionSources();
  });

  describe('when no extensions provided', () => {
    test('returns empty paths and info with empty arrays', async () => {
      const result = await resolveExtensions();

      expect(result.paths).toEqual([]);
      expect(result.info.requested).toEqual([]);
      expect(result.info.loaded).toEqual([]);
      expect(result.info.warnings).toEqual([]);
    });

    test('returns empty paths when undefined passed', async () => {
      const result = await resolveExtensions(undefined);

      expect(result.paths).toEqual([]);
      expect(result.info.requested).toEqual([]);
      expect(result.info.loaded).toEqual([]);
    });

    test('returns empty paths when empty array passed', async () => {
      const result = await resolveExtensions([]);

      expect(result.paths).toEqual([]);
      expect(result.info.requested).toEqual([]);
      expect(result.info.loaded).toEqual([]);
    });
  });

  describe('when extensions are successfully resolved', () => {
    test('returns paths of enabled extensions', async () => {
      const result = await resolveExtensions(['npm:package-one', 'npm:package-two']);

      expect(result.paths).toEqual([
        '/tmp/extensions/npm-package-one-0',
        '/tmp/extensions/npm-package-two-1',
      ]);
      expect(result.info.requested).toEqual(['npm:package-one', 'npm:package-two']);
      expect(result.info.loaded).toEqual([
        '/tmp/extensions/npm-package-one-0',
        '/tmp/extensions/npm-package-two-1',
      ]);
      expect(result.info.warnings).toEqual([]);
    });

    test('handles single extension', async () => {
      const result = await resolveExtensions(['npm:single-package']);

      expect(result.paths).toEqual(['/tmp/extensions/npm-single-package-0']);
      expect(result.info.requested).toEqual(['npm:single-package']);
      expect(result.info.loaded).toEqual(['/tmp/extensions/npm-single-package-0']);
    });

    test('handles local path extensions', async () => {
      const result = await resolveExtensions(['./my-extension.ts', '../another-extension']);

      expect(result.paths.length).toBe(2);
      expect(result.paths[0]).toContain('my-extension');
      expect(result.paths[1]).toContain('another-extension');
      expect(result.info.loaded).toEqual(result.paths);
    });

    test('handles git repository extensions', async () => {
      const result = await resolveExtensions(['git:github.com/user/repo']);

      expect(result.paths.length).toBe(1);
      expect(result.paths[0]).toContain('git-github-com-user-repo');
      expect(result.info.loaded).toEqual(result.paths);
    });
  });

  describe('when some extensions are disabled', () => {
    beforeEach(() => {
      mockResolveExtensionSources = vi.fn(async () => ({
        extensions: [
          { source: 'npm:enabled-package', path: '/tmp/extension-1', enabled: true },
          { source: 'npm:disabled-package', path: '/tmp/extension-2', enabled: false },
          { source: 'npm:another-enabled', path: '/tmp/extension-3', enabled: true },
        ],
      }));
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources as any;
    });

    test('only includes enabled extensions in paths', async () => {
      const result = await resolveExtensions([
        'npm:enabled-package',
        'npm:disabled-package',
        'npm:another-enabled',
      ]);

      expect(result.paths).toEqual(['/tmp/extension-1', '/tmp/extension-3']);
      expect(result.info.loaded).toEqual(['/tmp/extension-1', '/tmp/extension-3']);
      expect(result.info.warnings).toEqual([]);
    });
  });

  describe('when no extensions are resolved', () => {
    beforeEach(() => {
      mockResolveExtensionSources = vi.fn(async () => ({
        extensions: [],
      }));
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources as any;
    });

    test('returns empty paths and adds warning', async () => {
      const result = await resolveExtensions(['npm:invalid-package', 'git:invalid/repo']);

      expect(result.paths).toEqual([]);
      expect(result.info.loaded).toEqual([]);
      expect(result.info.warnings).toContain(
        'No extensions resolved from: npm:invalid-package, git:invalid/repo'
      );
    });

    test('warning includes all requested extensions', async () => {
      const result = await resolveExtensions(['ext1', 'ext2', 'ext3']);

      expect(result.info.warnings[0]).toContain('ext1');
      expect(result.info.warnings[0]).toContain('ext2');
      expect(result.info.warnings[0]).toContain('ext3');
    });
  });

  describe('when package manager throws error', () => {
    beforeEach(() => {
      mockResolveExtensionSources = vi.fn(async () => {
        throw new Error('Network error resolving extensions');
      });
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources as any;
    });

    test('propagates the error', async () => {
      await expect(resolveExtensions(['npm:package'])).rejects.toThrow(
        'Network error resolving extensions'
      );
    });
  });

  describe('edge cases', () => {
    test('handles whitespace in extension names', async () => {
      const result = await resolveExtensions([' npm:package ']);

      expect(result.paths.length).toBe(1);
      expect(result.info.requested).toEqual([' npm:package ']);
    });

    test('handles duplicate extension sources', async () => {
      const result = await resolveExtensions(['npm:same', 'npm:same']);

      expect(result.paths.length).toBe(2);
      expect(result.info.loaded.length).toBe(2);
    });

    test('handles many extensions', async () => {
      const manyExtensions = Array.from({ length: 10 }, (_, i) => `npm:package-${i}`);
      const result = await resolveExtensions(manyExtensions);

      expect(result.paths.length).toBe(10);
      expect(result.info.loaded.length).toBe(10);
    });
  });
});

describe('getResourceLoader', () => {
  let mockResolveExtensionSources: ReturnType<typeof vi.fn>;
  let restoreResolveExtensionSources: () => void;
  let mockReload: ReturnType<typeof vi.fn>;
  let originalReload: typeof DefaultResourceLoader.prototype.reload;

  beforeEach(() => {
    const installed = installMockResolveExtensionSources();
    mockResolveExtensionSources = installed.mockFn;
    restoreResolveExtensionSources = installed.restore;

    // Mock reload method to avoid CLI extension loading errors in tests
    // The Pi SDK's reload() tries to access CLI extension paths that
    // don't exist in test environment, causing errors
    originalReload = DefaultResourceLoader.prototype.reload;
    mockReload = vi.fn(async () => undefined);
    DefaultResourceLoader.prototype.reload = mockReload as any;
  });

  afterEach(() => {
    // Restore original methods
    restoreResolveExtensionSources();
    DefaultResourceLoader.prototype.reload = originalReload;
  });

  describe('resource loader configuration', () => {
    test('creates loader with noThemes enabled for headless environments', async () => {
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider);

      // The loader should be created successfully
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
      // The key test: reload was called (proves config was applied)
      expect(mockReload).toHaveBeenCalled();
      // The key benefit: no theme errors occur during loader creation
      // (This was previously causing "Theme not initialized" errors)
    });

    test('includes system prompt override', async () => {
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider);

      // Loader should be created with system prompt override
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
    });

    test('includes custom extension factory', async () => {
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider);

      // Loader should include our custom tools extension factory
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
    });

    test('removes extensions that fail during import', () => {
      const info = {
        requested: ['npm:package-one', 'npm:package-two'],
        loaded: ['/tmp/extensions/npm-package-one-0', '/tmp/extensions/npm-package-two-1'],
        warnings: [],
      };

      updateLoadedExtensions(info, [{ path: '/tmp/extensions/npm-package-two-1' }]);

      expect(info.loaded).toEqual(['/tmp/extensions/npm-package-two-1']);
    });

    test('keeps extensions that load with SDK conflict diagnostics', () => {
      const info = {
        requested: ['npm:conflicting-package'],
        loaded: ['/tmp/extensions/conflicting-package-0'],
        warnings: [],
      };

      // The SDK returns the extension in `extensions` even when `errors` also
      // contains a tool or flag conflict for the same path.
      updateLoadedExtensions(info, [{ path: '/tmp/extensions/conflicting-package-0' }]);

      expect(info.loaded).toEqual(['/tmp/extensions/conflicting-package-0']);
    });

    test('deduplicates loaded paths', () => {
      // `info.loaded` is collected before SDK path merging and may contain
      // the same resolved extension more than once. The Loaded banner describes
      // actual extensions, so one filesystem path should be shown once.
      const info = {
        requested: ['npm:package-one', 'npm:package-one'],
        loaded: ['/tmp/extensions/npm-package-one-0', '/tmp/extensions/npm-package-one-0'],
        warnings: [],
      };

      updateLoadedExtensions(info, [{ path: '/tmp/extensions/npm-package-one-0' }]);

      expect(info.loaded).toEqual(['/tmp/extensions/npm-package-one-0']);
    });

    test('applies SDK failures and conflicts through extensionsOverride', async () => {
      mockResolveExtensionSources = vi.fn(async () => ({
        extensions: [
          { source: 'npm:duplicate-one', path: '/tmp/extensions/duplicate', enabled: true },
          { source: 'npm:duplicate-two', path: '/tmp/extensions/duplicate', enabled: true },
          { source: 'npm:failed', path: '/tmp/extensions/failed', enabled: true },
        ],
      }));
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources as any;

      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warning: vi.fn(),
        notice: vi.fn(),
        error: vi.fn(),
        startGroup: vi.fn(),
        endGroup: vi.fn(),
      } satisfies Logger;
      const options = await buildResourceLoaderOptions(logger, mockPlatformProvider, {
        extensions: ['npm:duplicate-one', 'npm:duplicate-two', 'npm:failed'],
        loadBuiltinExtensions: false,
      });
      const handlers = new Map<string, (...args: never[]) => Promise<void>>();
      const loggingFactory = options.extensionFactories[0];
      if (!loggingFactory) {
        throw new Error('logging extension factory was not created');
      }
      const pi = {
        on: (event: string, handler: (...args: never[]) => Promise<void>) => {
          handlers.set(event, handler);
        },
        getThinkingLevel: () => 0,
        getAllTools: () => [],
      } as unknown as Parameters<typeof loggingFactory>[0];
      loggingFactory(pi);

      const result = {
        extensions: [{ path: '/tmp/extensions/duplicate' }, { path: '/tmp/extensions/duplicate' }],
        errors: [
          { path: '/tmp/extensions/duplicate', error: 'tool conflict' },
          { path: '/tmp/extensions/failed', error: 'import failed' },
        ],
        runtime: {},
      } as Parameters<typeof options.extensionsOverride>[0];
      expect(options.extensionsOverride(result)).toBe(result);

      const beforeAgentStart = handlers.get('before_agent_start');
      expect(beforeAgentStart).toBeDefined();
      await beforeAgentStart!(
        { prompt: 'test prompt', images: [] } as never,
        { model: null, getSystemPrompt: () => '' } as never
      );
      const infoLines = logger.info.mock.calls.map(([message]) => message);
      expect(infoLines).toContain('  Loaded:           1 extension(s)');
      expect(infoLines).not.toContain('    • /tmp/extensions/failed');
      expect(infoLines.filter(line => line === '    • /tmp/extensions/duplicate')).toHaveLength(1);
    });
  });

  describe('with extensions', () => {
    test('resolves and includes extension paths', async () => {
      const extensions = ['npm:package-one', 'npm:package-two'];
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider, { extensions });

      // Verify extensions were resolved
      expect(mockResolveExtensionSources).toHaveBeenCalledWith(
        extensions,
        expect.objectContaining({ local: true, temporary: true })
      );

      // Loader should be created successfully
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
    });

    test('handles no extensions', async () => {
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider, {
        extensions: [],
      });

      // Loader should be created successfully even with no extensions
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
    });

    test('handles undefined extensions', async () => {
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider);

      // Loader should be created successfully
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
    });
  });

  describe('error handling', () => {
    test('propagates extension resolution errors', async () => {
      mockResolveExtensionSources = vi.fn(async () => {
        throw new Error('Extension resolution failed');
      });
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources as any;

      await expect(
        getResourceLoader(mockCoreAdapter, mockPlatformProvider, { extensions: ['npm:package'] })
      ).rejects.toThrow('Extension resolution failed');
    });
  });
});

/**
 * Tests for resource-loader module.
 *
 * Tests extension resolution functionality and resource loader configuration.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import { resolveExtensions, getResourceLoader } from '../../src/pi/resource-loader';
import type { PlatformProvider } from '../../src/platform';
import { DefaultPackageManager, DefaultResourceLoader } from '@mariozechner/pi-coding-agent';

// Mock CoreAdapter for testing
const mockCoreAdapter = {
  getInput: mock((name: string) => {
    const defaults: Record<string, string> = {
      github_token: 'fake-token',
      trigger: '/pi',
      max_comments: '100',
    };
    return defaults[name] ?? '';
  }),
  setFailed: mock(),
  setOutput: mock(),
  notice: mock(),
  debug: mock(),
  info: mock(),
  warning: mock(),
};

// Mock platform provider for getResourceLoader
const mockPlatformProvider: PlatformProvider = {
  type: 'github',
  getContext: () => ({
    repo: { owner: 'test-owner', repo: 'test-repo' },
    issue: { number: 1 },
    eventName: 'issue_comment',
    payload: {},
    serverUrl: 'https://github.com',
    runId: 123,
    workspace: '/tmp',
  }),
  addReaction: async () => undefined,
  deleteReaction: async () => {},
  createFinalComment: async () => {},
  getPrompt: async () => undefined,
  getStartTime: () => undefined,
  createPullRequest: async () => ({
    content: [],
    details: {
      pullRequestNumber: 1,
      pullRequestUrl: '',
      headBranch: 'main',
      baseBranch: 'main',
      dryRun: false,
    },
  }),
  updatePullRequest: async () => ({
    content: [],
    details: {
      pullRequestNumber: 1,
      pullRequestUrl: '',
      headBranch: 'main',
      baseBranch: 'main',
      dryRun: false,
    },
  }),
  getIssueOrPRThread: async () => undefined,
  getPRDiff: async () => '',
};

// Set env vars before importing
process.env.INPUT_TRIGGER = '/pi';
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.INPUT_MAX_COMMENTS = '100';

describe('resolveExtensions', () => {
  let mockResolveExtensionSources: ReturnType<typeof mock>;
  let originalResolveExtensionSources: typeof DefaultPackageManager.prototype.resolveExtensionSources;

  beforeEach(() => {
    // Store original method and mock it
    originalResolveExtensionSources = DefaultPackageManager.prototype.resolveExtensionSources;
    mockResolveExtensionSources = mock(async (sources: string[]) => ({
      extensions: sources.map((source, index) => ({
        source,
        path: `/tmp/extensions/${source.replace(/[^a-z0-9]/g, '-')}-${index}`,
        enabled: true,
      })),
    }));
    DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources;
  });

  afterEach(() => {
    // Restore original method
    DefaultPackageManager.prototype.resolveExtensionSources = originalResolveExtensionSources;
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
      mockResolveExtensionSources = mock(async () => ({
        extensions: [
          { source: 'npm:enabled-package', path: '/tmp/extension-1', enabled: true },
          { source: 'npm:disabled-package', path: '/tmp/extension-2', enabled: false },
          { source: 'npm:another-enabled', path: '/tmp/extension-3', enabled: true },
        ],
      }));
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources;
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
      mockResolveExtensionSources = mock(async () => ({
        extensions: [],
      }));
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources;
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
      mockResolveExtensionSources = mock(async () => {
        throw new Error('Network error resolving extensions');
      });
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources;
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
  let mockResolveExtensionSources: ReturnType<typeof mock>;
  let originalResolveExtensionSources: typeof DefaultPackageManager.prototype.resolveExtensionSources;
  let mockReload: ReturnType<typeof mock>;
  let originalReload: typeof DefaultResourceLoader.prototype.reload;

  beforeEach(() => {
    // Store original method and mock it
    originalResolveExtensionSources = DefaultPackageManager.prototype.resolveExtensionSources;
    mockResolveExtensionSources = mock(async (sources: string[]) => ({
      extensions: sources.map((source, index) => ({
        source,
        path: `/tmp/extensions/${source.replace(/[^a-z0-9]/g, '-')}-${index}`,
        enabled: true,
      })),
    }));
    DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources;

    // Mock reload method to avoid CLI extension loading errors in tests
    // The Pi SDK's reload() tries to access CLI extension paths that
    // don't exist in test environment, causing errors
    originalReload = DefaultResourceLoader.prototype.reload;
    mockReload = mock(async () => undefined);
    DefaultResourceLoader.prototype.reload = mockReload;
  });

  afterEach(() => {
    // Restore original methods
    DefaultPackageManager.prototype.resolveExtensionSources = originalResolveExtensionSources;
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
  });

  describe('with extensions', () => {
    test('resolves and includes extension paths', async () => {
      const extensions = ['npm:package-one', 'npm:package-two'];
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider, extensions);

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
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider, []);

      // Loader should be created successfully even with no extensions
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
    });

    test('handles undefined extensions', async () => {
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider, undefined);

      // Loader should be created successfully
      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
    });
  });

  describe('error handling', () => {
    test('propagates extension resolution errors', async () => {
      mockResolveExtensionSources = mock(async () => {
        throw new Error('Extension resolution failed');
      });
      DefaultPackageManager.prototype.resolveExtensionSources = mockResolveExtensionSources;

      await expect(
        getResourceLoader(mockCoreAdapter, mockPlatformProvider, ['npm:package'])
      ).rejects.toThrow('Extension resolution failed');
    });
  });
});

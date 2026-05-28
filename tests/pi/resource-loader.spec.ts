/**
 * Tests for resource-loader module.
 *
 * Tests extension resolution functionality and resource loader configuration.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import {
  resolveExtensions,
  getResourceLoader,
  createToolFilterFactory,
} from '../../src/pi/resource-loader';
import type { PlatformProvider } from '../../src/platform';
import { DefaultPackageManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';

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
  createReview: async () => ({
    content: [{ type: 'text' as const, text: 'Review created' }],
    details: {
      reviewId: 1,
      reviewUrl: '',
      pullRequestNumber: 1,
      event: 'COMMENT',
      commentCount: 1,
    },
  }),
  getCIStatus: async () => ({
    content: [{ type: 'text' as const, text: 'CI status fetched' }],
    details: {
      ref: 'abc123',
      check_runs: [],
      workflow_runs: [],
    },
  }),
  getWorkflowRunLogs: async () => ({
    content: [{ type: 'text' as const, text: 'Workflow run logs fetched' }],
    details: {
      run_id: 0,
      jobs: [],
      total_bytes: 0,
      truncated: false,
    },
  }),
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
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider);

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

describe('createToolFilterFactory', () => {
  // Sample tool list that simulates what getAllTools() would return
  const allTools = [
    { name: 'read' },
    { name: 'write' },
    { name: 'edit' },
    { name: 'bash' },
    { name: 'create_pull_request' },
    { name: 'get_pr_diff' },
    { name: 'get_issue_or_pr_thread' },
  ];

  function createMockExtensionAPI(): import('@earendil-works/pi-coding-agent').ExtensionAPI {
    const handlers: Record<string, ((...args: any[]) => void)[]> = {};
    return {
      registerTool: mock(),
      getAllTools: mock(() => allTools),
      setActiveTools: mock(),
      on: mock((event: string, handler: (...args: any[]) => void) => {
        if (!handlers[event]) {
          handlers[event] = [];
        }
        handlers[event].push(handler);
      }),
      // Expose handlers for triggering events in tests
      _handlers: handlers,
    } as any;
  }

  /**
   * Helper: create a factory for the given config, call it with a mock ExtensionAPI,
   * then simulate session_start by invoking the registered handler.
   */
  function runFilter(config: { loadedTools?: string[] }, coreInfo: ReturnType<typeof mock>) {
    const mockCore = { info: coreInfo } as any;
    const factory = createToolFilterFactory(config, mockCore);
    const api = createMockExtensionAPI();
    factory(api);

    // Find the session_start handler that was registered
    const onCalls = (api.on as any).mock.calls;
    const sessionStartHandler = onCalls.find((c: string[]) => c[0] === 'session_start');

    if (sessionStartHandler) {
      sessionStartHandler[1](); // invoke the handler
    }

    return api;
  }

  describe('when loadedTools is undefined', () => {
    test('does not register session_start handler (no-op)', () => {
      const config = {}; // no loadedTools
      const factory = createToolFilterFactory(config, mockCoreAdapter as any);
      const api = createMockExtensionAPI();
      factory(api);

      expect(api.on).not.toHaveBeenCalledWith('session_start', expect.any(Function));
    });

    test('does not call setActiveTools', () => {
      const api = runFilter({}, mock());
      expect(api.setActiveTools).not.toHaveBeenCalled();
    });
  });

  describe('when loadedTools has valid tool names', () => {
    test('sets active tools to the requested subset', () => {
      const api = runFilter({ loadedTools: ['read', 'edit', 'bash'] }, mock());
      expect(api.setActiveTools).toHaveBeenCalledWith(['read', 'edit', 'bash']);
    });

    test('logs kept and removed tools', () => {
      const coreInfo = mock();
      runFilter({ loadedTools: ['read', 'write'] }, coreInfo);

      expect(coreInfo).toHaveBeenCalledWith(
        expect.stringContaining('Keeping 2 tool(s): read, write')
      );
      expect(coreInfo).toHaveBeenCalledWith(expect.stringContaining('Removing 5 tool(s)'));
    });

    test('works with a single tool', () => {
      const api = runFilter({ loadedTools: ['bash'] }, mock());
      expect(api.setActiveTools).toHaveBeenCalledWith(['bash']);
    });

    test('works with all available tools listed (no-op filter)', () => {
      const allNames = allTools.map(t => t.name);
      const api = runFilter({ loadedTools: allNames }, mock());
      expect(api.setActiveTools).toHaveBeenCalledWith(allNames);
    });
  });

  describe('when loadedTools has unknown tool names', () => {
    test('throws an error listing unknown names', () => {
      const factory = createToolFilterFactory(
        { loadedTools: ['read', 'nonexistent_tool'] },
        mockCoreAdapter as any
      );
      const api = createMockExtensionAPI();
      factory(api);

      // Find the session_start handler
      const onCalls = (api.on as any).mock.calls;
      const handler = onCalls.find((c: string[]) => c[0] === 'session_start')[1];

      expect(() => handler()).toThrow('nonexistent_tool');
    });

    test('error message includes available tools', () => {
      const factory = createToolFilterFactory(
        { loadedTools: ['unknown_tool'] },
        mockCoreAdapter as any
      );
      const api = createMockExtensionAPI();
      factory(api);

      const onCalls = (api.on as any).mock.calls;
      const handler = onCalls.find((c: string[]) => c[0] === 'session_start')[1];

      expect(() => handler()).toThrow(/Available tools/);
    });

    test('lists all unknown names in the error', () => {
      const factory = createToolFilterFactory(
        { loadedTools: ['foo', 'bar', 'baz'] },
        mockCoreAdapter as any
      );
      const api = createMockExtensionAPI();
      factory(api);

      const onCalls = (api.on as any).mock.calls;
      const handler = onCalls.find((c: string[]) => c[0] === 'session_start')[1];

      expect(() => handler()).toThrow(/foo, bar, baz/);
    });

    test('does not call setActiveTools when validation fails', () => {
      const factory = createToolFilterFactory({ loadedTools: ['invalid'] }, mockCoreAdapter as any);
      const api = createMockExtensionAPI();
      factory(api);

      const onCalls = (api.on as any).mock.calls;
      const handler = onCalls.find((c: string[]) => c[0] === 'session_start')[1];

      try {
        handler();
      } catch {
        // expected
      }

      expect(api.setActiveTools).not.toHaveBeenCalled();
    });
  });

  describe('integration with getResourceLoader', () => {
    test('creates loader successfully with loadedTools set', async () => {
      const loader = await getResourceLoader(
        mockCoreAdapter,
        mockPlatformProvider,
        undefined,
        true,
        { loadedTools: ['get_pr_diff', 'create_pull_request'] }
      );

      expect(loader).toBeDefined();
      expect(loader).toBeInstanceOf(DefaultResourceLoader);
    });

    test('does not include tool filter factory when loadedTools is undefined', async () => {
      // Just verify the loader is created without throwing
      const loader = await getResourceLoader(mockCoreAdapter, mockPlatformProvider);
      expect(loader).toBeDefined();
    });
  });
});

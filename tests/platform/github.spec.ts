/**
 * Tests for platform abstraction module.
 *
 * Tests platform detection, provider creation, and the module's
 * public API surface.
 */

import { describe, expect, test, mock, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const _mockedWrite = mock((...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock @actions/core
const noop = (): void => {};
mock.module('@actions/core', () => ({
  getInput: mock(() => ''),
  notice: mock(noop),
  info: mock(noop),
  debug: mock(noop),
  setFailed: mock(noop),
  warning: mock(noop),
}));

// Mock @actions/github context
const mockContext = {
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 123,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  eventName: 'issue_comment',
  payload: {} as Record<string, unknown>,
};
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Set env vars before importing modules
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-platform-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, JSON.stringify({}));

// Import after mocks are set up
import type { PlatformProvider } from '../../src/platform/types';
import { detectPlatform, createGitHubPlatformProvider } from '../../src/platform/github';

describe('detectPlatform', () => {
  const originalServerUrl = process.env.GITHUB_SERVER_URL;

  afterEach(() => {
    if (originalServerUrl !== undefined) {
      process.env.GITHUB_SERVER_URL = originalServerUrl;
    } else {
      delete process.env.GITHUB_SERVER_URL;
    }
  });

  test('returns github for github.com server URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    expect(detectPlatform()).toBe('github');
  });

  test('throws when GITHUB_SERVER_URL is not set', () => {
    delete process.env.GITHUB_SERVER_URL;
    expect(() => detectPlatform()).toThrow(/GITHUB_SERVER_URL environment variable is not set/);
  });

  test('returns codeberg for codeberg.org server URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://codeberg.org';
    expect(detectPlatform()).toBe('codeberg');
  });

  test('returns forgejo for server URL containing forgejo', () => {
    process.env.GITHUB_SERVER_URL = 'https://forgejo.example.com';
    expect(detectPlatform()).toBe('forgejo');
  });

  test('returns forgejo for server URL containing gitea', () => {
    process.env.GITHUB_SERVER_URL = 'https://gitea.example.com';
    expect(detectPlatform()).toBe('forgejo');
  });

  test('throws for unknown non-github.com server URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://git.mycompany.com';
    expect(() => detectPlatform()).toThrow(/Unsupported platform server URL/);
  });

  test('throws for GitHub Enterprise-like URL (custom domain)', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.mycompany.com';
    expect(() => detectPlatform()).toThrow(/Unsupported platform server URL/);
  });

  test('detects codeberg with subpath URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://codeberg.org/some/repo';
    expect(detectPlatform()).toBe('codeberg');
  });

  test('detects forgejo with nested subdomain', () => {
    process.env.GITHUB_SERVER_URL = 'https://git.forgejo.internal.company.net';
    expect(detectPlatform()).toBe('forgejo');
  });

  test('detects gitea with trailing slash', () => {
    process.env.GITHUB_SERVER_URL = 'https://gitea.example.com/';
    expect(detectPlatform()).toBe('forgejo');
  });

  test('error message includes the problematic URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://unknown.host';
    expect(() => detectPlatform()).toThrow('https://unknown.host');
  });

  test('error message mentions supported platforms', () => {
    process.env.GITHUB_SERVER_URL = 'https://unknown.host';
    expect(() => detectPlatform()).toThrow(/github\.com.*codeberg.*forgejo/i);
  });
});

describe('createGitHubPlatformProvider', () => {
  test('returns a PlatformProvider', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    const provider = createGitHubPlatformProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.addReaction).toBe('function');
    expect(typeof provider.deleteReaction).toBe('function');
    expect(typeof provider.createFinalComment).toBe('function');
    expect(typeof provider.getPrompt).toBe('function');
    expect(typeof provider.getStartTime).toBe('function');
    expect(typeof provider.createPullRequest).toBe('function');
    expect(typeof provider.updatePullRequest).toBe('function');
    expect(typeof provider.getIssueOrPRThread).toBe('function');
  });

  test('has a type property matching the detected platform', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    const provider = createGitHubPlatformProvider();
    expect(['github', 'codeberg', 'forgejo']).toContain(provider.type);
  });

  test('has a type of github in default CI environment', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    const provider = createGitHubPlatformProvider();
    expect(provider.type).toBe('github');
  });

  test('has type codeberg when GITHUB_SERVER_URL is codeberg', () => {
    const original = process.env.GITHUB_SERVER_URL;
    process.env.GITHUB_SERVER_URL = 'https://codeberg.org';
    const provider = createGitHubPlatformProvider();
    expect(provider.type).toBe('codeberg');
    process.env.GITHUB_SERVER_URL = original;
  });

  test('has type forgejo when GITHUB_SERVER_URL contains forgejo', () => {
    const original = process.env.GITHUB_SERVER_URL;
    process.env.GITHUB_SERVER_URL = 'https://forgejo.mycompany.com';
    const provider = createGitHubPlatformProvider();
    expect(provider.type).toBe('forgejo');
    process.env.GITHUB_SERVER_URL = original;
  });

  test('type property is immutable from TypeScript perspective (readonly)', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    const provider = createGitHubPlatformProvider();
    // The type property is typed as readonly in TypeScript but can be
    // reassigned at runtime in JavaScript. Verify it starts correct.
    expect(provider.type).toBe('github');
  });

  test('type is captured at creation time and not affected by later env changes', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    const provider = createGitHubPlatformProvider();
    expect(provider.type).toBe('github');
    // Change env after creation
    process.env.GITHUB_SERVER_URL = 'https://codeberg.org';
    // Provider type should still be 'github'
    expect(provider.type).toBe('github');
  });
});

describe('PlatformProvider interface compliance', () => {
  test('provider implements all required methods', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    const provider = createGitHubPlatformProvider();

    const requiredMethods: (keyof PlatformProvider)[] = [
      'addReaction',
      'deleteReaction',
      'createFinalComment',
      'getPrompt',
      'getStartTime',
      'createPullRequest',
      'updatePullRequest',
      'getIssueOrPRThread',
      'getContext',
    ];

    for (const method of requiredMethods) {
      expect(typeof provider[method]).toBe('function');
    }
  });
});

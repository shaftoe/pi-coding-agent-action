/**
 * Tests for platform module barrel exports.
 *
 * Verifies that the platform module correctly re-exports
 * detectPlatform, createGitHubPlatformProvider, and type exports.
 */

import { describe, expect, test, mock } from 'bun:test';
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
mock.module('@actions/github', () => ({
  context: {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    issue: { number: 123 },
    serverUrl: 'https://github.com',
    runId: 123456789,
    eventName: 'issue_comment',
    payload: {},
  },
}));

// Set env vars before importing modules
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_SERVER_URL = 'https://github.com';
process.env.GITHUB_EVENT_PATH = path.join(
  os.tmpdir(),
  `gh-event-platform-barrel-${Date.now()}.json`
);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, JSON.stringify({}));

// Import after mocks are set up
import { detectPlatform, createGitHubPlatformProvider } from '../../src/platform';

describe('platform barrel exports', () => {
  test('exports detectPlatform function', () => {
    expect(typeof detectPlatform).toBe('function');
  });

  test('exports createGitHubPlatformProvider function', () => {
    expect(typeof createGitHubPlatformProvider).toBe('function');
  });

  test('createGitHubPlatformProvider returns a valid provider', () => {
    const provider = createGitHubPlatformProvider();
    expect(provider).toBeDefined();
    expect(['github', 'codeberg', 'forgejo']).toContain(provider.type);
    expect(typeof provider.getContext).toBe('function');
    expect(typeof provider.addReaction).toBe('function');
  });
});

import { describe, expect, test, mock } from 'bun:test';

import { installGithubEnv } from '../../pi-orchestrator/tests/helpers/github-env';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations from @actions/core
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const _mockedWrite = mock((...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;
const noop = (): void => {};
const mockDebugLog: string[] = [];
const debugLogger = (msg: string): void => {
  mockDebugLog.push(msg);
};

// Set env vars BEFORE importing git-utils.ts
installGithubEnv();

// Dynamic import to ensure mocks are set before module loads
const gitUtilsModule = import('@alexanderfortin/pi-platform-github');

import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

function createTestDeps(): GitHubModuleDeps {
  return {
    octokit: {} as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'push',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: process.cwd(),
    },
    logger: {
      debug: debugLogger,
      info: noop,
      warning: noop,
      notice: noop,
      error: noop,
    },
  };
}

// Extract functions for convenience (using top-level await pattern)
const [{ createLogger }] = await Promise.all([gitUtilsModule]);

describe('createLogger', () => {
  test('creates logger with default emoji', () => {
    const logger = createLogger(createTestDeps());
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
  });

  test('creates logger with custom emoji', () => {
    const logger = createLogger(createTestDeps(), '🧪');
    expect(logger.debug).toBeDefined();
    expect(logger.info).toBeDefined();
  });
});

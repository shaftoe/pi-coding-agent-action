/**
 * Shared setup for `pi-platform-github` integration tests that hit the
 * GitHub REST API via Octokit.
 *
 * Bundles the boilerplate that was duplicated across
 * `tests/get-ci-status.spec.ts`, `tests/get-workflow-run-logs.spec.ts`,
 * and similar specs:
 *   - stdout annotation filter (swallow `::notice::` etc.)
 *   - shared `@actions/core` mock (auto-registered via `core-mock.ts`)
 *   - shared `@actions/github` context mock
 *   - GITHUB_* env vars + event-path file
 *   - `createTestDeps(octokit, options?)` factory for `GitHubModuleDeps`
 *
 * Importing this module automatically mocks `@actions/core` and
 * `@actions/github` (both via top-level `vi.mock`, hoisted before any test
 * imports resolve). The `@actions/github` mock returns a mutable
 * `mockGithubContext` object that `setupGitHubTestEnv()` / friends update
 * in place.
 */

import { vi } from 'vitest';

import { coreMock as importedCoreMock } from '../../../pi-orchestrator/tests/helpers/core-mock';
import { installGithubEnv } from '../../../pi-orchestrator/tests/helpers/github-env';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

export const coreMock: any = importedCoreMock;

/**
 * Default mock GitHub context object — no event name / sha / payload.
 *
 * If you need a fully-populated context (with `eventName` and `sha`),
 * use `defaultGitHubContext` below or `createTestDeps()`.
 */
export const defaultMockContext = {
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 42,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  payload: {} as Record<string, unknown>,
};

let stdoutStubInstalled = false;

/**
 * Patch `process.stdout.write` to swallow GitHub Actions annotation lines
 * (`::notice::`, `::warning::`, `::debug::`, …). Idempotent across calls.
 */
export function installStdoutAnnotationFilter(): void {
  if (stdoutStubInstalled) {
    return;
  }
  stdoutStubInstalled = true;
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const stub = vi.fn((...args: Parameters<typeof process.stdout.write>) => {
    const msg = String(args[0] ?? '');
    if (msg.startsWith('::')) {
      return true;
    }
    return realStdoutWrite(...args);
  });
  process.stdout.write = stub as typeof process.stdout.write;
}

/**
 * Default fake `@actions/github` context used by `setupGitHubTestEnv()` and
 * `createTestDeps()`. Has `eventName` and `sha` populated — pick this over
 * `defaultMockContext` when you need a fully-shaped context (most tool
 * execution tests).
 */
export const defaultGitHubContext = {
  repo: { owner: 'test-owner', repo: 'test-repo' },
  issue: { number: 42 },
  serverUrl: 'https://github.com',
  runId: 123456789,
  eventName: 'pull_request',
  sha: 'context-sha-12345678',
  payload: {},
} as const;

/**
 * Mutable mock context object backing the `@actions/github` mock. Mutated
 * in place by `registerGitHubContextMock()` / `setupGitHubTestEnv()` so the
 * hoisted `vi.mock` factory (which runs before test code) always returns a
 * live reference.
 */
const mockGithubContext: Record<string, unknown> = { ...defaultGitHubContext };

// Register the @actions/github mock at module top-level (hoisted by Vitest).
vi.mock('@actions/github', () => ({ context: mockGithubContext }));

/**
 * Replace the entire `mockGithubContext` with a fresh set of keys. Used by
 * `registerGitHubContextMock` and `setupGitHubContextMock`.
 */
function setMockContext(context: Record<string, unknown>): void {
  for (const key of Object.keys(mockGithubContext)) {
    delete mockGithubContext[key];
  }
  Object.assign(mockGithubContext, context);
}

/**
 * Update the `@actions/github` mock context, derived from
 * `defaultGitHubContext` (overridable).
 */
export function registerGitHubContextMock(overrides: Record<string, unknown> = {}): void {
  setMockContext({ ...defaultGitHubContext, ...overrides });
}

/**
 * Write an empty GitHub event JSON file to a unique OS temp path and return
 * the path. Also sets `GITHUB_REPOSITORY` and `INPUT_GITHUB_TOKEN`. Delegates
 * to the shared `installGithubEnv` helper in `pi-orchestrator/tests/helpers/`
 * (passing `inputTrigger: false` to preserve the legacy behavior of NOT
 * setting `INPUT_TRIGGER` — most callers configure it themselves).
 *
 * Re-exported here so existing callers within `pi-platform-github` don't
 * need a deeper relative import.
 */
export function installGitHubEnv(envPathPrefix = 'gh-event'): string {
  return installGithubEnv({ envPathPrefix, inputTrigger: false });
}

export interface SetupGitHubTestEnvOptions {
  /** Prefix for the temp event-path file (default `'gh-event'`). */
  envPathPrefix?: string;
  /** Overrides applied to `defaultGitHubContext` before mocking. */
  contextOverrides?: Record<string, unknown>;
}

/**
 * Register a custom `@actions/github` context mock with an explicit context
 * object. Use this instead of `setupGitHubTestEnv()` when a spec needs full
 * control over the context shape (e.g. git tests that don't care about
 * which event triggered them).
 */
export function setupGitHubContextMock(context: Record<string, unknown> = {}): void {
  installStdoutAnnotationFilter();
  setMockContext(context);
  installGitHubEnv(`gh-event-${Date.now()}`);
}

/**
 * Convenience: run all shared setup steps in the conventional order.
 * Returns the registered `coreMock` for direct spy access.
 *
 * `@actions/core` and `@actions/github` are already auto-mocked by importing
 * this module; this function additionally installs the stdout filter, applies
 * context overrides, and writes the GitHub event-path env file.
 *
 * ```ts
 * // top of spec file
 * const { coreMock } = setupGitHubTestEnv({ envPathPrefix: 'gh-event-ci' });
 * ```
 */
export function setupGitHubTestEnv(options: SetupGitHubTestEnvOptions = {}): {
  coreMock: typeof coreMock;
} {
  installStdoutAnnotationFilter();
  registerGitHubContextMock(options.contextOverrides ?? {});
  installGitHubEnv(options.envPathPrefix ?? 'gh-event');
  return { coreMock };
}

// ---------------------------------------------------------------------------
// createTestDeps factory
// ---------------------------------------------------------------------------

const noop = (): void => {};

export interface CreateTestDepsOptions {
  /** Override the GitHub event name (default `'pull_request'`). */
  eventName?: string;
  /** When `false`, omit the `sha` field from context (default `true`). */
  withSha?: boolean;
  /** Override the event payload (default `{}`). */
  payload?: Record<string, unknown>;
  /** Override the issue/PR number (default `42`). */
  issueNumber?: number;
}

/**
 * Build a `GitHubModuleDeps` object suitable for passing directly to
 * platform entry points (`getCIStatus`, `getWorkflowRunLogs`, etc.).
 */
export function createTestDeps(
  octokit: unknown,
  options: CreateTestDepsOptions = {}
): GitHubModuleDeps {
  const { eventName = 'pull_request', withSha = true, payload = {}, issueNumber = 42 } = options;
  return {
    octokit: octokit as any,
    context: {
      repo: defaultGitHubContext.repo,
      issue: { number: issueNumber },
      eventName,
      ...(withSha ? { sha: defaultGitHubContext.sha } : {}),
      payload,
      serverUrl: defaultGitHubContext.serverUrl,
      runId: defaultGitHubContext.runId,
      workspace: '/tmp',
    },
    logger: {
      debug: coreMock.debug,
      info: noop,
      warning: noop,
      notice: noop,
      error: noop,
    },
  };
}

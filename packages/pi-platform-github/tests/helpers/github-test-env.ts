/**
 * Shared setup for `pi-platform-github` integration tests that hit the
 * GitHub REST API via Octokit.
 *
 * Bundles the boilerplate that was duplicated across
 * `tests/get-ci-status.spec.ts`, `tests/get-workflow-run-logs.spec.ts`,
 * and similar specs:
 *   - stdout annotation filter (swallow `::notice::` etc.)
 *   - shared `@actions/core` mock via `registerCoreMock`
 *   - shared `@actions/github` context mock
 *   - GITHUB_* env vars + event-path file
 *   - `createTestDeps(octokit, options?)` factory for `GitHubModuleDeps`
 *
 * Each call to `setupGitHubTestEnv()` is idempotent across files; the
 * stdout stub is installed once, env vars are overwritten deterministically,
 * and `mock.module('@actions/github', ...)` is wrapped to be first-call-wins.
 */

import { mock } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { coreMock, registerCoreMock } from '../../../pi-orchestrator/tests/helpers/core-mock';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';

export { coreMock };

/**
 * Default mock GitHub context object (no event/payload specifics) — used by
 * `pi-platform-github` git tests that don't care about which event triggered
 * them.
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
  const stub = mock((...args: Parameters<typeof process.stdout.write>) => {
    const msg = String(args[0] ?? '');
    if (msg.startsWith('::')) {
      return true;
    }
    return realStdoutWrite(...args);
  });
  process.stdout.write = stub as typeof process.stdout.write;
}

/**
 * Default fake `@actions/github` context used by `setupGitHubTestEnv()`.
 * Tests can override per-call via `createTestDeps({ context: {...} })`.
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

let githubMockRegistered = false;

/**
 * Register the `@actions/github` mock module, exporting a `context` object
 * derived from `defaultGitHubContext` (overridable). First-call-wins so
 * multiple specs can safely call this in their top-level setup.
 */
export function registerGitHubContextMock(overrides: Record<string, unknown> = {}): void {
  if (githubMockRegistered) {
    return;
  }
  githubMockRegistered = true;
  const ctx = { ...defaultGitHubContext, ...overrides };
  mock.module('@actions/github', () => ({ context: ctx }));
}

/**
 * Write an empty GitHub event JSON file to a unique OS temp path and return
 * the path. Also sets `GITHUB_REPOSITORY` and `INPUT_GITHUB_TOKEN`.
 */
export function installGitHubEnv(envPathPrefix = 'gh-event'): string {
  process.env.INPUT_GITHUB_TOKEN = 'fake-token';
  process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
  const eventPath = path.join(os.tmpdir(), `${envPathPrefix}-${Date.now()}.json`);
  fs.writeFileSync(eventPath, JSON.stringify({}));
  process.env.GITHUB_EVENT_PATH = eventPath;
  return eventPath;
}

export interface SetupGitHubTestEnvOptions {
  /** Prefix for the temp event-path file (default `'gh-event'`). */
  envPathPrefix?: string;
  /** Overrides applied to `defaultGitHubContext` before `mock.module`. */
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
  registerCoreMock();
  mock.module('@actions/github', () => ({ context }));
  installGitHubEnv(`gh-event-${Date.now()}`);
}

/**
 * Convenience: run all four shared setup steps in the conventional order.
 * Returns the registered `coreMock` for direct spy access.
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
  registerCoreMock();
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

// ---------------------------------------------------------------------------
// Lazy module loader (replaces the getModule() pattern duplicated in specs)
// ---------------------------------------------------------------------------

const moduleCache = new Map<string, Promise<unknown>>();

/**
 * Lazily import a module by name, caching the promise. Useful when a spec
 * needs to wait for `mock.module()` registrations to take effect before
 * importing the production module under test.
 */
export function lazyLoadModule<T = unknown>(specifier: string): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return () => {
    if (!cached) {
      cached =
        (moduleCache.get(specifier) as Promise<T> | undefined) ?? (import(specifier) as Promise<T>);
      moduleCache.set(specifier, cached as Promise<unknown>);
    }
    return cached;
  };
}

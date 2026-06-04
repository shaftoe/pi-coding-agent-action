/**
 * Shared mocks for tool-execution specs.
 *
 * Eliminates the `mockCtx` + `createMockProvider` boilerplate that was
 * copy-pasted across `tests/pi/tools/*.spec.ts` and `tests/pi/tools.spec.ts`.
 */

import type { PlatformProvider } from '@alexanderfortin/pi-orchestrator';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

/**
 * Minimal mock `ExtensionContext` that satisfies the tool `execute` signature.
 * Safe to share across tests since it is never mutated by tool code.
 */
export const mockExtensionContext = {
  ui: {},
  hasUI: false,
  cwd: '/tmp',
  sessionManager: {},
  modelRegistry: {},
  model: undefined,
  isIdle: () => true,
  signal: undefined,
  abort: () => {},
  hasPendingMessages: () => false,
  shutdown: () => {},
  getContextUsage: () => undefined,
  compact: () => {},
  getSystemPrompt: () => '',
} as unknown as ExtensionContext;

export interface MockProviderContextOptions {
  /** Issue/PR number exposed via `provider.getContext().issue.number`. Defaults to `1`. */
  issueNumber?: number;
  /** Event name exposed via `provider.getContext().eventName`. Defaults to `issue_comment`. */
  eventName?: string;
}

/**
 * Builds a mock `PlatformProvider` for tool execution tests. Pass `overrides`
 * to replace any method (e.g. swap in a `mock()`-tracked implementation), and
 * `options` to vary the context's issue number or event name.
 */
export function createMockProvider(
  overrides?: Partial<PlatformProvider>,
  options?: MockProviderContextOptions
): PlatformProvider {
  const issueNumber = options?.issueNumber ?? 1;
  const eventName = options?.eventName ?? 'issue_comment';

  return {
    type: 'github',
    getContext: () => ({
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: issueNumber },
      eventName,
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
      content: [{ type: 'text' as const, text: 'PR created' }],
      details: {
        pullRequestNumber: 1,
        pullRequestUrl: '',
        headBranch: '',
        baseBranch: '',
        dryRun: false,
      },
    }),
    updatePullRequest: async () => ({
      content: [{ type: 'text' as const, text: 'PR updated' }],
      details: {
        pullRequestNumber: 1,
        pullRequestUrl: '',
        headBranch: '',
        baseBranch: '',
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
    ...overrides,
  };
}

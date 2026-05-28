/**
 * @file Tests for the platform-level getCIStatus implementation.
 *
 * Tests the actual GitHub API interaction logic including ref resolution,
 * check run fetching, workflow run fetching, filtering, and summary formatting.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test, mock, beforeEach, beforeAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Swallow ::notice:: / ::warning:: / ::debug:: annotations
const realStdoutWrite = process.stdout.write.bind(process.stdout);
const _mockedWrite = mock((...args: any[]) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('::')) {
    return true;
  }
  return realStdoutWrite(...(args as Parameters<typeof process.stdout.write>));
});
process.stdout.write = _mockedWrite as typeof process.stdout.write;

// Mock @actions/core
const noop = (): void => {};
const mockDebug = mock(noop);
mock.module('@actions/core', () => ({
  getInput: mock(() => 'fake-token'),
  notice: mock(noop),
  info: mock(noop),
  debug: mockDebug,
  setFailed: mock(noop),
  setOutput: mock(noop),
  warning: mock(noop),
}));

// Mock @actions/github context
const mockContext = {
  repo: {
    owner: 'test-owner',
    repo: 'test-repo',
  },
  issue: {
    number: 42,
  },
  serverUrl: 'https://github.com',
  runId: 123456789,
  eventName: 'pull_request',
  sha: 'context-sha-12345678',
  payload: {},
};
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Set env vars before importing modules
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-ci-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, JSON.stringify({}));

// Mock octokit
const mockPullsGet = mock(() =>
  Promise.resolve({
    data: { head: { sha: 'pr-head-sha-abcdef' } },
  })
);

const mockChecksListForRef = mock(() =>
  Promise.resolve({
    data: {
      check_runs: [] as any[],
    },
  })
);

const mockListWorkflowRuns = mock(() =>
  Promise.resolve({
    data: {
      workflow_runs: [] as any[],
    },
  })
);

const mockOctokit = {
  rest: {
    pulls: {
      get: mockPullsGet,
    },
    checks: {
      listForRef: mockChecksListForRef,
    },
    actions: {
      listWorkflowRunsForRepo: mockListWorkflowRuns,
    },
  },
};
mock.module('../../../src/platform/github/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

// Lazy import after mocks are set up
const getCIStatusModulePromise = import('../../../src/platform/github/tools/get-ci-status.js');

let getCIStatus: any;
let resetModuleContext: any;

async function getModule() {
  if (!getCIStatus) {
    const mod = await getCIStatusModulePromise;
    getCIStatus = mod.getCIStatus;
  }
  return getCIStatus;
}

beforeAll(async () => {
  const indexMod = await import('../../../src/platform/github/index.js');
  resetModuleContext = indexMod.resetModuleContext;
  resetModuleContext({
    debug: mockDebug,
  } as any);
  await getModule();
});

describe('getCIStatus - platform implementation', () => {
  beforeEach(() => {
    mockPullsGet.mockClear();
    mockChecksListForRef.mockClear();
    mockListWorkflowRuns.mockClear();
    mockDebug.mockClear();

    // Default: no context SHA
    (mockContext as any).sha = 'context-sha-12345678';

    // Reset to default empty responses
    mockChecksListForRef.mockImplementation(() =>
      Promise.resolve({ data: { check_runs: [] } })
    );
    mockListWorkflowRuns.mockImplementation(() =>
      Promise.resolve({ data: { workflow_runs: [] } })
    );
  });

  // ─── Ref resolution ────────────────────────────────────────────

  describe('ref resolution', () => {
    test('uses explicit ref when provided', async () => {
      const fn = await getModule();
      const result = await fn({ ref: 'explicit-ref-abc' });

      expect(mockPullsGet).not.toHaveBeenCalled();
      expect(result.details.ref).toBe('explicit-ref-abc');
    });

    test('resolves head SHA from pull_number', async () => {
      const fn = await getModule();
      const result = await fn({ pull_number: 99 });

      expect(mockPullsGet).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        pull_number: 99,
      });
      expect(result.details.ref).toBe('pr-head-sha-abcdef');
    });

    test('prefers explicit ref over pull_number', async () => {
      const fn = await getModule();
      const result = await fn({ ref: 'explicit-ref', pull_number: 99 });

      expect(mockPullsGet).not.toHaveBeenCalled();
      expect(result.details.ref).toBe('explicit-ref');
    });

    test('falls back to context SHA when no ref or pull_number', async () => {
      const fn = await getModule();
      const result = await fn({});

      expect(mockPullsGet).not.toHaveBeenCalled();
      expect(result.details.ref).toBe('context-sha-12345678');
    });

    test('returns error message when context SHA is empty', async () => {
      const fn = await getModule();
      (mockContext as any).sha = '';

      const result = await fn({});

      expect(result.content[0].text).toContain('Could not resolve ref');
      expect(result.details.ref).toBe('');
      expect(result.details.check_runs).toEqual([]);
      expect(result.details.workflow_runs).toEqual([]);
    });

    test('uses owner/repo from params when provided', async () => {
      const fn = await getModule();
      await fn({ owner: 'custom-owner', repo: 'custom-repo', ref: 'abc' });

      expect(mockChecksListForRef).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'custom-owner',
          repo: 'custom-repo',
        })
      );
    });

    test('uses owner/repo from context when not provided', async () => {
      const fn = await getModule();
      await fn({ ref: 'abc' });

      expect(mockChecksListForRef).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'test-owner',
          repo: 'test-repo',
        })
      );
    });
  });

  // ─── Check runs ────────────────────────────────────────────────

  describe('check runs', () => {
    test('fetches check runs for the resolved ref', async () => {
      const fn = await getModule();
      mockChecksListForRef.mockImplementation(() =>
        Promise.resolve({
          data: {
            check_runs: [
              {
                id: 1,
                name: 'build',
                status: 'completed',
                conclusion: 'success',
                started_at: '2024-01-01T00:00:00Z',
                completed_at: '2024-01-01T00:05:00Z',
                html_url: 'https://github.com/test/runs/1',
                details_url: 'https://details.example.com/1',
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc12345' });

      expect(mockChecksListForRef).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'abc12345',
          per_page: 50,
        })
      );
      expect(result.details.check_runs).toHaveLength(1);
      expect(result.details.check_runs[0].name).toBe('build');
      expect(result.details.check_runs[0].conclusion).toBe('success');
    });

    test('maps null conclusion to null in result', async () => {
      const fn = await getModule();
      mockChecksListForRef.mockImplementation(() =>
        Promise.resolve({
          data: {
            check_runs: [
              {
                id: 2,
                name: 'pending-check',
                status: 'queued',
                conclusion: null,
                started_at: null,
                completed_at: null,
                html_url: 'https://github.com/test/runs/2',
                details_url: null,
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc' });

      expect(result.details.check_runs[0].conclusion).toBeNull();
      expect(result.details.check_runs[0].started_at).toBeNull();
    });

    test('passes status filter to API', async () => {
      const fn = await getModule();
      await fn({ ref: 'abc', status: 'completed' });

      expect(mockChecksListForRef).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
        })
      );
    });

    test('passes filter: "all" when conclusion is provided', async () => {
      const fn = await getModule();
      await fn({ ref: 'abc', conclusion: 'failure' });

      expect(mockChecksListForRef).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: 'all',
        })
      );
    });

    test('client-side filters check runs by conclusion', async () => {
      const fn = await getModule();
      mockChecksListForRef.mockImplementation(() =>
        Promise.resolve({
          data: {
            check_runs: [
              { id: 1, name: 'build', status: 'completed', conclusion: 'success', started_at: null, completed_at: null, html_url: '', details_url: null },
              { id: 2, name: 'test', status: 'completed', conclusion: 'failure', started_at: null, completed_at: null, html_url: '', details_url: null },
              { id: 3, name: 'lint', status: 'completed', conclusion: 'success', started_at: null, completed_at: null, html_url: '', details_url: null },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc', conclusion: 'failure' });

      expect(result.details.check_runs).toHaveLength(1);
      expect(result.details.check_runs[0].name).toBe('test');
    });

    test('includes details_url in formatted output when present', async () => {
      const fn = await getModule();
      mockChecksListForRef.mockImplementation(() =>
        Promise.resolve({
          data: {
            check_runs: [
              {
                id: 1,
                name: 'build',
                status: 'completed',
                conclusion: 'success',
                started_at: null,
                completed_at: null,
                html_url: 'https://github.com/test/runs/1',
                details_url: 'https://details.example.com/1',
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc12345' });

      expect(result.content[0].text).toContain('https://details.example.com/1');
    });
  });

  // ─── Workflow runs ─────────────────────────────────────────────

  describe('workflow runs', () => {
    test('fetches workflow runs for the resolved ref', async () => {
      const fn = await getModule();
      mockListWorkflowRuns.mockImplementation(() =>
        Promise.resolve({
          data: {
            workflow_runs: [
              {
                id: 100,
                name: 'CI Pipeline',
                status: 'completed',
                conclusion: 'failure',
                run_started_at: '2024-01-01T00:00:00Z',
                html_url: 'https://github.com/test/actions/runs/100',
                head_branch: 'feature-branch',
                head_sha: 'abc123456789',
                event: 'push',
                created_at: null,
                path: '.github/workflows/ci.yml',
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc' });

      expect(mockListWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({
          head_sha: 'abc',
          per_page: 50,
        })
      );
      expect(result.details.workflow_runs).toHaveLength(1);
      expect(result.details.workflow_runs[0].name).toBe('CI Pipeline');
      expect(result.details.workflow_runs[0].head_sha).toBe('abc12345');
    });

    test('passes status filter to workflow runs API', async () => {
      const fn = await getModule();
      await fn({ ref: 'abc', status: 'in_progress' });

      expect(mockListWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'in_progress',
        })
      );
    });

    test('falls back to path-derived name when name is null', async () => {
      const fn = await getModule();
      mockListWorkflowRuns.mockImplementation(() =>
        Promise.resolve({
          data: {
            workflow_runs: [
              {
                id: 101,
                name: null,
                status: 'completed',
                conclusion: 'success',
                run_started_at: null,
                html_url: 'https://github.com/test/actions/runs/101',
                head_branch: 'main',
                head_sha: 'def456789',
                event: 'push',
                created_at: '2024-01-01T00:00:00Z',
                path: '.github/workflows/deploy.yml',
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc' });

      expect(result.details.workflow_runs[0].name).toBe('deploy.yml');
    });

    test('falls back to "unknown" when name and path are both null', async () => {
      const fn = await getModule();
      mockListWorkflowRuns.mockImplementation(() =>
        Promise.resolve({
          data: {
            workflow_runs: [
              {
                id: 102,
                name: null,
                status: null,
                conclusion: null,
                run_started_at: null,
                html_url: 'https://github.com/test/actions/runs/102',
                head_branch: null,
                head_sha: null,
                event: 'push',
                created_at: null,
                path: null,
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc' });

      expect(result.details.workflow_runs[0].name).toBe('unknown');
      expect(result.details.workflow_runs[0].status).toBe('unknown');
      expect(result.details.workflow_runs[0].head_branch).toBe('');
      expect(result.details.workflow_runs[0].head_sha).toBe('');
    });

    test('uses created_at when run_started_at is null', async () => {
      const fn = await getModule();
      mockListWorkflowRuns.mockImplementation(() =>
        Promise.resolve({
          data: {
            workflow_runs: [
              {
                id: 103,
                name: 'Test',
                status: 'completed',
                conclusion: 'success',
                run_started_at: null,
                created_at: '2024-02-01T00:00:00Z',
                html_url: 'https://github.com/test/actions/runs/103',
                head_branch: 'main',
                head_sha: 'ghi789',
                event: 'push',
                path: null,
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc' });

      expect(result.details.workflow_runs[0].started_at).toBe('2024-02-01T00:00:00Z');
    });
  });

  // ─── Summary formatting ────────────────────────────────────────

  describe('summary formatting', () => {
    test('shows "No check runs" message when no results', async () => {
      const fn = await getModule();
      // Default mocks return empty arrays
      const result = await fn({ ref: 'abc12345' });

      expect(result.content[0].text).toContain('No check runs or workflow runs found for this ref.');
    });

    test('formats check runs with status icons', async () => {
      const fn = await getModule();
      mockChecksListForRef.mockImplementation(() =>
        Promise.resolve({
          data: {
            check_runs: [
              {
                id: 1,
                name: 'build',
                status: 'completed',
                conclusion: 'failure',
                started_at: null,
                completed_at: null,
                html_url: '',
                details_url: null,
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc12345' });

      expect(result.content[0].text).toContain('❌');
      expect(result.content[0].text).toContain('build: completed (failure)');
      expect(result.content[0].text).toContain('Check Runs (1)');
    });

    test('formats workflow runs with event and run ID', async () => {
      const fn = await getModule();
      mockListWorkflowRuns.mockImplementation(() =>
        Promise.resolve({
          data: {
            workflow_runs: [
              {
                id: 200,
                name: 'CI',
                status: 'completed',
                conclusion: 'success',
                run_started_at: null,
                created_at: null,
                html_url: 'https://github.com/test/actions/runs/200',
                head_branch: 'main',
                head_sha: 'abc12345',
                event: 'push',
                path: null,
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc12345' });

      expect(result.content[0].text).toContain('✅');
      expect(result.content[0].text).toContain('CI [push]');
      expect(result.content[0].text).toContain('Run ID: 200');
    });

    test('includes short SHA in header', async () => {
      const fn = await getModule();
      const result = await fn({ ref: 'abcdef1234567890' });

      expect(result.content[0].text).toContain('CI Status for abcdef12');
    });

    test('does not include conclusion when it is null', async () => {
      const fn = await getModule();
      mockChecksListForRef.mockImplementation(() =>
        Promise.resolve({
          data: {
            check_runs: [
              {
                id: 1,
                name: 'running',
                status: 'in_progress',
                conclusion: null,
                started_at: null,
                completed_at: null,
                html_url: '',
                details_url: null,
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc' });

      // "in_progress" should not be followed by a conclusion in parentheses
      expect(result.content[0].text).toContain('running: in_progress');
      expect(result.content[0].text).not.toContain('running: in_progress (');
    });
  });

  // ─── Combined fetch ────────────────────────────────────────────

  describe('parallel fetch', () => {
    test('returns both check runs and workflow runs', async () => {
      const fn = await getModule();
      mockChecksListForRef.mockImplementation(() =>
        Promise.resolve({
          data: {
            check_runs: [
              {
                id: 1,
                name: 'build',
                status: 'completed',
                conclusion: 'success',
                started_at: null,
                completed_at: null,
                html_url: '',
                details_url: null,
              },
            ],
          },
        })
      );
      mockListWorkflowRuns.mockImplementation(() =>
        Promise.resolve({
          data: {
            workflow_runs: [
              {
                id: 100,
                name: 'CI',
                status: 'completed',
                conclusion: 'success',
                run_started_at: null,
                created_at: null,
                html_url: 'https://github.com/test/actions/runs/100',
                head_branch: 'main',
                head_sha: 'abc12345',
                event: 'push',
                path: null,
              },
            ],
          },
        })
      );

      const result = await fn({ ref: 'abc12345' });

      expect(result.details.check_runs).toHaveLength(1);
      expect(result.details.workflow_runs).toHaveLength(1);
      expect(result.details.ref).toBe('abc12345');
      expect(result.content[0].text).toContain('Check Runs (1)');
      expect(result.content[0].text).toContain('Workflow Runs (1)');
    });
  });
});

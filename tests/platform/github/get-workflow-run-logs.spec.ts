/**
 * @file Tests for the platform-level getWorkflowRunLogs implementation.
 *
 * Tests the actual GitHub API interaction logic including job listing,
 * log downloading, truncation, byte budget management, and output formatting.
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
  payload: {},
};
mock.module('@actions/github', () => ({
  context: mockContext,
}));

// Set env vars before importing modules
process.env.INPUT_GITHUB_TOKEN = 'fake-token';
process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), `gh-event-logs-${Date.now()}.json`);
fs.writeFileSync(process.env.GITHUB_EVENT_PATH, JSON.stringify({}));

// Mock octokit
const mockListJobsForWorkflowRun = mock(() =>
  Promise.resolve({
    data: { jobs: [] as any[] },
  })
);

const mockDownloadJobLogs = mock(() =>
  Promise.resolve({ data: '' as any })
);

const mockOctokit = {
  rest: {
    actions: {
      listJobsForWorkflowRun: mockListJobsForWorkflowRun,
      downloadJobLogsForWorkflowRun: mockDownloadJobLogs,
    },
  },
};
mock.module('../../../src/platform/github/octokit', () => ({
  getOctokit: mock(() => mockOctokit),
}));

// Lazy import after mocks are set up
const logsModulePromise = import('../../../src/platform/github/tools/get-workflow-run-logs.js');

let getWorkflowRunLogs: any;

async function getModule() {
  if (!getWorkflowRunLogs) {
    const mod = await logsModulePromise;
    getWorkflowRunLogs = mod.getWorkflowRunLogs;
  }
  return getWorkflowRunLogs;
}

beforeAll(async () => {
  const indexMod = await import('../../../src/platform/github/index.js');
  indexMod.resetModuleContext({
    debug: mockDebug,
  } as any);
  await getModule();
});

describe('getWorkflowRunLogs - platform implementation', () => {
  beforeEach(() => {
    mockListJobsForWorkflowRun.mockClear();
    mockDownloadJobLogs.mockClear();
    mockDebug.mockClear();
  });

  // ─── Empty results ─────────────────────────────────────────────

  describe('no jobs', () => {
    test('returns message when no jobs found', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({ data: { jobs: [] } })
      );

      const result = await fn({ run_id: 999 });

      expect(result.content[0].text).toContain('No jobs found for workflow run 999');
      expect(result.details.run_id).toBe(999);
      expect(result.details.jobs).toEqual([]);
      expect(result.details.total_bytes).toBe(0);
      expect(result.details.truncated).toBe(false);
    });
  });

  // ─── Job listing ───────────────────────────────────────────────

  describe('job listing', () => {
    test('lists jobs for the specified run ID', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              {
                id: 201,
                name: 'build',
                status: 'completed',
                conclusion: 'success',
                started_at: '2024-01-01T00:00:00Z',
                completed_at: '2024-01-01T00:05:00Z',
              },
              {
                id: 202,
                name: 'test',
                status: 'completed',
                conclusion: 'failure',
                started_at: '2024-01-01T00:05:00Z',
                completed_at: '2024-01-01T00:10:00Z',
              },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: 'log output\n' })
      );

      const result = await fn({ run_id: 100 });

      expect(mockListJobsForWorkflowRun).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        run_id: 100,
        per_page: 100,
      });
      expect(result.details.jobs).toHaveLength(2);
      expect(result.details.jobs[0].name).toBe('build');
      expect(result.details.jobs[1].name).toBe('test');
    });

    test('maps job fields correctly', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              {
                id: 300,
                name: 'deploy',
                status: 'completed',
                conclusion: null,
                started_at: '2024-01-01T00:00:00Z',
                completed_at: '2024-01-01T00:05:00Z',
              },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: 'deploy log' })
      );

      const result = await fn({ run_id: 100 });

      const job = result.details.jobs[0];
      expect(job.id).toBe(300);
      expect(job.name).toBe('deploy');
      expect(job.status).toBe('completed');
      expect(job.conclusion).toBeNull();
      expect(job.started_at).toBe('2024-01-01T00:00:00Z');
    });

    test('defaults null status to "unknown"', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              {
                id: 301,
                name: 'unknown-job',
                status: null,
                conclusion: null,
                started_at: null,
                completed_at: null,
              },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: '' })
      );

      const result = await fn({ run_id: 100 });

      expect(result.details.jobs[0].status).toBe('unknown');
    });

    test('uses custom owner/repo from params', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({ data: { jobs: [] } })
      );

      await fn({ run_id: 100, owner: 'custom', repo: 'repo' });

      expect(mockListJobsForWorkflowRun).toHaveBeenCalledWith({
        owner: 'custom',
        repo: 'repo',
        run_id: 100,
        per_page: 100,
      });
    });
  });

  // ─── Log downloading ───────────────────────────────────────────

  describe('log downloading', () => {
    test('downloads logs for each job', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 401, name: 'job-a', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
              { id: 402, name: 'job-b', status: 'completed', conclusion: 'failure', started_at: null, completed_at: null },
            ],
          },
        })
      );
      // Return different log for each job based on call order
      const logs = ['logs for job 401', 'logs for job 402'];
      let callIdx = 0;
      mockDownloadJobLogs.mockImplementation(() => {
        const log = logs[callIdx] ?? 'unknown';
        callIdx++;
        return Promise.resolve({ data: log });
      });

      const result = await fn({ run_id: 100 });

      expect(mockDownloadJobLogs).toHaveBeenCalledTimes(2);
      expect(mockDownloadJobLogs).toHaveBeenCalledWith(
        expect.objectContaining({ job_id: 401 })
      );
      expect(mockDownloadJobLogs).toHaveBeenCalledWith(
        expect.objectContaining({ job_id: 402 })
      );
      expect(result.details.jobs[0].log).toBe('logs for job 401');
      expect(result.details.jobs[1].log).toBe('logs for job 402');
    });

    test('handles non-string log data by stringifying it', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 500, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: { message: 'not a string' } })
      );

      const result = await fn({ run_id: 100 });

      expect(result.details.jobs[0].log).toBe('{"message":"not a string"}');
    });
  });

  // ─── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    test('returns partial results when a job log download fails', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 501, name: 'build', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
              { id: 502, name: 'test', status: 'completed', conclusion: 'failure', started_at: null, completed_at: null },
            ],
          },
        })
      );
      let callIdx = 0;
      mockDownloadJobLogs.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          return Promise.resolve({ data: 'build log output' });
        }
        return Promise.reject(new Error('Logs expired'));
      });

      const result = await fn({ run_id: 100 });

      // First job should have its log
      expect(result.details.jobs[0].log).toBe('build log output');
      expect(result.details.jobs[0].truncated).toBe(false);
      // Second job should have error marker
      expect(result.details.jobs[1].log).toContain('log unavailable');
      expect(result.details.jobs[1].log).toContain('Logs expired');
    });
  });

  // ─── Byte budget & truncation ──────────────────────────────────

  describe('byte budget and truncation', () => {
    test('defaults max_bytes to 51200 (50KB)', async () => {
      const fn = await getModule();
      const longLog = 'x'.repeat(60000);
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 601, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: longLog })
      );

      const result = await fn({ run_id: 100 });

      // The log should be truncated since 60000 > 51200
      expect(result.details.jobs[0].truncated).toBe(true);
      expect(result.details.truncated).toBe(true);
    });

    test('caps max_bytes at 1MB (1048576)', async () => {
      const fn = await getModule();
      const bigLog = 'x'.repeat(2_000_000);
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 606, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: bigLog })
      );

      // Request 2MB, but cap at 1MB
      const result = await fn({ run_id: 100, max_bytes: 2_000_000 });

      expect(result.details.jobs[0].truncated).toBe(true);
      // log is 2MB, budget capped at 1MB: log must be truncated
      const logByteLength = Buffer.byteLength(result.details.jobs[0].log, 'utf8');
      // Should use roughly 1MB budget (capped), much less than the 2MB requested
      expect(logByteLength).toBeLessThan(1_500_000);
      expect(logByteLength).toBeGreaterThan(900_000);
    });

    test('respects custom max_bytes parameter', async () => {
      const fn = await getModule();
      const log = 'A'.repeat(200);
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 602, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: log })
      );

      const result = await fn({ run_id: 100, max_bytes: 100 });

      expect(result.details.jobs[0].truncated).toBe(true);
      expect(result.details.truncated).toBe(true);
      // Truncated log should be less than original
      expect(result.details.jobs[0].log.length).toBeLessThan(log.length);
    });

    test('does not truncate logs within budget', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 603, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: 'short log' })
      );

      const result = await fn({ run_id: 100, max_bytes: 10000 });

      expect(result.details.jobs[0].truncated).toBe(false);
      expect(result.details.truncated).toBe(false);
      expect(result.details.jobs[0].log).toBe('short log');
    });

    test('truncates at newline boundary (keeps tail)', async () => {
      const fn = await getModule();
      const log = 'line1\nline2\nline3\nline4\nline5\n';
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 604, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: log })
      );

      // Use a budget smaller than the full log (30 bytes) but large enough for prefix (16 bytes) + partial tail
      const result = await fn({ run_id: 100, max_bytes: 25 });

      expect(result.details.jobs[0].truncated).toBe(true);
      // Should snap to a newline boundary (not cut mid-line)
      expect(result.details.jobs[0].log).toContain('... (truncated)');
      // Tail truncation: should contain the last line, not the first
      expect(result.details.jobs[0].log).toContain('line5');
      expect(result.details.jobs[0].log).not.toContain('line1');
    });

    test('marks job as truncated when byte budget is exhausted', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 701, name: 'job-a', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
              { id: 702, name: 'job-b', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
              { id: 703, name: 'job-c', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: 'x'.repeat(200) })
      );

      // Give a budget that only covers ~2 jobs' worth of log
      const result = await fn({ run_id: 100, max_bytes: 250 });

      const truncatedCount = result.details.jobs.filter((j: any) => j.truncated).length;
      expect(truncatedCount).toBeGreaterThanOrEqual(1);
      expect(result.details.truncated).toBe(true);
    });

    test('handles zero-byte budget by marking all jobs as truncated', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 800, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );

      const result = await fn({ run_id: 100, max_bytes: 0 });

      expect(result.details.jobs[0].truncated).toBe(true);
      expect(result.details.jobs[0].log).toContain('byte budget exhausted');
      expect(mockDownloadJobLogs).not.toHaveBeenCalled();
    });

    test('tracks total_bytes accurately', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 900, name: 'job-a', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
              { id: 901, name: 'job-b', status: 'completed', conclusion: 'failure', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs
        .mockImplementationOnce(() => Promise.resolve({ data: 'hello' }))
        .mockImplementationOnce(() => Promise.resolve({ data: 'world' }));

      const result = await fn({ run_id: 100, max_bytes: 10000 });

      expect(result.details.total_bytes).toBe(
        Buffer.byteLength('hello', 'utf8') + Buffer.byteLength('world', 'utf8')
      );
    });
  });

  // ─── Output formatting ─────────────────────────────────────────

  describe('output formatting', () => {
    test('includes run ID in header', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 2000, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: 'output\n' })
      );

      const result = await fn({ run_id: 42 });

      expect(result.content[0].text).toContain('Workflow Run #42');
    });

    test('formats job header with conclusion', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 1001, name: 'build', status: 'completed', conclusion: 'failure', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: 'error line\n' })
      );

      const result = await fn({ run_id: 100 });

      expect(result.content[0].text).toContain('Job: build (failure)');
      expect(result.content[0].text).toContain('❌');
    });

    test('formats job header with status when conclusion is null', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 1002, name: 'running', status: 'in_progress', conclusion: null, started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: 'still running\n' })
      );

      const result = await fn({ run_id: 100 });

      expect(result.content[0].text).toContain('Job: running (in_progress)');
      expect(result.content[0].text).toContain('🔄');
    });

    test('includes log output after job header', async () => {
      const fn = await getModule();
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 1003, name: 'build', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: 'Line 1\nLine 2\nLine 3\n' })
      );

      const result = await fn({ run_id: 100 });

      expect(result.content[0].text).toContain('Line 1\nLine 2\nLine 3');
    });
  });

  // ─── Unicode handling ──────────────────────────────────────────

  describe('unicode handling', () => {
    test('handles multi-byte characters in log truncation (keeps tail)', async () => {
      const fn = await getModule();
      // String with multi-byte characters (emoji, CJK)
      const log = 'Hello 🌍 世界 🎉 ' + 'x'.repeat(200) + '\n';
      mockListJobsForWorkflowRun.mockImplementation(() =>
        Promise.resolve({
          data: {
            jobs: [
              { id: 1100, name: 'job', status: 'completed', conclusion: 'success', started_at: null, completed_at: null },
            ],
          },
        })
      );
      mockDownloadJobLogs.mockImplementation(() =>
        Promise.resolve({ data: log })
      );

      // Small budget that will force truncation across multi-byte boundaries
      const result = await fn({ run_id: 100, max_bytes: 20 });

      expect(result.details.jobs[0].truncated).toBe(true);
      // The truncated log should be valid UTF-8 (no replacement characters)
      expect(result.details.jobs[0].log).not.toContain('\ufffd');
    });
  });
});

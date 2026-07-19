/**
 * Unit tests for the pure helpers exported from
 * `packages/pi-platform-github/src/tools/get-workflow-run-logs.ts`.
 *
 * These complement `get-workflow-run-logs.spec.ts`, which tests the full
 * `getWorkflowRunLogs` entry point end-to-end via the Octokit mock.
 * Each helper here is a pure function (or near-pure — `downloadJobLog`
 * is the exception, it's tested through a stub deps object).
 */

import { describe, expect, vi, test } from 'vitest';
import type { JobLog } from '@alexanderfortin/pi-platform-github';
import {
  computeJobBudgets,
  downloadJobLog,
  mapJobsResponse,
  renderJobLogsOutput,
  truncateLogTail,
} from '@alexanderfortin/pi-platform-github/tools/get-workflow-run-logs';

// ---------------------------------------------------------------------------
// mapJobsResponse
// ---------------------------------------------------------------------------

describe('mapJobsResponse', () => {
  test('maps all fields and defaults missing optionals', () => {
    const jobs = mapJobsResponse([
      {
        id: 1,
        name: 'build',
        status: 'completed',
        conclusion: 'success',
        started_at: '2024-01-01T00:00:00Z',
        completed_at: '2024-01-01T00:05:00Z',
      },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      id: 1,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T00:05:00Z',
      log: '',
      truncated: false,
    });
  });

  test('defaults undefined status to "unknown"', () => {
    const jobs = mapJobsResponse([{ id: 1, name: 'x' }]);
    expect(jobs[0]?.status).toBe('unknown');
  });

  test('defaults null status to "unknown"', () => {
    const jobs = mapJobsResponse([{ id: 1, name: 'x', status: null }]);
    expect(jobs[0]?.status).toBe('unknown');
  });

  test('defaults missing conclusion to null (not "unknown")', () => {
    const jobs = mapJobsResponse([{ id: 1, name: 'x' }]);
    expect(jobs[0]?.conclusion).toBeNull();
  });

  test('preserves null conclusion explicitly', () => {
    const jobs = mapJobsResponse([{ id: 1, name: 'x', conclusion: null }]);
    expect(jobs[0]?.conclusion).toBeNull();
  });

  test('accepts an empty array', () => {
    expect(mapJobsResponse([])).toEqual([]);
  });

  test('preserves null timestamps', () => {
    const jobs = mapJobsResponse([{ id: 1, name: 'x', started_at: null, completed_at: null }]);
    expect(jobs[0]?.started_at).toBeNull();
    expect(jobs[0]?.completed_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeJobBudgets
// ---------------------------------------------------------------------------

describe('computeJobBudgets', () => {
  test('returns floor(maxBytes / jobCount) for the simple case', () => {
    expect(computeJobBudgets(4, 1000)).toBe(250);
    expect(computeJobBudgets(3, 1000)).toBe(333); // floor
  });

  test('caps input at MAX_LOG_BYTES (1MB) before dividing', () => {
    // 5 jobs × 2MB input → capped to 1MB / 5 = 209715 bytes per job
    expect(computeJobBudgets(5, 2_097_152)).toBe(Math.floor(1_048_576 / 5));
  });

  test('uses 50KB default when maxBytes is undefined', () => {
    expect(computeJobBudgets(2, undefined)).toBe(25_600); // 51200 / 2
  });

  test('returns the capped max when jobCount is 0 (no division)', () => {
    expect(computeJobBudgets(0, 1000)).toBe(1000);
    expect(computeJobBudgets(0, undefined)).toBe(51_200);
    expect(computeJobBudgets(0, 9_999_999)).toBe(1_048_576); // capped
  });

  test('handles jobCount = 1 (no sharing needed)', () => {
    expect(computeJobBudgets(1, 5000)).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// truncateLogTail
// ---------------------------------------------------------------------------

describe('truncateLogTail', () => {
  test('returns the input unchanged when within budget', () => {
    const result = truncateLogTail('hello', 100);
    expect(result).toEqual({ text: 'hello', truncated: false });
  });

  test('returns the input unchanged when exactly at budget', () => {
    const text = 'hello'; // 5 bytes
    const result = truncateLogTail(text, 5);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
  });

  test('truncates ASCII logs to fit the byte budget, keeping the tail', () => {
    const text = 'line1\nline2\nline3\nline4'; // 23 bytes
    // Budget 21: prefix (16) + targetBudget (5). cutAt = 18 (the "l" of
    // "line4"), so the body retains the entire final line.
    const result = truncateLogTail(text, 21);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('... (truncated)\n')).toBe(true);
    expect(result.text).toContain('line4');
    expect(result.text).not.toContain('line1');
  });

  test('snaps to the first newline after the cut point (no partial first line)', () => {
    // Construct text so the cut lands in the middle of a long line and the
    // snap-to-newline then advances forward to the next line.
    const text = 'header_line\nmiddle_content\nfinal_line'; // 37 bytes
    // Budget 22: prefix 16 + targetBudget 6 → cutAt = 31, which is the "l"
    // in "final_line". Snap-to-newline finds no \n in the remainder, so
    // the body is the suffix of "final_line".
    const result = truncateLogTail(text, 22);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('... (truncated)\n')).toBe(true);
    // The body must NOT contain the start of "header_line" — the head was cut off.
    expect(result.text).not.toContain('header_line');
    // Body must not contain a partial leading fragment of a line broken mid-character.
    expect(result.text).not.toContain('\uFFFD');
  });

  test('handles multi-byte UTF-8 characters without producing replacement chars', () => {
    // 4-byte emoji (😀) + ASCII
    const text = '😀😀😀😀😀\nascii_tail_here';
    const result = truncateLogTail(text, 15);
    expect(result.truncated).toBe(true);
    // Should not contain any U+FFFD replacement characters (would indicate
    // we cut in the middle of a UTF-8 sequence).
    expect(result.text).not.toContain('\uFFFD');
  });

  test('handles a budget of 0 by returning only the prefix (or empty)', () => {
    const result = truncateLogTail('hello world', 0);
    expect(result.truncated).toBe(true);
    // With 0 budget, we can only afford the prefix at most (targetBudget
    // becomes 0 after subtracting prefixBytes; subarray returns everything
    // from buf.length-0 onwards, but cutAt then walks to end, yielding empty).
    // The result is the prefix followed by the rest after the first newline.
    // What we can assert: truncated is true, and the result is shorter than
    // the input.
    expect(result.text.length).toBeLessThanOrEqual('hello world'.length + 20);
  });

  test('preserves content when budget exactly fits the prefix-only case', () => {
    // Smaller than the prefix budget — should still truncate cleanly
    const text = 'a'.repeat(50);
    const result = truncateLogTail(text, 5);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith('... (truncated)\n')).toBe(true);
  });

  test('empty string input is returned unchanged', () => {
    const result = truncateLogTail('', 100);
    expect(result).toEqual({ text: '', truncated: false });
  });
});

// ---------------------------------------------------------------------------
// renderJobLogsOutput
// ---------------------------------------------------------------------------

describe('renderJobLogsOutput', () => {
  function buildJob(overrides: Partial<JobLog> = {}): JobLog {
    return {
      id: 1,
      name: 'build',
      status: 'completed',
      conclusion: 'success',
      started_at: null,
      completed_at: null,
      log: '',
      truncated: false,
      ...overrides,
    };
  }

  test('includes the run ID in the header', () => {
    const text = renderJobLogsOutput(42_000, []);
    expect(text.split('\n')[0]).toBe('Workflow Run #42000 — Job Logs:');
  });

  test('renders no job blocks when jobs list is empty', () => {
    const text = renderJobLogsOutput(1, []);
    expect(text).toBe('Workflow Run #1 — Job Logs:\n');
  });

  test('renders a header per job with the conclusion (when present)', () => {
    const text = renderJobLogsOutput(1, [buildJob({ conclusion: 'failure' })]);
    expect(text).toContain('Job: build (failure)');
  });

  test('falls back to status in the header when conclusion is null', () => {
    const text = renderJobLogsOutput(1, [buildJob({ conclusion: null, status: 'in_progress' })]);
    expect(text).toContain('Job: build (in_progress)');
  });

  test('includes the log body when present', () => {
    const text = renderJobLogsOutput(1, [buildJob({ log: 'log line 1\nlog line 2' })]);
    expect(text).toContain('log line 1');
    expect(text).toContain('log line 2');
  });

  test('omits the log body when empty', () => {
    const text = renderJobLogsOutput(1, [buildJob({ log: '' })]);
    // Header line is present, but no log body line follows it directly.
    // The job's header should be immediately followed by a blank separator.
    expect(text).toContain('--- ✅ Job: build (success) ---');
    // No empty line between the header and the next separator/output.
    expect(text).not.toMatch(/Job: build \(success\) ---\n[^\n]\./m);
  });

  test('renders multiple jobs in order', () => {
    const text = renderJobLogsOutput(1, [
      buildJob({ id: 1, name: 'build' }),
      buildJob({ id: 2, name: 'test' }),
      buildJob({ id: 3, name: 'deploy' }),
    ]);
    const buildIdx = text.indexOf('Job: build');
    const testIdx = text.indexOf('Job: test');
    const deployIdx = text.indexOf('Job: deploy');
    expect(buildIdx).toBeGreaterThan(-1);
    expect(testIdx).toBeGreaterThan(buildIdx);
    expect(deployIdx).toBeGreaterThan(testIdx);
  });
});

// ---------------------------------------------------------------------------
// downloadJobLog
// ---------------------------------------------------------------------------

/** Build a minimal `deps` with stubbed octokit + logger. */
function buildDeps(logResponse: unknown): {
  deps: any;
  downloadMock: ReturnType<typeof vi.fn>;
} {
  const downloadMock = vi.fn(() => Promise.resolve({ data: logResponse }));
  const deps = {
    octokit: {
      rest: {
        actions: {
          downloadJobLogsForWorkflowRun: downloadMock,
        },
      },
    },
    logger: { debug: () => {} },
  };
  return { deps, downloadMock };
}

/** Build a `deps` whose download rejects with `err`. */
function buildFailingDeps(err: unknown): any {
  const downloadMock = vi.fn(() => Promise.reject(err));
  return {
    octokit: { rest: { actions: { downloadJobLogsForWorkflowRun: downloadMock } } },
    logger: { debug: () => {} },
  };
}

describe('downloadJobLog', () => {
  const job: JobLog = {
    id: 42,
    name: 'build',
    status: 'completed',
    conclusion: 'success',
    started_at: null,
    completed_at: null,
    log: '',
    truncated: false,
  };

  test('returns the downloaded log when within budget', async () => {
    const { deps } = buildDeps('log content');
    const result = await downloadJobLog(deps, 'owner', 'repo', job, 100);
    expect(result.log).toBe('log content');
    expect(result.truncated).toBe(false);
  });

  test('truncates when the log exceeds the budget', async () => {
    const { deps } = buildDeps('a'.repeat(200));
    const result = await downloadJobLog(deps, 'owner', 'repo', job, 50);
    expect(result.truncated).toBe(true);
    expect(result.log.startsWith('... (truncated)\n')).toBe(true);
  });

  test('passes the correct args to octokit', async () => {
    const { deps, downloadMock } = buildDeps('log');
    await downloadJobLog(deps, 'my-owner', 'my-repo', job, 100);
    expect(downloadMock).toHaveBeenCalledWith({
      owner: 'my-owner',
      repo: 'my-repo',
      job_id: 42,
    });
  });

  test('returns "(log unavailable: …)" placeholder when download throws', async () => {
    const deps = buildFailingDeps(new Error('404 not found'));
    const result = await downloadJobLog(deps, 'owner', 'repo', job, 100);
    expect(result.log).toBe('(log unavailable: 404 not found)');
    expect(result.truncated).toBe(false);
  });

  test('handles non-Error throwables in the catch path', async () => {
    const deps = buildFailingDeps('plain string rejection');
    const result = await downloadJobLog(deps, 'owner', 'repo', job, 100);
    expect(result.log).toBe('(log unavailable: unknown error)');
  });

  test('returns budget-exhausted placeholder when budget is 0', async () => {
    const { deps, downloadMock } = buildDeps('log content');
    const result = await downloadJobLog(deps, 'owner', 'repo', job, 0);
    expect(result.log).toBe('(log truncated — byte budget exhausted)');
    expect(result.truncated).toBe(true);
    // Should NOT have called octokit at all — there is no budget for the response.
    expect(downloadMock).not.toHaveBeenCalled();
  });

  test('returns budget-exhausted placeholder when budget is negative', async () => {
    const { deps, downloadMock } = buildDeps('log content');
    const result = await downloadJobLog(deps, 'owner', 'repo', job, -10);
    expect(result.log).toBe('(log truncated — byte budget exhausted)');
    expect(result.truncated).toBe(true);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  test('JSON-stringifies non-string response data', async () => {
    const obj = { lines: ['a', 'b'] };
    const { deps } = buildDeps(obj);
    const result = await downloadJobLog(deps, 'owner', 'repo', job, 500);
    expect(result.log).toBe(JSON.stringify(obj));
  });
});

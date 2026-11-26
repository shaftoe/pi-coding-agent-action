/**
 * @file Workflow run log fetching.
 *
 * Provides the server-side logic for the `get_workflow_run_logs` custom tool:
 * queries the GitHub Actions API for job logs of a specific workflow run.
 *
 * Structure:
 *   - Pure helpers (`mapJobsResponse`, `computeJobBudgets`, `truncateLogTail`,
 *     `renderJobLogsOutput`) — exported so they can be unit-tested directly.
 *   - `downloadJobLog` — wraps the per-job API call.
 *   - `getWorkflowRunLogs` — the entry point. Orchestrates: list jobs or fetch
 *     a specific job (verifying its run ID) → download the selected logs
 *     (respecting the byte budget) → render the output.
 */

import type {
  GitHubModuleDeps,
  GetWorkflowRunLogsParams,
  GetWorkflowRunLogsDetails,
  JobLog,
} from '../types';
import { getStatusIcon } from './ci-utils';

export type { GetWorkflowRunLogsParams, GetWorkflowRunLogsDetails, JobLog };

/** Default max log bytes (50 KB). */
const DEFAULT_MAX_LOG_BYTES = 51_200;

/** Absolute maximum log bytes (1 MB). */
const MAX_LOG_BYTES = 1_048_576;

/** Prefix prepended to truncated logs. */
const TRUNCATION_PREFIX = '... (truncated)\n';

/** Placeholder used when a job's log download fails. */
const LOG_UNAVAILABLE_PREFIX = '(log unavailable: ';

/** Placeholder used when the per-run byte budget has been exhausted. */
const BUDGET_EXHAUSTED_MESSAGE = '(log truncated — byte budget exhausted)';

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Input shape we accept from Octokit's `listJobsForWorkflowRun` response. */
export interface RawJob {
  id: number;
  name: string;
  status?: string | null;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

/**
 * Map raw Octokit job objects to the local `JobLog` shape (no log content yet).
 */
export function mapJobsResponse(jobs: RawJob[]): JobLog[] {
  // fallow-ignore-next-line complexity
  return jobs.map(job => ({
    id: job.id,
    name: job.name,
    status: job.status ?? 'unknown',
    conclusion: job.conclusion ?? null,
    started_at: job.started_at ?? null,
    completed_at: job.completed_at ?? null,
    log: '',
    truncated: false,
  }));
}

/**
 * Compute the per-job byte budget and the absolute max-bytes cap.
 *
 * `bytesPerJob` is the fair-share value: `floor(maxBytes / jobCount)`.
 * The caller is responsible for further clamping it against the
 * remaining budget before each download.
 */
export function computeJobBudgets(jobCount: number, maxBytesInput: number | undefined): number {
  const maxBytes = Math.min(maxBytesInput ?? DEFAULT_MAX_LOG_BYTES, MAX_LOG_BYTES);
  if (jobCount <= 0) {
    return maxBytes;
  }
  return Math.floor(maxBytes / jobCount);
}

/**
 * Truncate a log string to fit within `jobBudget` bytes, keeping the **tail**
 * (errors typically appear at the end of a log). Handles UTF-8 boundaries
 * and snaps to the first newline after the cut point so the truncated output
 * doesn't start mid-line.
 *
 * Returns:
 *   - the (possibly truncated) log text, with `TRUNCATION_PREFIX` prepended
 *     when truncation occurred
 *   - the `truncated` flag
 */
// fallow-ignore-next-line complexity
export function truncateLogTail(
  logText: string,
  jobBudget: number
): {
  text: string;
  truncated: boolean;
} {
  const rawBytes = Buffer.byteLength(logText, 'utf8');
  if (rawBytes <= jobBudget) {
    return { text: logText, truncated: false };
  }

  // Reserve space for the truncation prefix, then walk forward to a safe
  // UTF-8 character boundary.
  const prefixBytes = Buffer.byteLength(TRUNCATION_PREFIX, 'utf8');
  const targetBudget = Math.max(jobBudget - prefixBytes, 0);
  const buf = Buffer.from(logText, 'utf8');
  let cutAt = Math.max(buf.length - targetBudget, 0);
  while (cutAt < buf.length && ((buf[cutAt] ?? 0) & 0xc0) === 0x80) {
    cutAt++;
  }
  let sliced = buf.subarray(cutAt).toString('utf8');

  // Snap to first newline so the truncated output starts on a clean line.
  const firstNewline = sliced.indexOf('\n');
  if (firstNewline > 0) {
    sliced = sliced.slice(firstNewline + 1);
  }

  return { text: TRUNCATION_PREFIX + sliced, truncated: true };
}

/**
 * Build the human-readable output string and the aggregate `truncated` flag
 * from a list of (already-downloaded-and-truncated) jobs.
 */
// fallow-ignore-next-line complexity
export function renderJobLogsOutput(runId: number, jobs: JobLog[]): string {
  const lines: string[] = [`Workflow Run #${runId} — Job Logs:`, ''];
  for (const job of jobs) {
    const icon = getStatusIcon(job.conclusion ? 'completed' : job.status, job.conclusion);
    lines.push(`--- ${icon} Job: ${job.name} (${job.conclusion ?? job.status}) ---`);
    if (job.log) {
      lines.push(job.log);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Per-job log download
// ---------------------------------------------------------------------------

/**
 * Result of attempting to download a single job's log. Exactly one of
 * `log`, `error`, or `budgetExhausted` will be set.
 */
export interface JobLogDownload {
  log: string;
  truncated: boolean;
}

/**
 * Download a single job's log, respecting the per-job byte budget. Returns
 * a placeholder string (rather than throwing) when the download fails or
 * the budget has been exhausted.
 */
// fallow-ignore-next-line complexity
export async function downloadJobLog(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  job: JobLog,
  jobBudget: number
): Promise<JobLogDownload> {
  if (jobBudget <= 0) {
    return { log: BUDGET_EXHAUSTED_MESSAGE, truncated: true };
  }

  let logText: string;
  try {
    const logResponse = await deps.octokit.rest.actions.downloadJobLogsForWorkflowRun({
      owner,
      repo,
      job_id: job.id,
    });
    logText =
      typeof logResponse.data === 'string' ? logResponse.data : JSON.stringify(logResponse.data);
  } catch (e) {
    return {
      log: `${LOG_UNAVAILABLE_PREFIX}${e instanceof Error ? e.message : 'unknown error'})`,
      truncated: false,
    };
  }

  const { text, truncated } = truncateLogTail(logText, jobBudget);
  return { log: text, truncated };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Get logs for a specific workflow run.
 *
 * Lists all jobs for the run, or fetches a specific job when `job_id` is set,
 * and downloads their logs. A requested job must belong to the given run.
 * Logs are concatenated and truncated if they exceed `max_bytes`.
 *
 * @param deps - Module dependencies.
 * @param params - Parameters including the run ID, optional job ID and byte limit.
 * @returns Structured details about the workflow run logs.
 */
// fallow-ignore-next-line complexity
export async function getWorkflowRunLogs(
  deps: GitHubModuleDeps,
  params: GetWorkflowRunLogsParams
): Promise<{
  content: { type: 'text'; text: string }[];
  details: GetWorkflowRunLogsDetails;
}> {
  const owner = params.owner ?? deps.context.repo.owner;
  const repo = params.repo ?? deps.context.repo.repo;
  const maxBytes = Math.min(params.max_bytes ?? DEFAULT_MAX_LOG_BYTES, MAX_LOG_BYTES);

  deps.logger.debug(`[getWorkflowRunLogs] Fetching logs for run ${params.run_id}`);

  // 1. Fetch a specific job directly, or list jobs for the workflow run.
  // Direct lookup also supports jobs outside the first page or from older attempts.
  let rawJobs: RawJob[];
  if (params.job_id !== undefined) {
    const response = await deps.octokit.rest.actions.getJobForWorkflowRun({
      owner,
      repo,
      job_id: params.job_id,
    });
    if (response.data.run_id !== params.run_id) {
      throw new Error(`Job ${params.job_id} does not belong to workflow run ${params.run_id}.`);
    }
    rawJobs = [response.data];
  } else {
    const response = await deps.octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: params.run_id,
      per_page: 100,
    });
    rawJobs = response.data.jobs;
  }
  const jobs = mapJobsResponse(rawJobs);

  if (jobs.length === 0) {
    return {
      content: [{ type: 'text', text: `No jobs found for workflow run ${params.run_id}.` }],
      details: {
        run_id: params.run_id,
        jobs: [],
        total_bytes: 0,
        truncated: false,
      },
    };
  }

  // 2. Download each job's log, respecting the shared byte budget
  const bytesPerJob = computeJobBudgets(jobs.length, params.max_bytes);
  let totalBytesUsed = 0;
  let overallTruncated = false;

  for (const job of jobs) {
    const remainingBudget = maxBytes - totalBytesUsed;
    const jobBudget = Math.max(Math.min(bytesPerJob, remainingBudget), 0);

    const result = await downloadJobLog(deps, owner, repo, job, jobBudget);
    job.log = result.log;
    job.truncated = result.truncated;
    totalBytesUsed += Buffer.byteLength(result.log, 'utf8');
    if (result.truncated) {
      overallTruncated = true;
    }
  }

  // 3. Render human-readable output
  const text = renderJobLogsOutput(params.run_id, jobs);

  return {
    content: [{ type: 'text', text }],
    details: {
      run_id: params.run_id,
      jobs,
      total_bytes: totalBytesUsed,
      truncated: overallTruncated,
    },
  };
}

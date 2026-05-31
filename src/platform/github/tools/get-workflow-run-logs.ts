/**
 * @file Workflow run log fetching.
 *
 * Provides the server-side logic for the `get_workflow_run_logs` custom tool:
 * queries the GitHub Actions API for job logs of a specific workflow run.
 */

import { getGitHubContext } from '../context-accessor';

function ctx() { return getGitHubContext(); }
import { getOctokit } from '../octokit';
import { getCoreAdapter } from '../index';
import type {
  GetWorkflowRunLogsParams,
  GetWorkflowRunLogsDetails,
  JobLog,
} from '../types';
import { getStatusIcon } from './ci-utils';

export type {
  GetWorkflowRunLogsParams,
  GetWorkflowRunLogsDetails,
  JobLog,
};

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  getCoreAdapter().debug(msg);
}

/** Default max log bytes (50 KB). */
const DEFAULT_MAX_LOG_BYTES = 51_200;

/** Absolute maximum log bytes (1 MB). */
const MAX_LOG_BYTES = 1_048_576;

/**
 * Get logs for a specific workflow run.
 *
 * Lists all jobs for the run and downloads their logs. Logs are
 * concatenated and truncated if they exceed `max_bytes`.
 *
 * @param params - Parameters including the run ID and optional byte limit.
 * @returns Structured details about the workflow run logs.
 */
export async function getWorkflowRunLogs(params: GetWorkflowRunLogsParams): Promise<{
  content: { type: 'text'; text: string }[];
  details: GetWorkflowRunLogsDetails;
}> {
  const owner = params.owner ?? ctx().repo.owner;
  const repo = params.repo ?? ctx().repo.repo;
  const maxBytes = Math.min(params.max_bytes ?? DEFAULT_MAX_LOG_BYTES, MAX_LOG_BYTES);

  debug(`[getWorkflowRunLogs] Fetching logs for run ${params.run_id}`);

  // List jobs for the workflow run
  const octokit = getOctokit();
  const response = await octokit.rest.actions.listJobsForWorkflowRun({
    owner,
    repo,
    run_id: params.run_id,
    per_page: 100,
  });

  const jobs: JobLog[] = response.data.jobs.map(job => ({
    id: job.id,
    name: job.name,
    status: job.status ?? 'unknown',
    conclusion: job.conclusion,
    started_at: job.started_at,
    completed_at: job.completed_at,
    log: '',
    truncated: false,
  }));

  if (jobs.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No jobs found for workflow run ${params.run_id}.`,
        },
      ],
      details: {
        run_id: params.run_id,
        jobs: [],
        total_bytes: 0,
        truncated: false,
      },
    };
  }

  // Download logs for each job, respecting byte budget
  const truncationPrefix = '... (truncated)\n';
  const prefixBytes = Buffer.byteLength(truncationPrefix, 'utf8');
  let totalBytesUsed = 0;
  const bytesPerJob = Math.floor(maxBytes / jobs.length);

  for (const job of jobs) {
    const remainingBudget = maxBytes - totalBytesUsed;
    const jobBudget = Math.max(Math.min(bytesPerJob, remainingBudget), 0);

    if (jobBudget <= 0) {
      job.log = '(log truncated — byte budget exhausted)';
      job.truncated = true;
      continue;
    }

    let logText: string;
    try {
      const logResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: job.id,
      });

      logText = typeof logResponse.data === 'string'
        ? logResponse.data
        : JSON.stringify(logResponse.data);
    } catch (e) {
      job.log = `(log unavailable: ${e instanceof Error ? e.message : 'unknown error'})`;
      totalBytesUsed += Buffer.byteLength(job.log, 'utf8');
      continue;
    }

    if (Buffer.byteLength(logText, 'utf8') > jobBudget) {
      // Reserve space for the truncation prefix
      const targetBudget = Math.max(jobBudget - prefixBytes, 0);
      const buf = Buffer.from(logText, 'utf8');
      const totalBytes = buf.length;
      // Keep the tail (end) of the log — errors are typically at the end
      const startAt = Math.max(totalBytes - targetBudget, 0);
      // Walk forward to safe UTF-8 boundary
      let cutAt = startAt;
      while (cutAt < totalBytes && ((buf[cutAt] ?? 0) & 0xc0) === 0x80) {
        cutAt++;
      }
      let sliced = buf.subarray(cutAt).toString('utf8');
      // Snap to first newline (to avoid showing a partial line at the start)
      const firstNewline = sliced.indexOf('\n');
      if (firstNewline > 0) {
        sliced = sliced.slice(firstNewline + 1);
      }
      job.log = truncationPrefix + sliced;
      job.truncated = true;
      totalBytesUsed += Buffer.byteLength(job.log, 'utf8');
    } else {
      job.log = logText;
      totalBytesUsed += Buffer.byteLength(logText, 'utf8');
    }
  }

  // Build human-readable output
  const lines: string[] = [
    `Workflow Run #${params.run_id} — Job Logs:`,
    '',
  ];

  let overallTruncated = false;
  for (const job of jobs) {
    const icon = getStatusIcon(
      job.conclusion ? 'completed' : job.status,
      job.conclusion
    );
    lines.push(`--- ${icon} Job: ${job.name} (${job.conclusion ?? job.status}) ---`);
    if (job.log) {
      lines.push(job.log);
    }
    if (job.truncated) {
      overallTruncated = true;
    }
    lines.push('');
  }

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
    details: {
      run_id: params.run_id,
      jobs,
      total_bytes: totalBytesUsed,
      truncated: overallTruncated,
    },
  };
}

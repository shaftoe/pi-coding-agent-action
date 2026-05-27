/**
 * @file Workflow run log fetching.
 *
 * Provides the server-side logic for the `get_workflow_run_logs` custom tool:
 * queries the GitHub Actions API for job logs of a specific workflow run.
 */

import * as github from '@actions/github';
import { getOctokit } from '../octokit';
import { getCoreAdapter } from '../index';
import type {
  GetWorkflowRunLogsParams,
  GetWorkflowRunLogsDetails,
  JobLog,
} from '../types';

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
  const owner = params.owner ?? github.context.repo.owner;
  const repo = params.repo ?? github.context.repo.repo;
  const maxBytes = params.max_bytes ?? DEFAULT_MAX_LOG_BYTES;

  debug(`[getWorkflowRunLogs] Fetching logs for run ${params.run_id}`);

  // List jobs for the workflow run
  let jobs: JobLog[];
  try {
    const octokit = getOctokit();
    const response = await octokit.rest.actions.listJobsForWorkflowRun({
      owner,
      repo,
      run_id: params.run_id,
    });

    jobs = response.data.jobs.map(job => ({
      id: job.id,
      name: job.name,
      status: job.status ?? 'unknown',
      conclusion: job.conclusion,
      started_at: job.started_at,
      completed_at: job.completed_at,
      log: '',
      truncated: false,
    }));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text' as const,
          text: `Failed to list jobs for run ${params.run_id}: ${msg}`,
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

    try {
      const octokit = getOctokit();
      const logResponse = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner,
        repo,
        job_id: job.id,
      });

      const logText = typeof logResponse.data === 'string'
        ? logResponse.data
        : JSON.stringify(logResponse.data);

      if (Buffer.byteLength(logText, 'utf8') > jobBudget) {
        const buf = Buffer.from(logText, 'utf8');
        let cutAt = Math.min(jobBudget, buf.length);
        // Walk back to safe UTF-8 boundary
        while (cutAt > 0 && ((buf[cutAt] ?? 0) & 0xc0) === 0x80) {
          cutAt--;
        }
        let sliced = buf.subarray(0, cutAt).toString('utf8');
        // Snap to last newline
        const lastNewline = sliced.lastIndexOf('\n');
        if (lastNewline > 0) {
          sliced = sliced.slice(0, lastNewline);
        }
        job.log = sliced + '\n... (truncated)';
        job.truncated = true;
        totalBytesUsed += Buffer.byteLength(job.log, 'utf8');
      } else {
        job.log = logText;
        totalBytesUsed += Buffer.byteLength(logText, 'utf8');
      }
    } catch (_e) {
      debug(`[getWorkflowRunLogs] Failed to fetch logs for job ${job.id} (${job.name})`);
      job.log = '(log unavailable)';
    }
  }

  // Build human-readable output
  const lines: string[] = [
    `Workflow Run #${params.run_id} — Job Logs:`,
    '',
  ];

  let overallTruncated = false;
  for (const job of jobs) {
    const icon =
      job.conclusion === 'success'
        ? '✅'
        : job.conclusion === 'failure'
          ? '❌'
          : job.conclusion === 'cancelled'
            ? '⛔'
            : '⏳';
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

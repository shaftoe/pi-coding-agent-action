/**
 * @file CI/CD status fetching for check runs and workflow runs.
 *
 * Provides the server-side logic for the `get_ci_status` custom tool:
 * queries the GitHub Actions / Checks API for workflow runs and check runs.
 */

import type {
  GitHubModuleDeps,
  GetCIStatusParams,
  GetCIStatusDetails,
  CheckRunResult,
  WorkflowRunResult,
} from '../types';
import { getStatusIcon } from './ci-utils';

/** Status types for check runs */
type CheckRunStatus = 'queued' | 'in_progress' | 'completed';

/** Status types for workflow runs */
type WorkflowRunStatus =
  | 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested'
  | 'pending' | 'success' | 'failure' | 'neutral' | 'cancelled'
  | 'skipped' | 'timed_out' | 'action_required' | 'stale';

export type {
  GetCIStatusParams,
  GetCIStatusDetails,
  CheckRunResult,
  WorkflowRunResult,
};

/** Maximum number of check runs to return. */
const MAX_CHECK_RUNS = 50;

/** Maximum number of workflow runs to return. */
const MAX_WORKFLOW_RUNS = 50;

/**
 * Resolve the head SHA from the given parameters.
 *
 * If `ref` is provided, use it directly. If `pull_number` is provided,
 * fetch the PR to get its head SHA. Otherwise fall back to the context SHA.
 */
async function resolveHeadSha(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  params: GetCIStatusParams
): Promise<string | undefined> {
  // Explicit ref takes priority
  if (params.ref) {
    return params.ref;
  }

  // Fetch PR head SHA if pull_number provided
  if (params.pull_number) {
    const pr = await deps.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: params.pull_number,
    });
    return pr.data.head.sha;
  }

  // Fall back to context SHA
  const sha = (deps.context.payload as { after?: string }).after;
  return sha || undefined;
}

/**
 * Fetch check runs for a given ref (commit SHA).
 */
async function fetchCheckRuns(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  ref: string,
  status?: string,
  conclusion?: string
): Promise<CheckRunResult[]> {
  const response = await deps.octokit.rest.checks.listForRef({
    owner,
    repo,
    ref,
    per_page: MAX_CHECK_RUNS,
    ...(status ? { status: status as CheckRunStatus } : {}),
    ...(conclusion ? { filter: 'all' as const } : {}),
  });

  let checkRuns = response.data.check_runs.map((cr): CheckRunResult => ({
    id: cr.id,
    name: cr.name,
    status: cr.status,
    conclusion: cr.conclusion ?? null,
    started_at: cr.started_at ?? null,
    completed_at: cr.completed_at ?? null,
    html_url: cr.html_url,
    details_url: cr.details_url ?? null,
  }));

  // Client-side conclusion filter (API doesn't support it directly)
  if (conclusion) {
    checkRuns = checkRuns.filter(cr => cr.conclusion === conclusion);
  }

  return checkRuns;
}

/**
 * Fetch workflow runs for a given ref (commit SHA).
 */
async function fetchWorkflowRuns(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  ref: string,
  status?: string,
  conclusion?: string
): Promise<WorkflowRunResult[]> {
  const response = await deps.octokit.rest.actions.listWorkflowRunsForRepo({
    owner,
    repo,
    head_sha: ref,
    per_page: MAX_WORKFLOW_RUNS,
    ...(status ? { status: status as WorkflowRunStatus } : {}),
  });

  let workflowRuns = response.data.workflow_runs.map((wr): WorkflowRunResult => ({
    id: wr.id,
    name: wr.name ?? wr.path?.split('/').pop() ?? 'unknown',
    status: wr.status ?? 'unknown',
    conclusion: wr.conclusion ?? null,
    started_at: wr.run_started_at ?? wr.created_at ?? null,
    html_url: wr.html_url,
    head_branch: wr.head_branch ?? '',
    head_sha: wr.head_sha ?? '',
    event: wr.event,
  }));

  // Client-side conclusion filter (API doesn't support it for workflow runs)
  if (conclusion) {
    workflowRuns = workflowRuns.filter(wr => wr.conclusion === conclusion);
  }

  return workflowRuns;
}

/**
 * Get CI status for a ref or pull request.
 *
 * Fetches both check runs and workflow runs for the resolved ref (SHA).
 * For pull requests, the head SHA is resolved automatically.
 *
 * @param deps - Module dependencies.
 * @param params - Parameters for the CI status query.
 * @returns Structured details about CI status.
 */
export async function getCIStatus(
  deps: GitHubModuleDeps,
  params: GetCIStatusParams
): Promise<{
  content: { type: 'text'; text: string }[];
  details: GetCIStatusDetails;
}> {
  const owner = params.owner ?? deps.context.repo.owner;
  const repo = params.repo ?? deps.context.repo.repo;

  const ref = await resolveHeadSha(deps, owner, repo, params);
  if (!ref) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Could not resolve ref: provide a pull_number, ref, or run in a PR context.',
        },
      ],
      details: {
        ref: '',
        check_runs: [],
        workflow_runs: [],
      },
    };
  }

  deps.logger.debug(`[getCIStatus] Fetching CI status for ref: ${ref}`);

  // Fetch check runs and workflow runs in parallel
  const [checkRuns, workflowRuns] = await Promise.all([
    fetchCheckRuns(deps, owner, repo, ref, params.status, params.conclusion),
    fetchWorkflowRuns(deps, owner, repo, ref, params.status, params.conclusion),
  ]);

  // Build human-readable summary
  const shortRef = ref.length > 8 ? ref.substring(0, 8) : ref;
  const lines: string[] = [
    `CI Status for ${shortRef}:`,
    '',
  ];

  if (checkRuns.length > 0) {
    lines.push(`Check Runs (${checkRuns.length}):`);
    for (const cr of checkRuns) {
      const icon = getStatusIcon(cr.status, cr.conclusion);
      lines.push(
        `  ${icon} ${cr.name}: ${cr.status}` +
          `${cr.conclusion ? ` (${cr.conclusion})` : ''}`
      );
      if (cr.details_url) {
        lines.push(`     ${cr.details_url}`);
      }
    }
    lines.push('');
  }

  if (workflowRuns.length > 0) {
    lines.push(`Workflow Runs (${workflowRuns.length}):`);
    for (const wr of workflowRuns) {
      const icon = getStatusIcon(wr.status, wr.conclusion);
      lines.push(
        `  ${icon} ${wr.name} [${wr.event}]: ${wr.status}` +
          `${wr.conclusion ? ` (${wr.conclusion})` : ''}`
      );
      lines.push(`     Run ID: ${wr.id} · ${wr.html_url}`);
    }
    lines.push('');
  }

  if (checkRuns.length === 0 && workflowRuns.length === 0) {
    lines.push('No check runs or workflow runs found for this ref.');
  }

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
    details: {
      ref,
      check_runs: checkRuns,
      workflow_runs: workflowRuns,
    },
  };
}

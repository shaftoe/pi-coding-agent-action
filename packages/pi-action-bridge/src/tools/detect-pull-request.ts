/**
 * @file `detect_pull_request` tool — orchestrates git inspection + remote
 * parsing + PR lookup into a single LLM-callable tool.
 *
 * The orchestration is split from the I/O so {@link detectPullRequest} can be
 * tested with injected {@link GitInspector} / {@link FindPrFn} fakes (no
 * `simple-git` or Octokit in the test path).
 */
import type { StatusResult } from 'simple-git';
import { Type } from 'typebox';
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { PREFER_STRICT_JSON_SCHEMA } from '@alexanderfortin/pi-orchestrator/pi/tools/schema';
import { createGitInspector, pickRemote } from '../git';
import { createOctokitFindPr } from '../octokit';
import { parseRemoteUrl } from '../remote';
import type {
  DetectPullRequestDetails,
  FindPrFn,
  GitInspector,
  NoPrReason,
  RepoInfo,
} from '../types';

/**
 * Run the full detection flow.
 *
 * Order: repo check → status → branch check → remote pick/parse → PR lookup.
 * Every non-fatal dead-end (no repo, detached HEAD, no remote, unparseable
 * remote, no matching PR, abort) is a **normal result** with `pr: null` and an
 * explanatory `reason`. Only a missing token / API failure throws.
 *
 * @param deps.git  - git inspector (simple-git in prod, fake in tests).
 * @param deps.findPR - PR-lookup strategy (octokit in prod, fake in tests).
 * @param signal    - agent abort signal, threaded into the Octokit request.
 */
export async function detectPullRequest(
  deps: { git: GitInspector; findPR: FindPrFn },
  signal?: AbortSignal
): Promise<DetectPullRequestDetails> {
  if (!(await deps.git.isRepo())) {
    return notARepo();
  }

  const status = await deps.git.status();
  if (signal?.aborted) {
    return withStatus(status, {
      repo: null,
      remote: null,
      pr: null,
      reason: 'aborted',
    });
  }

  const branch = status.current;
  if (!branch || status.detached) {
    return withStatus(status, {
      repo: null,
      remote: null,
      pr: null,
      reason: 'detached_head',
    });
  }

  const remotes = await deps.git.getRemotes();
  const chosen = pickRemote(remotes);
  if (!chosen) {
    return withStatus(status, {
      repo: null,
      remote: null,
      pr: null,
      reason: 'no_remote',
    });
  }

  const remoteUrl = chosen.refs.fetch || chosen.refs.push;
  const parsed = remoteUrl ? parseRemoteUrl(remoteUrl) : undefined;
  if (!parsed) {
    return withStatus(status, {
      repo: null,
      remote: chosen.name,
      pr: null,
      reason: 'unrecognized_remote',
    });
  }

  if (signal?.aborted) {
    return withStatus(status, {
      repo: toRepo(parsed),
      remote: chosen.name,
      pr: null,
      reason: 'aborted',
    });
  }

  const pr = await deps.findPR(
    {
      owner: parsed.owner,
      repo: parsed.repo,
      branch,
      serverUrl: parsed.serverUrl,
    },
    signal
  );

  if (signal?.aborted) {
    return withStatus(status, {
      repo: toRepo(parsed),
      remote: chosen.name,
      pr: pr ?? null,
      reason: 'aborted',
    });
  }

  if (!pr) {
    return withStatus(status, {
      repo: toRepo(parsed),
      remote: chosen.name,
      pr: null,
      reason: 'no_pr_for_branch',
    });
  }

  return withStatus(status, {
    repo: toRepo(parsed),
    remote: chosen.name,
    pr,
  });
}

/** Tail of a details object: everything except the status-derived fields. */
type DetailsTail = Omit<
  DetectPullRequestDetails,
  'branch' | 'dirty' | 'ahead' | 'behind' | 'tracking'
>;

/** Build a full details object by merging status-derived fields with a tail. */
function withStatus(status: StatusResult, tail: DetailsTail): DetectPullRequestDetails {
  return {
    branch: status.current,
    dirty: !status.isClean(),
    ahead: status.ahead,
    behind: status.behind,
    tracking: status.tracking,
    ...tail,
  };
}

/** Details for the "not a git repo" case (no status available). */
function notARepo(): DetectPullRequestDetails {
  return {
    repo: null,
    branch: null,
    remote: null,
    dirty: false,
    ahead: 0,
    behind: 0,
    tracking: null,
    pr: null,
    reason: 'not_a_git_repo',
  };
}

function toRepo(parsed: { serverUrl: string; owner: string; repo: string }): RepoInfo {
  return { serverUrl: parsed.serverUrl, owner: parsed.owner, repo: parsed.repo };
}

/**
 * Render details as concise text for the LLM.
 *
 * Kept deterministic and grep-friendly so `/handoff` and `/pickup` prompts can
 * rely on the shape.
 */
export function summarize(details: DetectPullRequestDetails): string {
  const reason = details.reason;

  if (reason === 'not_a_git_repo') {
    return 'The current directory is not inside a git repository.';
  }
  if (reason === 'detached_head') {
    return 'HEAD is detached (no current branch); cannot resolve a pull request.';
  }
  if (reason === 'no_remote') {
    return 'The repository has no git remotes configured; cannot resolve owner/repo.';
  }
  if (reason === 'unrecognized_remote') {
    return `Could not parse remote \`${details.remote ?? ''}\` URL into owner/repo.`;
  }

  const repo = details.repo;
  if (!repo) {
    // Defensive: every remaining reason should carry repo, but guard anyway.
    return 'Could not resolve repository information for the current branch.';
  }

  const host = safeHost(repo.serverUrl);
  const dirtyStr = details.dirty ? 'dirty' : 'clean';
  const trackingStr = details.tracking ? `, tracking ${details.tracking}` : '';
  const branchLabel = details.branch ?? '(detached)';
  const head =
    `${host} repo \`${repo.owner}/${repo.repo}\`, branch \`${branchLabel}\` ` +
    `(${dirtyStr}, ahead ${details.ahead}, behind ${details.behind}${trackingStr})`;

  if (reason === 'aborted') {
    return `${head} — detection was aborted before the PR lookup completed.`;
  }
  if (reason === 'no_pr_for_branch') {
    return `${head}: no open pull request found for this branch.`;
  }

  const pr = details.pr;
  if (!pr) {
    return `${head}: no pull request resolved.`;
  }

  const label = pr.draft ? 'draft' : pr.state;
  return `${head} → PR #${pr.number} "${pr.title}" [${label}] ${pr.html_url}`;
}

function safeHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return serverUrl;
  }
}

/**
 * The `detect_pull_request` tool definition.
 *
 * Zero-argument: uses the `origin` remote and open PRs. If `origin` is the
 * wrong remote or the PR is already merged, the result includes the branch +
 * repo + `reason` so the LLM can recover (e.g. via its `bash` tool).
 */
export const detectPullRequestTool: ToolDefinition<
  ReturnType<typeof Type.Object>,
  DetectPullRequestDetails
> = {
  name: 'detect_pull_request',
  label: 'Detect Pull Request',
  description:
    'Detect the GitHub pull request (if any) checked out in the current working directory, by inspecting the local git branch and querying the forge REST API. Uses the `origin` remote and open PRs.',
  promptSnippet:
    'Detect the GitHub PR (if any) checked out in the current working directory, via the REST API',
  promptGuidelines: [
    'Use detect_pull_request before /handoff or /pickup, or whenever you need to know which PR the local branch belongs to. Do not ask the user for a PR number if this tool already resolves one.',
  ],
  parameters: Type.Object({}, { additionalProperties: false }),
  constrainedSampling: PREFER_STRICT_JSON_SCHEMA,
  async execute(
    _toolCallId: string,
    _params: Record<string, never>,
    signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback<DetectPullRequestDetails> | undefined,
    ctx: ExtensionContext
  ): Promise<AgentToolResult<DetectPullRequestDetails>> {
    const git = createGitInspector(ctx.cwd);
    const findPR = createOctokitFindPr();
    const details = await detectPullRequest({ git, findPR }, signal);
    return {
      content: [{ type: 'text', text: summarize(details) }],
      details,
    };
  },
};

// Re-exported so callers can reference the reason vocabulary without importing
// the internals.
export type { NoPrReason };

/**
 * @file Octokit construction and PR/thread I/O.
 *
 * Builds an Octokit instance (matching the structural shape used by pi-cli and
 * `pi-platform-github`) and implements the three I/O operations the bridge
 * tools need: PR lookup, comment posting, and thread reading. The forge-
 * specific REST base URL is derived via the reused `apiBaseUrlFromServerUrl`,
 * giving us GitHub / GHES / Codeberg / Forgejo / Gitea parity for free.
 *
 * Token resolution is the shared `resolveGitHubToken` from
 * `pi-platform-github` (`GITHUB_TOKEN` → `GH_TOKEN`). There is no `gh` CLI
 * fallback for these tools — they go straight to the REST API.
 */
import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';
import { apiBaseUrlFromServerUrl, resolveGitHubToken } from '@alexanderfortin/pi-platform-github';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';
import type {
  FindPrFn,
  FindPrParams,
  NormalizedComment,
  NormalizedPR,
  NormalizedThread,
  PostCommentFn,
  PostPrCommentDetails,
  ReadThreadFn,
} from './types';

/**
 * Octokit class with the REST endpoint methods plugin applied. Not exported by
 * `pi-platform-github` (only the derived `OctokitInstance` type is), so we
 * construct it locally; the types align structurally.
 */
export const OctokitWithRest = Octokit.plugin(restEndpointMethods);

/**
 * Spread an abort `signal` into an Octokit request's `request` option.
 *
 * Octokit reads `request.signal` to abort the underlying fetch; passing the
 * spread `...requestOpts(signal)` is a no-op when there is no signal, so every
 * call site can apply it uniformly.
 */
function requestOpts(
  signal: AbortSignal | undefined
): { request: { signal: AbortSignal } } | Record<string, never> {
  return signal ? { request: { signal } } : {};
}

/**
 * Construct an authenticated Octokit instance for a given forge.
 *
 * @param token - GitHub API token (PAT or `GITHUB_TOKEN`).
 * @param serverUrl - Web URL of the forge (e.g. `https://github.com`).
 */
export function createOctokit(token: string, serverUrl: string): OctokitInstance {
  const baseUrl = apiBaseUrlFromServerUrl(serverUrl);
  return new OctokitWithRest({
    auth: token,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  });
}

/**
 * Query the REST API for the open PR whose head ref is `branch`.
 *
 * Uses `GET /repos/{owner}/{repo}/pulls?head={owner}:{branch}&state=open`.
 * Correct for the single-repo case (the common `pi-action-bridge` workflow
 * where local work and the CI agent run on the same repo). Fork workflows
 * (head remote ≠ base remote) are a documented follow-up.
 *
 * @returns the first matching PR as a {@link NormalizedPR}, or `null`.
 */
export async function findPullRequestForBranch(
  octokit: OctokitInstance,
  params: { owner: string; repo: string; branch: string },
  signal?: AbortSignal
): Promise<NormalizedPR | null> {
  const { data } = await octokit.rest.pulls.list({
    owner: params.owner,
    repo: params.repo,
    head: `${params.owner}:${params.branch}`,
    state: 'open',
    per_page: 1,
    ...requestOpts(signal),
  });

  const pr = data[0];
  if (!pr) {
    return null;
  }

  return {
    number: pr.number,
    title: pr.title,
    state: pr.state === 'closed' ? 'closed' : 'open',
    draft: pr.draft ?? false,
    html_url: pr.html_url,
    head: { ref: pr.head.ref, sha: pr.head.sha },
    base: { ref: pr.base.ref },
    author: pr.user?.login ?? 'unknown',
    updated_at: pr.updated_at ?? '',
  };
}

/**
 * Build the production {@link FindPrFn} that resolves a token lazily and
 * queries the API.
 *
 * Token resolution is deferred until the lookup actually runs, so a missing
 * token never blocks the earlier "is this a repo / which branch / which
 * remote" checks — and never errors when the cwd isn't even a git repo.
 */
export function createOctokitFindPr(env: NodeJS.ProcessEnv = process.env): FindPrFn {
  return async (
    { owner, repo, branch, serverUrl }: FindPrParams,
    signal?: AbortSignal
  ): Promise<NormalizedPR | null> => {
    const token = resolveGitHubToken(env);
    const octokit = createOctokit(token, serverUrl);
    return findPullRequestForBranch(octokit, { owner, repo, branch }, signal);
  };
}

// ---------------------------------------------------------------------------
// Issue-thread helpers (post_pr_comment + read_pr_thread)
// ---------------------------------------------------------------------------

/** Default comment cap for {@link readIssueThread} when none is given. */
export const DEFAULT_MAX_THREAD_COMMENTS = 100;

/**
 * Construct an authenticated Octokit for a given forge, resolving the token
 * lazily from the environment.
 *
 * Convenience wrapper combining {@link resolveGitHubToken} + {@link createOctokit};
 * used by the comment/thread factories so each tool call resolves fresh.
 */
export function createOctokitFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  serverUrl: string
): OctokitInstance {
  const token = resolveGitHubToken(env);
  return createOctokit(token, serverUrl);
}

/**
 * Post a top-level comment to a PR (or issue).
 *
 * Uses `POST /repos/{owner}/{repo}/issues/{number}/comments` — PRs share the
 * issues comment endpoint, so this works for pull requests directly.
 *
 * @returns the created comment's `id`, `html_url`, and `created_at`.
 */
export async function postIssueComment(
  octokit: OctokitInstance,
  params: { owner: string; repo: string; number: number; body: string },
  signal?: AbortSignal
): Promise<PostPrCommentDetails> {
  const { data } = await octokit.rest.issues.createComment({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.number,
    body: params.body,
    ...requestOpts(signal),
  });

  return {
    id: data.id,
    owner: params.owner,
    repo: params.repo,
    number: params.number,
    html_url: data.html_url,
    created_at: data.created_at ?? '',
  };
}

/**
 * Project a raw issue-comment payload into a {@link NormalizedComment}.
 *
 * Exported so tests can assert the projection (`Bot` → `bot`, missing user →
 * `'unknown'`, null body → `''`) without a network round-trip.
 */
export function normalizeComment(comment: {
  id: number;
  user?: { login?: string | null; type?: string | null } | null;
  created_at: string;
  body?: string | null;
}): NormalizedComment {
  return {
    id: comment.id,
    author: comment.user?.login ?? 'unknown',
    author_type: comment.user?.type === 'Bot' ? 'bot' : 'user',
    created_at: comment.created_at,
    body: comment.body ?? '',
  };
}

/** Clamp a requested comment count to the supported `[0, 100]` range. */
function clampMax(value: number | undefined): number {
  return Math.max(0, Math.min(value ?? DEFAULT_MAX_THREAD_COMMENTS, 100));
}

/** Normalize an issue/PR `state` string into the {@link NormalizedThread} union. */
function issueState(state: string | null | undefined): 'open' | 'closed' {
  return state === 'closed' ? 'closed' : 'open';
}

/**
 * Fetch PR-only metadata (draft flag + head/base refs) via `pulls.get`.
 *
 * Only called when the issue is a pull request; issues return `null` branches.
 */
async function fetchPrMeta(
  octokit: OctokitInstance,
  params: { owner: string; repo: string; number: number },
  signal?: AbortSignal
): Promise<{ draft: boolean; headBranch: string | null; baseBranch: string | null }> {
  const { data: pr } = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.number,
    ...requestOpts(signal),
  });
  return {
    draft: pr.draft ?? false,
    headBranch: pr.head?.ref ?? null,
    baseBranch: pr.base?.ref ?? null,
  };
}

/** Fetch + project issue-level comments, capped at `max`. */
async function fetchComments(
  octokit: OctokitInstance,
  params: { owner: string; repo: string; number: number },
  max: number,
  signal?: AbortSignal
): Promise<NormalizedComment[]> {
  // GitHub caps `per_page` at 100, and we clamp `max` to 100, so a single
  // page always suffices for the supported range — no pagination loop needed.
  const { data } = await octokit.rest.issues.listComments({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.number,
    per_page: max,
    ...requestOpts(signal),
  });
  return data.map(normalizeComment);
}

/**
 * Read a PR/issue thread: metadata + issue-level comments.
 *
 * Fetches the issue (`issues.get`); if it's a PR it also fetches `pulls.get`
 * for the draft flag + head/base refs, then reads `issues.listComments`
 * up to `maxComments` (default {@link DEFAULT_MAX_THREAD_COMMENTS}). The
 * `pulls.get` and `issues.listComments` calls are independent and fired
 * concurrently via `Promise.all`. Inline review comments are intentionally
 * excluded (see {@link NormalizedThread}).
 *
 * @throws when the issue/PR is not found (HTTP 404) or the API fails.
 */
export async function readIssueThread(
  octokit: OctokitInstance,
  params: { owner: string; repo: string; number: number; maxComments?: number },
  signal?: AbortSignal
): Promise<NormalizedThread> {
  const max = clampMax(params.maxComments);

  const { data: issue } = await octokit.rest.issues.get({
    owner: params.owner,
    repo: params.repo,
    issue_number: params.number,
    ...requestOpts(signal),
  });

  let draft = false;
  let headBranch: string | null = null;
  let baseBranch: string | null = null;

  const isPr = issue.pull_request !== undefined;

  // `fetchPrMeta` and `fetchComments` are independent (neither depends on the
  // other's result), so fire them concurrently to save a round trip for PR
  // threads (3 sequential calls → 2).
  const [prMeta, comments] = await Promise.all([
    isPr ? fetchPrMeta(octokit, params, signal) : Promise.resolve(null),
    max > 0 ? fetchComments(octokit, params, max, signal) : Promise.resolve([]),
  ]);

  if (prMeta) {
    draft = prMeta.draft;
    headBranch = prMeta.headBranch;
    baseBranch = prMeta.baseBranch;
  }

  return {
    number: issue.number,
    title: issue.title,
    state: issueState(issue.state),
    draft,
    body: issue.body ?? '',
    author: issue.user?.login ?? 'unknown',
    head_branch: headBranch,
    base_branch: baseBranch,
    updated_at: issue.updated_at ?? '',
    comments,
  };
}

/**
 * Build the production {@link PostCommentFn}. Token resolution is deferred
 * until the call runs, matching {@link createOctokitFindPr}.
 */
export function createOctokitPostComment(env: NodeJS.ProcessEnv = process.env): PostCommentFn {
  return async (
    { serverUrl, owner, repo, number, body },
    signal
  ): Promise<PostPrCommentDetails> => {
    const octokit = createOctokitFromEnv(env, serverUrl);
    return postIssueComment(octokit, { owner, repo, number, body }, signal);
  };
}

/**
 * Build the production {@link ReadThreadFn}. Token resolution is deferred
 * until the call runs, matching {@link createOctokitFindPr}.
 */
export function createOctokitReadThread(env: NodeJS.ProcessEnv = process.env): ReadThreadFn {
  return async (
    { serverUrl, owner, repo, number, maxComments },
    signal
  ): Promise<NormalizedThread> => {
    const octokit = createOctokitFromEnv(env, serverUrl);
    const readParams: { owner: string; repo: string; number: number; maxComments?: number } = {
      owner,
      repo,
      number,
    };
    if (maxComments !== undefined) {
      readParams.maxComments = maxComments;
    }
    return readIssueThread(octokit, readParams, signal);
  };
}

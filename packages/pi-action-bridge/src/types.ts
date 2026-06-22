/**
 * @file Shared types for the `detect_pull_request` tool.
 *
 * Kept dependency-free (only `import type`) so `git.ts`, `octokit.ts` and the
 * tool module can import from here without creating cycles.
 */
import type { RemoteWithRefs, StatusResult } from 'simple-git';

/**
 * Parsed owner/repo/server for a git remote.
 */
export interface RepoInfo {
  /** Web URL of the forge host, e.g. `https://github.com`. */
  serverUrl: string;
  owner: string;
  repo: string;
}

/**
 * Forge-agnostic PR summary. A flat projection of the fields the bridge
 * actually uses, so callers (prompts, LLM, UI) don't depend on the Octokit
 * response shape.
 */
export interface NormalizedPR {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  author: string;
  updated_at: string;
}

/**
 * Why no PR was resolved. Present on {@link DetectPullRequestDetails} iff
 * `pr` is `null`.
 */
export type NoPrReason =
  | 'not_a_git_repo'
  | 'detached_head'
  | 'no_remote'
  | 'unrecognized_remote'
  | 'no_pr_for_branch'
  | 'aborted';

/**
 * Structured result returned by the tool (also stored in `details` for
 * branching/UI).
 */
export interface DetectPullRequestDetails {
  repo: RepoInfo | null;
  branch: string | null;
  /** Name of the git remote the repo info was read from. */
  remote: string | null;
  dirty: boolean;
  ahead: number;
  behind: number;
  tracking: string | null;
  pr: NormalizedPR | null;
  /** Present iff `pr` is `null`. */
  reason?: NoPrReason;
}

/**
 * Minimal git surface the detection core depends on. Implemented by
 * {@link createGitInspector} in production, faked in tests.
 */
export interface GitInspector {
  isRepo(): Promise<boolean>;
  status(): Promise<StatusResult>;
  getRemotes(): Promise<RemoteWithRefs[]>;
}

/** Arguments passed to the PR-lookup strategy. */
export interface FindPrParams {
  owner: string;
  repo: string;
  branch: string;
  serverUrl: string;
}

/**
 * Strategy that resolves the open PR for a branch (or `null`). Injected so
 * tests can stub the Octokit call.
 */
export type FindPrFn = (params: FindPrParams, signal?: AbortSignal) => Promise<NormalizedPR | null>;

// ---------------------------------------------------------------------------
// Issue-thread primitives (shared by post_pr_comment + read_pr_thread)
// ---------------------------------------------------------------------------

/**
 * Forge-agnostic issue-level comment. A flat projection of the fields the
 * bridge uses, decoupled from the Octokit response shape.
 */
export interface NormalizedComment {
  id: number;
  author: string;
  /** `'bot'` when the author is a forge bot/app account, else `'user'`. */
  author_type: 'user' | 'bot';
  created_at: string;
  body: string;
}

/**
 * Lean read of a PR/issue thread: metadata + issue-level comments.
 *
 * Deliberately excludes inline review comments — sufficient for a handoff
 * summary and for the `/pi 🤖 Handoff` marker (which lives in issue-level
 * comments). Grows later if a prompt needs diff-level context.
 */
export interface NormalizedThread {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft: boolean;
  body: string;
  author: string;
  /** Head/base ref, or `null` when the thread is an issue (not a PR). */
  head_branch: string | null;
  base_branch: string | null;
  updated_at: string;
  comments: NormalizedComment[];
}

// ---------------------------------------------------------------------------
// post_pr_comment
// ---------------------------------------------------------------------------

/** Arguments for posting a PR/issue comment. */
export interface PostCommentParams {
  /** Web URL of the forge host, e.g. `https://github.com`. */
  serverUrl: string;
  owner: string;
  repo: string;
  /** PR or issue number (PRs share the issues comment endpoint). */
  number: number;
  body: string;
}

/** Structured result returned by `post_pr_comment`. */
export interface PostPrCommentDetails {
  id: number;
  owner: string;
  repo: string;
  number: number;
  html_url: string;
  created_at: string;
  /** `true` when the request was aborted before completion. */
  cancelled?: boolean;
}

/** Strategy that posts a comment. Injected so tests can stub the Octokit call. */
export type PostCommentFn = (
  params: PostCommentParams,
  signal?: AbortSignal
) => Promise<PostPrCommentDetails>;

// ---------------------------------------------------------------------------
// read_pr_thread
// ---------------------------------------------------------------------------

/** Arguments for reading a PR/issue thread. */
export interface ReadThreadParams {
  /** Web URL of the forge host, e.g. `https://github.com`. */
  serverUrl: string;
  owner: string;
  repo: string;
  /** PR or issue number. */
  number: number;
  /** Cap on the number of comments returned (default 100). */
  maxComments?: number;
}

/** Strategy that reads a thread. Injected so tests can stub the Octokit call. */
export type ReadThreadFn = (
  params: ReadThreadParams,
  signal?: AbortSignal
) => Promise<NormalizedThread>;

/** Structured result returned by `read_pr_thread`. */
export interface ReadPrThreadDetails {
  owner: string;
  repo: string;
  thread: NormalizedThread;
  /** `true` when the read was aborted (partial/no comments). */
  cancelled?: boolean;
}

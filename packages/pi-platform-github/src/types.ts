/**
 * @file Shared type definitions for the GitHub/Codeberg/Forgejo platform module.
 *
 * Centralises all interfaces used across the github module so that individual
 * files can import types without creating circular dependencies.
 */

import type { Logger } from '@alexanderfortin/pi-orchestrator';
import type { PlatformContext, PlatformType } from '@alexanderfortin/pi-orchestrator';

// Re-export shared platform types from the orchestrator so consumers within
// the GitHub module can import them from a single location.
export type {
  IssueOrPullRequestContext,
  ThreadComment,
  ReviewComment,
  IssueOrPRThread,
  GetIssueOrPRThreadParams,
  ReviewInlineComment,
  CreatePullRequestParams,
  CreatePullRequestDetails,
  UpdatePullRequestParams,
  UpdatePullRequestDetails,
  CreateReviewParams,
  CreateReviewDetails,
  GetCIStatusParams,
  CheckRunResult,
  WorkflowRunResult,
  GetCIStatusDetails,
  GetWorkflowRunLogsParams,
  JobLog,
  GetWorkflowRunLogsDetails,
} from '@alexanderfortin/pi-orchestrator';

import { Octokit } from '@octokit/core';
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods';

/**
 * The minimal Octokit shape this library requires: `@octokit/core` with the
 * REST endpoint methods plugin applied. This is structurally compatible with
 * (and a strict subset of) the instance returned by `@actions/github`'s
 * `getOctokit()`, which adds `paginateRest` and proxy defaults on top.
 *
 * Widening from the previous `ReturnType<typeof import('@actions/github').getOctokit>`
 * removes the last `@actions/github` import (even type-only) from this
 * library, so alternative frontends (CLI, GitHub App, web UI) can construct
 * an Octokit directly without pulling in the GitHub-Actions-only package.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- const is used to derive the InstanceType below; not referenced at runtime in this type-only module.
const OctokitWithRest = Octokit.plugin(restEndpointMethods);
type OctokitInstance = InstanceType<typeof OctokitWithRest>;

/**
 * Explicit dependency bag for GitHub module functions.
 *
 * Every function in `src/platform/github/` receives this as its first
 * parameter instead of reaching for singletons or `@actions/*` globals.
 * Constructed once in `createGitHubPlatformProvider` and threaded through.
 */
export interface GitHubModuleDeps {
  /** Pre-authenticated Octokit REST client. */
  readonly octokit: OctokitInstance;
  /** Platform context (repo, issue, event payload, …). */
  readonly context: PlatformContext;
  /** Logger for debug/info/warning output. */
  readonly logger: Logger;
  /**
   * The trigger command string (e.g. '/pi ') used to strip invocation prefixes
   * from comment bodies. When omitted, defaults to {@link DEFAULT_TRIGGER}.
   */
  readonly trigger?: string;
  /**
   * Branch name template for generating branch names.
   * When provided, overrides the default template.
   */
  readonly branchNameTemplate?: string;
  /**
   * The detected platform type ('github' | 'codeberg' | 'forgejo').
   *
   * Used by helpers that need platform-specific behaviour (e.g.
   * `buildActionRunUrl()` builds different URLs for Forgejo/Codeberg vs
   * GitHub). Optional so unit tests can omit it and get the GitHub
   * default; production code should always set it via the provider.
   */
  readonly platformType?: PlatformType;
}

/**
 * Extract the Octokit type from the deps so consumers don't need to
 * import `@actions/github` just for the type.
 */
export type { OctokitInstance };

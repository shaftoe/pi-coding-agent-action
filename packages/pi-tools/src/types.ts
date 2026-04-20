/**
 * @file Types and interfaces for Pi coding agent tools.
 *
 * Defines the minimal {@link ToolProvider} interface that consumers must
 * implement, along with all parameter, detail, and thread types used by
 * the built-in tool definitions.
 *
 * This file is the single source of truth for tool-related types so that
 * both the tool definitions and their consumers share a consistent contract.
 */

/**
 * Parameters for creating a pull request.
 */
export interface CreatePullRequestParams {
  title: string;
  body?: string;
  base?: string;
  dryRun?: boolean;
}

/**
 * Details returned after a pull request creation attempt.
 */
export interface CreatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  dryRun: boolean;
  cancelled?: boolean;
}

/**
 * Parameters for updating an existing pull request.
 */
export interface UpdatePullRequestParams {
  pull_number?: number;
  title?: string;
  body?: string;
  message?: string;
  dryRun?: boolean;
}

/**
 * Details returned after a pull request update attempt.
 */
export interface UpdatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  commitSha?: string;
  titleUpdated?: boolean;
  bodyUpdated?: boolean;
  dryRun: boolean;
  cancelled?: boolean;
}

/**
 * Parameters for fetching an issue or pull request thread.
 */
export interface GetIssueOrPRThreadParams {
  owner?: string;
  repo?: string;
  issue_number?: number;
  max_comments?: number;
}

/**
 * A single comment within an issue or pull request thread.
 */
export interface ThreadComment {
  id: number;
  author: string;
  author_type: 'user' | 'bot';
  created_at: string;
  updated_at?: string;
  body: string;
  is_triggering_comment?: boolean;
}

/**
 * Full thread data for an issue or pull request.
 */
export interface IssueOrPRThread {
  number: number;
  title: string;
  body: string | null | undefined;
  state: 'open' | 'closed' | 'merged';
  author: string;
  author_type: 'user' | 'bot';
  created_at: string | null | undefined;
  updated_at: string | null | undefined;
  closed_at: string | null | undefined;
  merged_at: string | null | undefined;
  labels: string[];
  is_pull_request: boolean;
  head_branch: string | undefined;
  base_branch: string | undefined;
  head_sha: string | undefined;
  comments: ThreadComment[];
  cancelled?: boolean;
}

/**
 * Minimal provider interface that consumers must implement.
 *
 * Contains only the operations required by the built-in tool definitions.
 * Each method corresponds to a single tool's backend operation.
 *
 * @example
 * ```typescript
 * import type { ToolProvider } from 'pi-coding-agent-tools';
 *
 * const myProvider: ToolProvider = {
 *   createPullRequest: async (params) => { ... },
 *   updatePullRequest: async (params) => { ... },
 *   getIssueOrPRThread: async (params) => { ... },
 * };
 * ```
 */
export interface ToolProvider {
  /**
   * Create a pull request.
   *
   * @param params - Pull request creation parameters.
   * @returns The result with content and details.
   */
  createPullRequest(
    params: CreatePullRequestParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: CreatePullRequestDetails }>;

  /**
   * Update an existing pull request.
   *
   * @param params - Pull request update parameters.
   * @returns The result with content and details.
   */
  updatePullRequest(
    params: UpdatePullRequestParams
  ): Promise<{ content: { type: 'text'; text: string }[]; details: UpdatePullRequestDetails }>;

  /**
   * Fetch the complete thread for an issue or pull request.
   *
   * @param params - Optional parameters to override defaults.
   * @returns The thread data, or undefined if not found.
   */
  getIssueOrPRThread(params?: GetIssueOrPRThreadParams): Promise<IssueOrPRThread | undefined>;
}

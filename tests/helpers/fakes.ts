/**
 * @file Test fakes for GitHub data structures.
 *
 * Provides factory functions that create realistic GitHub API responses and
 * context payloads. These are "fakes" (realistic data), not "mocks"
 * (which replace behavior).
 *
 * Using fakes makes tests more maintainable and realistic compared to
 * manually constructing test data in each test.
 */

import type { IssueOrPRThread, ThreadComment } from '../../src/platform';

// ============================================================================
// GitHub Context & Event Payloads
// ============================================================================

/**
 * Represents a minimal GitHub repository object.
 */
export interface FakeRepository {
  name: string;
  owner: { login: string };
  default_branch: string;
  full_name: string;
}

/**
 * Represents a GitHub user (minimal).
 */
export interface FakeUser {
  login: string;
  type: 'User' | 'Bot';
}

/**
 * Represents a minimal GitHub issue object.
 */
export interface FakeIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  user: FakeUser | null;
  state: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: (string | { name: string })[];
  pull_request?: { url: string } | null;
}

/**
 * Represents a minimal GitHub pull request object.
 */
export interface FakePullRequest {
  id: number;
  number: number;
  title: string;
  body: string | null;
  user: FakeUser | null;
  state: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

/**
 * Represents a minimal GitHub comment object.
 */
export interface FakeComment {
  id: number;
  body: string;
  user: FakeUser | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * Represents a GitHub event payload.
 */
export interface FakeGitHubPayload {
  issue?: FakeIssue;
  pull_request?: FakePullRequest;
  comment?: FakeComment;
  repository?: FakeRepository;
}

/**
 * Represents the complete GitHub Actions context.
 */
export interface FakeGitHubContext {
  eventName: 'issue_comment' | 'issues' | 'pull_request' | 'push' | 'workflow_run';
  payload: FakeGitHubPayload;
  repo: { owner: string; repo: string };
  issue?: { number: number };
  serverUrl: string;
  runId: number;
}

/**
 * Default fake repository.
 */
export const DEFAULT_FAKE_REPOSITORY: FakeRepository = {
  name: 'test-repo',
  owner: { login: 'test-owner' },
  default_branch: 'main',
  full_name: 'test-owner/test-repo',
};

/**
 * Default fake user.
 */
export const DEFAULT_FAKE_USER: FakeUser = {
  login: 'testuser',
  type: 'User',
};

/**
 * Default fake bot user.
 */
export const DEFAULT_FAKE_BOT: FakeUser = {
  login: 'github-actions[bot]',
  type: 'Bot',
};

/**
 * Create a fake issue object with sensible defaults.
 *
 * @param overrides - Properties to override on the default issue.
 * @returns A fake issue object.
 */
export function createFakeIssue(overrides?: Partial<FakeIssue>): FakeIssue {
  return {
    id: 1,
    number: 42,
    title: 'Test Issue',
    body: 'This is a test issue.',
    user: DEFAULT_FAKE_USER,
    state: 'open',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    closed_at: null,
    labels: [],
    pull_request: null,
    ...overrides,
  };
}

/**
 * Create a fake pull request object with sensible defaults.
 *
 * @param overrides - Properties to override on the default PR.
 * @returns A fake PR object.
 */
export function createFakePullRequest(overrides?: Partial<FakePullRequest>): FakePullRequest {
  return {
    id: 1,
    number: 123,
    title: 'Test PR',
    body: 'This is a test PR.',
    user: DEFAULT_FAKE_USER,
    state: 'open',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    merged_at: null,
    head: {
      ref: 'feature/test',
      sha: 'abc123def456',
    },
    base: {
      ref: 'main',
    },
    ...overrides,
  };
}

/**
 * Create a fake comment object with sensible defaults.
 *
 * @param body - The comment body text (default: '/pi test').
 * @param overrides - Properties to override on the default comment.
 * @returns A fake comment object.
 */
export function createFakeComment(
  body = '/pi test',
  overrides?: Partial<FakeComment>
): FakeComment {
  return {
    id: 12345,
    body,
    user: DEFAULT_FAKE_USER,
    created_at: '2024-01-15T11:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
    ...overrides,
  };
}

/**
 * Create a fake bot comment.
 *
 * @param body - The comment body text (default: '/pi test').
 * @param overrides - Properties to override on the default comment.
 * @returns A fake bot comment object.
 */
export function createFakeBotComment(
  body = '/pi test',
  overrides?: Partial<FakeComment>
): FakeComment {
  return createFakeComment(body, {
    user: DEFAULT_FAKE_BOT,
    ...overrides,
  });
}

/**
 * Create a fake GitHub context object with sensible defaults.
 *
 * @param eventName - The event type (default: 'issue_comment').
 * @param payload - The event payload (default: minimal payload).
 * @param overrides - Properties to override on the default context.
 * @returns A fake GitHub Actions context.
 */
export function createFakeGitHubContext(
  eventName:
    | 'issue_comment'
    | 'issues'
    | 'pull_request'
    | 'push'
    | 'workflow_run' = 'issue_comment',
  payload?: FakeGitHubPayload,
  overrides?: Partial<FakeGitHubContext>
): FakeGitHubContext {
  const baseContext = {
    eventName,
    payload: payload ?? {
      comment: createFakeComment(),
      issue: createFakeIssue(),
    },
    repo: {
      owner: 'test-owner',
      repo: 'test-repo',
    },
    serverUrl: 'https://github.com',
    runId: 123456789,
  };

  // Only add issue if payload has it
  const withIssue = payload?.issue
    ? { ...baseContext, issue: { number: payload.issue.number } }
    : baseContext;

  return { ...withIssue, ...overrides };
}

/**
 * Create a fake issue_comment event payload.
 *
 * @param commentBody - The comment body text.
 * @param overrides - Properties to override on the default payload.
 * @returns A fake issue_comment event payload.
 */
export function createFakeIssueCommentPayload(
  commentBody = '/pi test',
  overrides?: Partial<FakeGitHubPayload>
): FakeGitHubPayload {
  return {
    comment: createFakeComment(commentBody),
    issue: createFakeIssue(),
    repository: DEFAULT_FAKE_REPOSITORY,
    ...overrides,
  };
}

/**
 * Create a fake issues event payload.
 *
 * @param title - The issue title.
 * @param body - The issue body (default: null).
 * @param overrides - Properties to override on the default payload.
 * @returns A fake issues event payload.
 */
export function createFakeIssuePayload(
  title = 'Test Issue',
  body: string | null = 'Issue description',
  overrides?: Partial<FakeGitHubPayload>
): FakeGitHubPayload {
  return {
    issue: createFakeIssue({ title, body }),
    repository: DEFAULT_FAKE_REPOSITORY,
    ...overrides,
  };
}

/**
 * Create a fake pull_request event payload.
 *
 * @param title - The PR title.
 * @param body - The PR body (default: null).
 * @param overrides - Properties to override on the default payload.
 * @returns A fake pull_request event payload.
 */
export function createFakePRPayload(
  title = 'Test PR',
  body: string | null = 'PR description',
  overrides?: Partial<FakeGitHubPayload>
): FakeGitHubPayload {
  return {
    pull_request: createFakePullRequest({ title, body }),
    issue: createFakeIssue({ title, body }),
    repository: DEFAULT_FAKE_REPOSITORY,
    ...overrides,
  };
}

/**
 * Create a fake issue/PR thread for the `get_issue_or_pr_thread` tool.
 *
 * @param overrides - Properties to override on the default thread.
 * @returns A fake issue/PR thread object.
 */
export function createFakeThread(overrides?: Partial<IssueOrPRThread>): IssueOrPRThread {
  return {
    number: 42,
    title: 'Test Issue',
    body: 'This is a test issue.',
    state: 'open',
    author: 'testuser',
    author_type: 'user',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    closed_at: null,
    merged_at: undefined,
    labels: [],
    is_pull_request: false,
    head_branch: undefined,
    base_branch: undefined,
    head_sha: undefined,
    comments: [],
    ...overrides,
  };
}

/**
 * Create a fake thread comment for the `get_issue_or_pr_thread` tool.
 *
 * @param overrides - Properties to override on the default comment.
 * @returns A fake thread comment object.
 */
export function createFakeThreadComment(overrides?: Partial<ThreadComment>): ThreadComment {
  return {
    id: 1,
    author: 'testuser',
    author_type: 'user',
    created_at: '2024-01-15T11:00:00Z',
    body: 'Test comment',
    ...overrides,
  };
}

// ============================================================================
// Octokit Response Fakes
// ============================================================================

/**
 * Fake Octokit issue response.
 */
export interface FakeOctokitIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  user: { login: string; type: string } | null;
  state: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  labels: { name: string }[];
  pull_request?: { url: string } | null;
}

/**
 * Fake Octokit pull request response.
 */
export interface FakeOctokitPR {
  id: number;
  number: number;
  title: string;
  body: string | null;
  user: { login: string; type: string } | null;
  state: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  head: { ref: string; sha: string };
  base: { ref: string };
}

/**
 * Fake Octokit comment response.
 */
export interface FakeOctokitComment {
  id: number;
  body: string;
  user: { login: string; type: string } | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * Fake Octokit repository response.
 */
export interface FakeOctokitRepository {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  default_branch: string;
}

/**
 * Fake Octokit reaction response.
 */
export interface FakeOctokitReaction {
  id: number;
  user: { login: string };
  content: string;
  created_at: string;
}

/**
 * Fake Octokit pull request creation response.
 */
export interface FakeOctokitPRCreate {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  user: { login: string; type: string };
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  created_at: string;
  updated_at: string;
}

/**
 * Create a fake Octokit issue response with sensible defaults.
 *
 * @param overrides - Properties to override on the default issue.
 * @returns A fake Octokit issue response.
 */
export function createFakeOctokitIssue(overrides?: Partial<FakeOctokitIssue>): FakeOctokitIssue {
  return {
    id: 1,
    number: 42,
    title: 'Test Issue',
    body: 'This is a test issue.',
    user: { login: 'testuser', type: 'User' },
    state: 'open',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    closed_at: null,
    labels: [],
    pull_request: null,
    ...overrides,
  };
}

/**
 * Create a fake Octokit pull request response with sensible defaults.
 *
 * @param overrides - Properties to override on the default PR.
 * @returns A fake Octokit PR response.
 */
export function createFakeOctokitPR(overrides?: Partial<FakeOctokitPR>): FakeOctokitPR {
  return {
    id: 1,
    number: 123,
    title: 'Test PR',
    body: 'This is a test PR.',
    user: { login: 'testuser', type: 'User' },
    state: 'open',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    merged_at: null,
    head: { ref: 'feature/test', sha: 'abc123def456' },
    base: { ref: 'main' },
    ...overrides,
  };
}

/**
 * Create a fake Octokit comment response with sensible defaults.
 *
 * @param overrides - Properties to override on the default comment.
 * @returns A fake Octokit comment response.
 */
export function createFakeOctokitComment(
  overrides?: Partial<FakeOctokitComment>
): FakeOctokitComment {
  return {
    id: 12345,
    body: 'Test comment',
    user: { login: 'testuser', type: 'User' },
    created_at: '2024-01-15T11:00:00Z',
    updated_at: '2024-01-15T11:00:00Z',
    ...overrides,
  };
}

/**
 * Create an array of fake Octokit comment responses.
 *
 * @param comments - Comment bodies or overrides.
 * @returns An array of fake Octokit comment responses.
 */
export function createFakeOctokitComments(
  comments: (string | Partial<FakeOctokitComment>)[]
): FakeOctokitComment[] {
  return comments.map(comment =>
    typeof comment === 'string'
      ? createFakeOctokitComment({ body: comment })
      : createFakeOctokitComment(comment)
  );
}

/**
 * Create a fake Octokit repository response with sensible defaults.
 *
 * @param overrides - Properties to override on the default repository.
 * @returns A fake Octokit repository response.
 */
export function createFakeOctokitRepository(
  overrides?: Partial<FakeOctokitRepository>
): FakeOctokitRepository {
  return {
    id: 1,
    name: 'test-repo',
    full_name: 'test-owner/test-repo',
    owner: { login: 'test-owner' },
    default_branch: 'main',
    ...overrides,
  };
}

/**
 * Create a fake Octokit reaction response with sensible defaults.
 *
 * @param reactionId - The reaction ID (default: 999).
 * @param overrides - Properties to override on the default reaction.
 * @returns A fake Octokit reaction response.
 */
export function createFakeOctokitReaction(
  reactionId = 999,
  overrides?: Partial<FakeOctokitReaction>
): FakeOctokitReaction {
  return {
    id: reactionId,
    user: { login: 'testuser' },
    content: 'eyes',
    created_at: '2024-01-15T11:00:00Z',
    ...overrides,
  };
}

/**
 * Create a fake Octokit PR creation response with sensible defaults.
 *
 * @param overrides - Properties to override on the default PR.
 * @returns A fake Octokit PR creation response.
 */
export function createFakeOctokitPRCreate(
  overrides?: Partial<FakeOctokitPRCreate>
): FakeOctokitPRCreate {
  return {
    id: 1,
    number: 123,
    title: 'Test PR',
    body: 'This is a test PR.',
    html_url: 'https://github.com/test-owner/test-repo/pull/123',
    state: 'open',
    user: { login: 'testuser', type: 'User' },
    head: { ref: 'feature/test', sha: 'abc123def456' },
    base: { ref: 'main', sha: 'def456abc123' },
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:30:00Z',
    ...overrides,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Wrap fake data in Octokit response format.
 *
 * @param data - The fake data object.
 * @returns An Octokit response object.
 */
export function createFakeOctokitResponse<T>(data: T): { data: T } {
  return { data };
}

/**
 * Create a fake pagination response from Octokit.
 *
 * @param items - The items to include in the response.
 * @returns An Octokit paginated response object.
 */
export function createFakeOctokitPaginatedResponse<T>(items: T[]): { data: readonly T[] } {
  return { data: items };
}

/**
 * Create a fake 404 error response.
 *
 * @param message - The error message (default: 'Not Found').
 * @returns A fake 404 error object.
 */
export function createFake404Error(message = 'Not Found'): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = 404;
  return error;
}

/**
 * Create a fake HTTP error from Octokit.
 *
 * @param status - The HTTP status code.
 * @param message - The error message.
 * @returns A fake HTTP error object.
 */
export function createFakeHttpError(
  status: number,
  message = 'HTTP Error'
): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

/**
 * @file Shared type definitions for the GitHub/Codeberg/Forgejo platform module.
 *
 * Centralises all interfaces used across the github module so that individual
 * files can import types without creating circular dependencies.
 */

export interface IssueOrPullRequestContext {
  title: string;
  body?: string;
  number: number;
}

export interface ThreadComment {
  id: number;
  author: string;
  author_type: 'user' | 'bot';
  created_at: string;
  updated_at?: string;
  body: string;
  is_triggering_comment?: boolean; // marks the comment that invoked /pi
}

export interface ReviewComment {
  id: number;
  path: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT';
  author: string;
  author_type: 'user' | 'bot';
  created_at: string;
  body: string;
  in_reply_to_id?: number;
}

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
  merged_at: string | null | undefined; // PR only
  labels: string[];
  // PR-specific fields
  is_pull_request: boolean;
  head_branch: string | undefined; // PR only
  base_branch: string | undefined; // PR only
  head_sha: string | undefined; // PR only
  // Comments
  comments: ThreadComment[];
  // PR review comments (inline comments on the diff)
  review_comments: ReviewComment[];
  // Cancellation flag
  cancelled?: boolean;
}

export interface GetIssueOrPRThreadParams {
  owner?: string;
  repo?: string;
  issue_number?: number;
  max_comments?: number;
}

/**
 * A single inline comment anchored to a specific line of the pull request diff.
 */
export interface ReviewInlineComment {
  /** Repository-relative file path (e.g. "src/main.ts"). */
  path: string;
  /** Line number in the diff. For multi-line comments this is the **end** line. */
  line: number;
  /** Which side of the diff the line refers to: `RIGHT` = new file (default), `LEFT` = old file. */
  side?: 'LEFT' | 'RIGHT';
  /** Start line for multi-line comments. If omitted the comment covers a single line. */
  start_line?: number;
  /** Which side `start_line` refers to. Only required when `start_line` is set and differs from `side`. */
  start_side?: 'LEFT' | 'RIGHT';
  /** The Markdown body of the comment. */
  body: string;
}

export interface CreateReviewParams {
  /** Pull request number. If omitted the current PR from context is used. */
  pull_number?: number;
  /** Summary comment for the review (shown at the top of the review). */
  body?: string;
  /** Review event: COMMENT (default), APPROVE, or REQUEST_CHANGES. */
  event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
  /** Inline comments anchored to specific diff lines. At least one is required. */
  comments: ReviewInlineComment[];
}

/**
 * Structured details returned after a review is created.
 */
export interface CreateReviewDetails {
  /** The ID of the created review. */
  reviewId: number;
  /** The HTML URL of the review. */
  reviewUrl: string;
  /** The pull request number the review was created on. */
  pullRequestNumber: number;
  /** The review event type. */
  event: string;
  /** Number of inline comments created. */
  commentCount: number;
  /** Whether the operation was cancelled. */
  cancelled?: boolean;
}

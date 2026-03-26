// ── GitHub Types ───────────────────────────────────────────────────
/**
 * Represents a comment on a GitHub issue or pull request.
 */
export interface IssueComment {
  /** The database ID of the comment */
  databaseId: number;
  /** The comment body text */
  body: string;
  /** The author of the comment */
  author: { login: string };
  /** ISO 8601 timestamp of when the comment was created */
  createdAt: string;
}

/**
 * Represents a GitHub issue with its metadata and comments.
 */
export interface IssueNode {
  /** The issue title */
  title: string;
  /** The issue body text */
  body: string;
  /** The issue state (e.g., "OPEN", "CLOSED") */
  state: string;
  /** The author of the issue */
  author: { login: string };
  /** ISO 8601 timestamp of when the issue was created */
  createdAt: string;
  /** Optional array of comments on the issue */
  comments?: IssueComment[];
}

/**
 * Represents a file change in a GitHub pull request.
 */
export interface PRFileChange {
  /** The file path relative to the repository root */
  path: string;
  /** Number of lines added */
  additions: number;
  /** Number of lines deleted */
  deletions: number;
  /** The type of change (e.g., "added", "modified", "deleted", "renamed") */
  changeType: string;
}

/**
 * Represents a comment within a GitHub pull request review.
 */
export interface PRReviewComment {
  /** The file path the comment refers to */
  path?: string;
  /** The line number the comment refers to */
  line?: number;
  /** The comment body text */
  body: string;
}

/**
 * Represents a GitHub pull request review.
 */
export interface PRReview {
  /** The author of the review */
  author: { login: string };
  /** The review body text */
  body: string;
  /** ISO 8601 timestamp of when the review was submitted */
  submittedAt: string;
  /** Optional array of comments in the review */
  comments?: PRReviewComment[];
}

/**
 * Represents a GitHub pull request with its metadata, files, and reviews.
 */
export interface PRNode {
  /** The PR title */
  title: string;
  /** The PR body text */
  body: string;
  /** The PR state (e.g., "OPEN", "CLOSED", "MERGED") */
  state: string;
  /** The author of the PR */
  author: { login: string };
  /** The base branch name (e.g., "main") */
  baseRefName: string;
  /** The head branch name (e.g., "feature/branch") */
  headRefName: string;
  /** The head ref OID (included by GitHub CLI but not currently used) */
  headRefOid?: string;
  /** ISO 8601 timestamp of when the PR was created */
  createdAt: string;
  /** Total number of lines added */
  additions: number;
  /** Total number of lines deleted */
  deletions: number;
  /** The base repository information (populated from context, not available from gh CLI) */
  baseRepository?: { nameWithOwner: string };
  /** The head repository information */
  headRepository: { nameWithOwner: string };
  /** Total number of commits in the PR */
  commits: { totalCount: number };
  /** Optional array of changed files */
  files?: PRFileChange[];
  /** Optional array of comments on the PR */
  comments?: IssueComment[];
  /** Optional array of reviews on the PR */
  reviews?: PRReview[];
}

// ── Git Types ─────────────────────────────────────────────────────
/**
 * Represents a git author with name and email.
 */
export interface GitAuthor {
  /** The author's name */
  name: string;
  /** The author's email address */
  email: string;
}

// ── Re-exports for API Convenience ──────────────────────────────────────
/**
 * Re-exports commonly used GitHub types for API convenience.
 */
export type {
  IssueComment,
  IssueNode,
  PRFileChange,
  PRReviewComment,
  PRReview,
  PRNode,
  GitAuthor,
};

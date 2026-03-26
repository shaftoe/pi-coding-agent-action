// ── URL Building Utilities ─────────────────────────────────────────────────
/**
 * URL building utilities for GitHub.
 *
 * Provides a consistent way to build URLs for GitHub resources, eliminating
 * code duplication and ensuring URLs are correctly formatted.
 */

import * as github from '@actions/github';

// ── GitHub URL Builder Class ────────────────────────────────────────────────
/**
 * Constructs GitHub URLs for the current repository context.
 *
 * This class encapsulates the logic for building various GitHub URLs,
 * ensuring consistency across the codebase and making it easier to
 * maintain and modify URL formats.
 *
 * @example
 * ```typescript
 * const urlBuilder = new GitHubUrlBuilder();
 * const prUrl = urlBuilder.pr(123);
 * // => "https://github.com/owner/repo/pull/123"
 * ```
 */
export class GitHubUrlBuilder {
  private readonly serverUrl: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor() {
    const context = github.context;

    this.serverUrl = context.serverUrl || 'https://github.com';
    const repo = context.repo;
    this.owner = repo.owner || 'unknown';
    this.repo = repo.repo || 'unknown';
  }

  /**
   * Gets the base repository URL.
   * @returns The repository URL (e.g., "https://github.com/owner/repo")
   */
  repo(): string {
    return `${this.serverUrl}/${this.owner}/${this.repo}`;
  }

  /**
   * Gets the URL for a specific branch.
   * @param branch - The branch name
   * @returns The branch URL (e.g., "https://github.com/owner/repo/tree/branch")
   */
  branch(branch: string): string {
    return `${this.repo()}/tree/${this encodeURIComponent(branch)}`;
  }

  /**
   * Gets the URL for a specific commit.
   * @param sha - The commit SHA
   * @returns The commit URL (e.g., "https://github.com/owner/repo/commit/abc123")
   */
  commit(sha: string): string {
    return `${this.repo()}/commit/${this encodeURIComponent(sha)}`;
  }

  /**
   * Gets the URL for a pull request.
   * @param prNumber - The PR number
   * @returns The PR URL (e.g., "https://github.com/owner/repo/pull/123")
   */
  pr(prNumber: number): string {
    return `${this.repo()}/pull/${prNumber}`;
  }

  /**
   * Gets the URL for an issue.
   * @param issueNumber - The issue number
   * @returns The issue URL (e.g., "https://github.com/owner/repo/issues/123")
   */
  issue(issueNumber: number): string {
    return `${this.repo()}/issues/${issueNumber}`;
  }

  /**
   * Gets the URL for a file at a specific ref.
   * @param path - The file path
   * @param ref - The git ref (branch, tag, or commit)
   * @returns The file URL (e.g., "https://github.com/owner/repo/blob/main/src/index.ts")
   */
  file(path: string, ref: string): string {
    return `${this.repo()}/blob/${this encodeURIComponent(ref)}/${this encodeURIComponent(path)}`;
  }

  /**
   * Gets the URL for a file at a specific line.
   * @param path - The file path
   * @param ref - The git ref
   * @param line - The line number
   * @returns The file URL with line anchor
   */
  fileAtLine(path: string, ref: string, line: number): string {
    return `${this.file(path, ref)}#L${line}`;
  }

  /**
   * Gets the URL for a commit or issue comment.
   * @param targetType - The target type ('issue' or 'pr')
   * @param targetNumber - The target number
   * @param commentId - The comment ID
   * @returns The comment URL
   */
  comment(targetType: 'issue' | 'pr', targetNumber: number, commentId: number): string {
    const baseUrl = targetType === 'pr' ? this.pr(targetNumber) : this.issue(targetNumber);
    return `${baseUrl}#issuecomment-${commentId}`;
  }

  /**
   * Gets the URL for a PR review comment.
   * @param prNumber - The PR number
   * @param reviewId - The review ID
   * @returns The review URL
   */
  review(prNumber: number, reviewId: number): string {
    return `${this.pr(prNumber)}#pullrequestreview-${reviewId}`;
  }

  /**
   * Gets the URL for a diff view between two refs.
   * @param base - The base ref
   * @param head - The head ref
   * @returns The diff URL
   */
  diff(base: string, head: string): string {
    return `${this.repo()}/compare/${this encodeURIComponent(base)}...${this encodeURIComponent(head)}`;
  }

  /**
   * Gets the URL for the actions workflow runs.
   * @returns The actions URL
   */
  actions(): string {
    return `${this.repo()}/actions`;
  }

  /**
   * Gets the URL for a specific workflow run.
   * @param runId - The run ID
   * @returns The run URL
   */
  run(runId: string | number): string {
    return `${this.actions()}/runs/${runId}`;
  }

  /**
   * Gets the URL for the current workflow run.
   * @returns The current run URL, or null if not in a GitHub Actions environment
   */
  currentRun(): string | null {
    const runId = process.env.GITHUB_RUN_ID;
    if (!runId) {
      return null;
    }
    return this.run(runId);
  }

  /**
   * Creates an encoded version of a path component, handling special characters.
   * @param component - The path component to encode
   * @returns The encoded component
   */
  private encodeURIComponent(component: string): string {
    // Handle special characters in paths that should not be encoded
    return component
      .split('/')
      .map(segment => {
        // Don't encode slashes in the path itself
        return encodeURIComponent(segment);
      })
      .join('/');
  }
}

// ── Singleton Instance ─────────────────────────────────────────────────────
/**
 * The default GitHub URL builder instance.
 *
 * This singleton uses the current GitHub Actions context and can be used
 * throughout the application.
 *
 * @example
 * ```typescript
 * import { githubUrlBuilder } from './url.js';
 * const url = githubUrlBuilder.branch('main');
 * ```
 */
export const githubUrlBuilder = new GitHubUrlBuilder();

// ── Helper Functions ───────────────────────────────────────────────────────
/**
 * Builds the GitHub Actions run URL for logging.
 * @returns The URL to view the current workflow run, or null if not available
 */
export function buildRunUrl(): string | null {
  return githubUrlBuilder.currentRun();
}

/**
 * Builds a repository URL for a given owner and repo.
 * @param owner - The repository owner
 * @param repo - The repository name
 * @returns The repository URL
 */
export function buildRepoUrl(owner: string, repo: string): string {
  const serverUrl = github.context.serverUrl || 'https://github.com';
  return `${serverUrl}/${owner}/${repo}`;
}

/**
 * Formats a markdown link to a GitHub resource.
 * @param text - The link text
 * @param url - The URL to link to
 * @returns A markdown link string
 */
export function markdownLink(text: string, url: string): string {
  return `[${text}](${url})`;
}

/**
 * Formats a markdown link to a GitHub PR.
 * @param prNumber - The PR number
 * @param text - Optional link text (defaults to "PR #<number>")
 * @returns A markdown link string
 */
export function prMarkdownLink(prNumber: number, text?: string): string {
  return markdownLink(text ?? `PR #${prNumber}`, githubUrlBuilder.pr(prNumber));
}

/**
 * Formats a markdown link to a GitHub issue.
 * @param issueNumber - The issue number
 * @param text - Optional link text (defaults to "issue #<number>")
 * @returns A markdown link string
 */
export function issueMarkdownLink(issueNumber: number, text?: string): string {
  return markdownLink(text ?? `issue #${issueNumber}`, githubUrlBuilder.issue(issueNumber));
}

/**
 * Formats a markdown link to a commit.
 * @param sha - The commit SHA
 * @param text - Optional link text (defaults to the short SHA)
 * @returns A markdown link string
 */
export function commitMarkdownLink(sha: string, text?: string): string {
  const shortSha = sha.length > 7 ? sha.slice(0, 7) : sha;
  return markdownLink(text ?? shortSha, githubUrlBuilder.commit(sha));
}

/**
 * Formats a markdown link to a file.
 * @param path - The file path
 * @param ref - The git ref
 * @param text - Optional link text (defaults to the file path)
 * @returns A markdown link string
 */
export function fileMarkdownLink(path: string, ref: string, text?: string): string {
  return markdownLink(text ?? path, githubUrlBuilder.file(path, ref));
}

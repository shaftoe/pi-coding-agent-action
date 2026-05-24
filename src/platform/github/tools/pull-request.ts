/**
 * @file GitHub pull request creation tool implementation.
 *
 * Implements the server-side logic for the `create_pull_request` custom tool:
 * detecting changed files in the working tree, creating blobs/trees/commits
 * via the Git Data API, creating a new branch, and opening a pull request.
 * Supports dry-run mode for testing without side effects.
 */

import * as github from '@actions/github';
import { Temporal } from '@js-temporal/polyfill';
import { getOctokit } from '../octokit';
import { BRANCH_PREFIX, MAX_TITLE_LENGTH } from '../constants';
import { getContextType } from '../context-utils';
import {
  createLogger,
  scanForChanges,
  createBlobsAndTree,
  createCommitAndUpdateBranch,
  buildFileMap,
} from '../git/index';

const log = createLogger();

/**
 * Convert a string to a git-branch-safe slug.
 *
 * Lowercases, replaces non-alphanumeric runs with a single hyphen,
 * and strips leading/trailing hyphens.
 *
 * @param text - The text to slugify.
 * @param maxLength - Maximum length of the slug (default 50).
 * @returns The slugified string.
 * @internal Exported for testing purposes.
 */
export function slugify(text: string, maxLength = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

/**
 * Default branch name template.
 */
const DEFAULT_BRANCH_NAME_TEMPLATE = `${BRANCH_PREFIX}{number}-{timestamp}`;

/**
 * Generate a branch name from a template with variable substitution.
 *
 * Supports the following variables:
 * - `{number}`: Issue or PR number (e.g. "42")
 * - `{timestamp}`: Current epoch milliseconds (e.g. "1716543210000")
 * - `{title}`: Slugified PR title (e.g. "fix-auth-bug")
 *
 * When `template` is empty or undefined, falls back to the default
 * template `pi/issue{number}-{timestamp}`.
 *
 * @param title - The PR title (used for `{title}` substitution).
 * @param template - Optional template string. When empty, uses the default.
 * @returns The generated branch name.
 * @internal Exported for testing purposes.
 */
export function generateBranchName(title: string, template?: string): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string should also fall back to default
  const effectiveTemplate = template || DEFAULT_BRANCH_NAME_TEMPLATE;
  const issueNumber = github.context.issue?.number ?? 'unknown';
  const timestamp = Temporal.Now.instant().epochMilliseconds;

  return effectiveTemplate
    .replace(/\{number\}/g, String(issueNumber))
    .replace(/\{timestamp\}/g, String(timestamp))
    .replace(/\{title\}/g, slugify(title));
}

/**
 * Characters and patterns forbidden anywhere in a git ref name.
 *
 * Based on the rules enforced by `git-check-ref-format`:
 * https://git-scm.com/docs/git-check-ref-format
 */
const INVALID_REF_PATTERNS: readonly (string | RegExp)[] = [
  '..',    // double dot
  '~',     // tilde
  '^',     // caret
  ':',     // colon
  '\\',    // backslash
  ' ',     // space
  '?',     // question mark
  '*',     // asterisk
  '[',     // open bracket
  '@{',    // reflog syntax
  '\0',    // null byte
];

/**
 * Validate that a branch name is a valid git ref.
 *
 * Applies the rules from `git-check-ref-format` so that user-provided
 * templates produce actionable error messages instead of cryptic API failures.
 *
 * @param branchName - The branch name to validate.
 * @throws {Error} If the branch name is not a valid git ref.
 * @internal Exported for testing purposes.
 */
export function validateBranchName(branchName: string): void {
  if (!branchName) {
    throw new Error('Branch name cannot be empty');
  }

  // Cannot start or end with a dot
  if (branchName.startsWith('.') || branchName.endsWith('.')) {
    throw new Error(
      `Invalid branch name "${branchName}": branch name cannot start or end with a dot (.)`
    );
  }

  // Cannot start with a dash
  if (branchName.startsWith('-')) {
    throw new Error(
      `Invalid branch name "${branchName}": branch name cannot start with a dash (-)`
    );
  }

  // Cannot start or end with a slash
  if (branchName.startsWith('/') || branchName.endsWith('/')) {
    throw new Error(
      `Invalid branch name "${branchName}": branch name cannot start or end with a slash (/)`
    );
  }

  // Cannot end with .lock
  if (branchName.endsWith('.lock')) {
    throw new Error(
      `Invalid branch name "${branchName}": branch name cannot end with ".lock"`
    );
  }

  // Cannot contain consecutive slashes
  if (branchName.includes('//')) {
    throw new Error(
      `Invalid branch name "${branchName}": branch name cannot contain consecutive slashes (//)`
    );
  }

  // Cannot contain a component ending with a dot (e.g. "feature./fix")
  if (/(?:^|\/)[^.]*\.(?:\/|$)/.test(branchName)) {
    throw new Error(
      `Invalid branch name "${branchName}": component cannot end with a dot (.)`
    );
  }

  // Check for forbidden characters/patterns
  for (const pattern of INVALID_REF_PATTERNS) {
    if (typeof pattern === 'string') {
      if (branchName.includes(pattern)) {
        throw new Error(
          `Invalid branch name "${branchName}": contains forbidden pattern "${pattern}"`
        );
      }
    } else {
      if (pattern.test(branchName)) {
        throw new Error(
          `Invalid branch name "${branchName}": contains forbidden pattern ${pattern}`
        );
      }
    }
  }

  // Cannot contain control characters
  if (/[\x00-\x1f\x7f]/.test(branchName)) {
    throw new Error(
      `Invalid branch name "${branchName}": contains control characters`
    );
  }
}

export interface CreatePullRequestParams {
  title: string;
  body?: string;
  base?: string;
  dryRun?: boolean;
}

export interface CreatePullRequestResult {
  content: { type: 'text'; text: string }[];
  details: CreatePullRequestDetails;
}

export interface CreatePullRequestDetails {
  pullRequestNumber: number;
  pullRequestUrl: string;
  headBranch: string;
  baseBranch: string;
  dryRun: boolean;
  cancelled?: boolean;
}

/**
 * Resolve the base (target) branch for the pull request.
 *
 * Uses the explicitly provided branch if given, otherwise falls back to the
 * repository's default branch (from the workflow context or the GitHub API).
 *
 * @param providedBase - Optional branch name override.
 * @returns The resolved base branch name.
 * @internal Exported for testing purposes.
 */
export async function determineBaseBranch(providedBase: string | undefined): Promise<string> {
  let baseBranch: string;
  if (providedBase) {
    // Explicitly provided by caller
    baseBranch = providedBase;
    log.debug(`Using provided base branch: ${baseBranch}`);
    return baseBranch;
  }

  if (github.context.payload.repository?.default_branch) {
    // Available in context
    baseBranch = github.context.payload.repository.default_branch;
    log.debug(`Using default branch from context: ${baseBranch}`);
    return baseBranch;
  }

  // Fetch from GitHub API
  log.debug(`Fetching repository default branch from GitHub API...`);
  const octokit = getOctokit();
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const repoData = await octokit.rest.repos.get({
    owner,
    repo,
  });
  baseBranch = repoData.data.default_branch;
  log.debug(`Fetched default branch: ${baseBranch}`);
  return baseBranch;
}

/**
 * Build the pull request body text.
 *
 * Uses the caller-supplied body if provided. Otherwise auto-generates a body
 * that references the originating issue/PR number (e.g. "Fixes #42").
 *
 * @param providedBody - Optional body text from the tool caller.
 * @returns The final Markdown body string.
 * @internal Exported for testing purposes.
 */
export function generatePullRequestBody(providedBody: string | undefined): string {
  let bodyText = providedBody ?? '';
  if (!bodyText && github.context.issue?.number) {
    const contextType = getContextType();
    const issueNum = github.context.issue.number;
    if (contextType === 'issue') {
      bodyText = `Fixes #${issueNum}\n\nCreated by pi coding agent.`;
    } else if (contextType === 'pull_request') {
      bodyText = `Related to #${issueNum}\n\nCreated by pi coding agent.`;
    }
    log.debug(`Auto-generated body from issue #${issueNum}`);
  }

  return bodyText;
}

/**
 * Validate pull request creation parameters.
 *
 * @param params - The pull request parameters to validate.
 * @throws {Error} If validation fails.
 * @internal Exported for testing purposes.
 */
export function validateCreatePullRequestParams(params: CreatePullRequestParams): void {
  if (!params.title || params.title.trim() === '') {
    throw new Error('Pull request title is required and cannot be empty');
  }

  if (params.title.length > MAX_TITLE_LENGTH) {
    throw new Error(
      `Pull request title exceeds maximum length of ${MAX_TITLE_LENGTH} characters (got ${params.title.length})`
    );
  }
}

/**
 * Create a pull request via the GitHub REST API.
 *
 * @param title - PR title.
 * @param body - PR body in Markdown.
 * @param baseBranch - Target (base) branch name.
 * @param headBranch - Source (head) branch name.
 * @returns An object containing the PR number, URL, and branch refs.
 */
async function createPullRequestOnGitHub(
  title: string,
  body: string,
  baseBranch: string,
  headBranch: string
): Promise<{ number: number; url: string; headRef: string; baseRef: string }> {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  log.debug(`Creating pull request...`);

  const octokit = getOctokit();
  const result = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    base: baseBranch,
    head: headBranch,
  });

  return {
    number: result.data.number,
    url: result.data.html_url,
    headRef: result.data.head.ref,
    baseRef: result.data.base.ref,
  };
}

/**
 * Create a pull request end-to-end.
 *
 * Orchestrates the full flow: determines the base branch, scans for changed
 * files, creates a branch, commits, and opens the PR. When `dryRun` is `true`
 * the operation is simulated and no GitHub resources are created.
 *
 * @param params - Parameters controlling title, body, base branch, and dry-run.
 * @returns The tool result containing a human-readable message and structured
 *          details about the created PR (or dry-run output).
 * @throws {Error} If no changed files are detected or the GitHub API call fails.
 */
export async function createPullRequest(
  params: CreatePullRequestParams
): Promise<CreatePullRequestResult> {
  const { title, body, base, dryRun } = params;

  // Validate input parameters early
  validateCreatePullRequestParams(params);

  // Auto-generate branch name from template and validate
  const template = process.env.INPUT_BRANCH_NAME_TEMPLATE ?? '';
  const head = generateBranchName(title, template);
  validateBranchName(head);

  log.debug(`Title: ${title}`);
  log.debug(`Auto-generated branch: ${head}`);
  log.debug(`Base: ${base ?? 'default'}`);
  log.debug(`DryRun: ${dryRun ?? false}`);

  // Determine base branch
  const baseBranch = await determineBaseBranch(base);

  // Generate body text
  const bodyText = generatePullRequestBody(body);

  // Dry run mode
  if (dryRun) {
    const message = `[DRY RUN] Would create pull request:\n- Title: ${title}\n- Body: ${bodyText || '(empty)'}\n- Base: ${baseBranch}\n- Head: ${head}`;
    log.debug(message);

    return {
      content: [{ type: 'text' as const, text: message }],
      details: {
        pullRequestNumber: 0,
        pullRequestUrl: '',
        headBranch: head,
        baseBranch,
        dryRun: true,
      },
    };
  }

  // Create and push the new branch via GitHub API
  log.debug(`Preparing branch and changes via GitHub API...`);

  try {
    const octokit = getOctokit();
    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;

    // Get base branch reference
    log.debug(`Getting base branch "${baseBranch}" reference...`);
    const baseRef = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    const baseSha = baseRef.data.object.sha;
    log.debug(`Base branch SHA: ${baseSha}`);

    // Get files that exist in the base branch tree (for comparison)
    log.debug(`Getting base branch tree...`);
    const baseFiles = await buildFileMap(baseSha);
    log.debug(`Found ${baseFiles.size} files in base branch`);

    // Scan for changes
    const { changedFiles, deletedFiles } = await scanForChanges(baseFiles, log);

    if (changedFiles.length === 0 && deletedFiles.length === 0) {
      const errorMsg =
        'No changes detected. Please add new files and/or make your changes before creating a pull request.';
      throw new Error(errorMsg);
    }

    // Create new branch reference from base branch
    log.debug(`Creating new branch "${head}"...`);
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${head}`,
      sha: baseSha,
    });
    log.debug(`Branch created successfully`);

    // Create blobs and tree
    const treeSha = await createBlobsAndTree({
      changedFiles,
      deletedFiles,
      parentSha: baseSha,
      log,
    });

    // Create commit and update branch
    await createCommitAndUpdateBranch({
      treeSha,
      parentSha: baseSha,
      branchName: head,
      message: title,
      log,
    });

    // Create pull request
    const prResult = await createPullRequestOnGitHub(title, bodyText, baseBranch, head);

    const successMessage = `Pull request #${prResult.number} created: ${prResult.url}`;

    log.info(`SUCCESS: ${successMessage}`);

    const details: CreatePullRequestDetails = {
      pullRequestNumber: prResult.number,
      pullRequestUrl: prResult.url,
      headBranch: prResult.headRef,
      baseBranch: prResult.baseRef,
      dryRun: false,
    };

    return {
      content: [{ type: 'text' as const, text: successMessage }],
      details,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[pull-request] Failed to create pull request: ${message}`);
  }
}

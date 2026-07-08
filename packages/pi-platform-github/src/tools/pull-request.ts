/**
 * @file GitHub pull request creation tool implementation.
 *
 * Implements the server-side logic for the `create_pull_request` custom tool:
 * detecting changed files in the working tree, creating a branch and commit
 * via the `git` CLI, and opening a pull request. Uses `git` CLI for all
 * write operations (branch/commit/push) instead of the Git Data API, which
 * is broken on Forgejo/Gitea. Supports dry-run mode for testing without
 * side effects.
 */

import { Temporal } from '@js-temporal/polyfill';
import { BRANCH_PREFIX, MAX_TITLE_LENGTH } from '../constants';
import { getContextType } from '../context-utils';
import {
  createLogger,
  workspaceHasChanges,
  commitAndPushBranch,
  appendCoAuthoredBy,
} from '../git/index';
import type { GitHubModuleDeps, CreatePullRequestParams, CreatePullRequestDetails } from '../types';

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
 * @param deps - Module dependencies.
 * @param title - The PR title (used for `{title}` substitution).
 * @param template - Optional template string. When empty, uses the default.
 * @returns The generated branch name.
 * @internal Exported for testing purposes.
 */
export function generateBranchName(
  deps: GitHubModuleDeps,
  title: string,
  template?: string
): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string should also fall back to default
  const effectiveTemplate = template || DEFAULT_BRANCH_NAME_TEMPLATE;
  const issueNumber = deps.context.issue?.number ?? 'unknown';
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
  '..', // double dot
  '~', // tilde
  '^', // caret
  ':', // colon
  '\\', // backslash
  ' ', // space
  '?', // question mark
  '*', // asterisk
  '[', // open bracket
  '@{', // reflog syntax
  '\0', // null byte
];

/**
 * Rule for validating a git ref name. Returns the validation error message
 * when the rule fails, or `null` when the name passes the rule.
 */
interface BranchNameRule {
  readonly message: (name: string) => string;
  check(name: string): boolean;
}

/**
 * Compose the rules for `git-check-ref-format` once at module load.
 */
function buildBranchNameRules(): BranchNameRule[] {
  return [
    {
      message: () => 'Branch name cannot be empty',
      check: name => !name,
    },
    {
      message: name =>
        `Invalid branch name "${name}": branch name cannot start or end with a dot (.)`,
      check: name => name.startsWith('.') || name.endsWith('.'),
    },
    {
      message: name => `Invalid branch name "${name}": branch name cannot start with a dash (-)`,
      check: name => name.startsWith('-'),
    },
    {
      message: name =>
        `Invalid branch name "${name}": branch name cannot start or end with a slash (/)`,
      check: name => name.startsWith('/') || name.endsWith('/'),
    },
    {
      message: name => `Invalid branch name "${name}": branch name cannot end with ".lock"`,
      check: name => name.endsWith('.lock'),
    },
    {
      message: name =>
        `Invalid branch name "${name}": branch name cannot contain consecutive slashes (//)`,
      check: name => name.includes('//'),
    },
    {
      message: name => `Invalid branch name "${name}": component cannot end with a dot (.)`,
      check: name => /(?:^|\/)[^.]*\.(?:\/|$)/.test(name),
    },
    {
      message: name => `Invalid branch name "${name}": contains control characters`,
      check: name => /[\x00-\x1f\x7f]/.test(name),
    },
  ];
}

const BRANCH_NAME_RULES = buildBranchNameRules();

/**
 * Find the first `INVALID_REF_PATTERNS` entry that matches `branchName`.
 * Returns the human-readable error message (with the matched pattern),
 * or `null` when no forbidden pattern is present.
 *
 * Exported for unit testing.
 */
// fallow-ignore-next-line complexity
export function findInvalidRefPattern(branchName: string): string | null {
  for (const pattern of INVALID_REF_PATTERNS) {
    if (typeof pattern === 'string') {
      if (branchName.includes(pattern)) {
        return `Invalid branch name "${branchName}": contains forbidden pattern "${pattern}"`;
      }
    } else if (pattern.test(branchName)) {
      return `Invalid branch name "${branchName}": contains forbidden pattern ${pattern}`;
    }
  }
  return null;
}

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
  for (const rule of BRANCH_NAME_RULES) {
    if (rule.check(branchName)) {
      throw new Error(rule.message(branchName));
    }
  }

  const forbidden = findInvalidRefPattern(branchName);
  if (forbidden) {
    throw new Error(forbidden);
  }
}

export interface CreatePullRequestResult {
  content: { type: 'text'; text: string }[];
  details: CreatePullRequestDetails;
}

/**
 * Resolve the base (target) branch for the pull request.
 *
 * Uses the explicitly provided branch if given, otherwise falls back to the
 * repository's default branch (from the workflow context or the GitHub API).
 *
 * @param deps - Module dependencies.
 * @param providedBase - Optional branch name override.
 * @returns The resolved base branch name.
 * @internal Exported for testing purposes.
 */
export async function determineBaseBranch(
  deps: GitHubModuleDeps,
  providedBase: string | undefined
): Promise<string> {
  const log = createLogger(deps);
  let baseBranch: string;
  if (providedBase) {
    // Explicitly provided by caller
    baseBranch = providedBase;
    log.debug(`Using provided base branch: ${baseBranch}`);
    return baseBranch;
  }

  const repoPayload = deps.context.payload.repository as { default_branch?: string } | undefined;
  if (repoPayload?.default_branch) {
    // Available in context
    baseBranch = repoPayload.default_branch;
    log.debug(`Using default branch from context: ${baseBranch}`);
    return baseBranch;
  }

  // Fetch from GitHub API
  log.debug(`Fetching repository default branch from GitHub API...`);
  const owner = deps.context.repo.owner;
  const repo = deps.context.repo.repo;
  const repoData = await deps.octokit.rest.repos.get({
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
 * @param deps - Module dependencies.
 * @param providedBody - Optional body text from the tool caller.
 * @returns The final Markdown body string.
 * @internal Exported for testing purposes.
 */
// fallow-ignore-next-line complexity
export function generatePullRequestBody(
  deps: GitHubModuleDeps,
  providedBody: string | undefined
): string {
  const log = createLogger(deps);
  let bodyText = providedBody ?? '';
  if (!bodyText && deps.context.issue?.number) {
    const contextType = getContextType(deps);
    const issueNum = deps.context.issue?.number;
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
 * @param deps - Module dependencies.
 * @param title - PR title.
 * @param body - PR body in Markdown.
 * @param baseBranch - Target (base) branch name.
 * @param headBranch - Source (head) branch name.
 * @returns An object containing the PR number, URL, and branch refs.
 */
/** Shape returned by the GitHub `pulls.create` call. Reused across the
 * create-flow helpers below.
 */
interface GitHubPullRequestResult {
  number: number;
  url: string;
  headRef: string;
  baseRef: string;
}

/**
 * Build the human-readable dry-run message. Exported for unit testing.
 */
export function buildCreateDryRunMessage(
  title: string,
  bodyText: string,
  baseBranch: string,
  head: string
): string {
  return `[DRY RUN] Would create pull request:\n- Title: ${title}\n- Body: ${bodyText || '(empty)'}\n- Base: ${baseBranch}\n- Head: ${head}`;
}

/**
 * Build the structured result for a dry-run. Exported for unit testing.
 */
export function buildCreateDryRunResult(
  message: string,
  head: string,
  baseBranch: string
): CreatePullRequestResult {
  return {
    content: [{ type: 'text', text: message }],
    details: {
      pullRequestNumber: 0,
      pullRequestUrl: '',
      headBranch: head,
      baseBranch,
      dryRun: true,
    },
  };
}

/**
 * Build the human-readable success message after PR creation. Exported for
 * unit testing.
 */
export function buildCreateSuccessMessage(pr: GitHubPullRequestResult): string {
  return `Pull request #${pr.number} created: ${pr.url}`;
}

/**
 * Build the structured result for a successful PR creation. Exported for
 * unit testing.
 */
export function buildCreateSuccessResult(pr: GitHubPullRequestResult): CreatePullRequestResult {
  return {
    content: [{ type: 'text', text: buildCreateSuccessMessage(pr) }],
    details: {
      pullRequestNumber: pr.number,
      pullRequestUrl: pr.url,
      headBranch: pr.headRef,
      baseBranch: pr.baseRef,
      dryRun: false,
      prCreated: true,
    },
  };
}

/**
 * Format a create-pull-request error for re-throw with a consistent prefix.
 * Exported for unit testing.
 */
export function formatCreateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `[pull-request] Failed to create pull request: ${message}`;
}

/**
 * Extract the HTTP status code from an Octokit-style error object.
 *
 * Octokit errors carry a numeric `.status` property (e.g. 404, 403).
 *
 * @returns The status number, or `undefined` when not available.
 * @internal Exported for testing purposes.
 */
export function getErrorStatus(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = error.status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return undefined;
}

/**
 * Build a compare URL for manually opening a pull request.
 *
 * Format: `{serverUrl}/{owner}/{repo}/compare/{base}...{head}`
 * Works across GitHub, Forgejo, Codeberg, and Gitea.
 *
 * @param deps - Module dependencies.
 * @param baseBranch - Target (base) branch name.
 * @param headBranch - Source (head) branch name.
 * @returns The compare URL.
 * @internal Exported for testing purposes.
 */
export function buildCompareUrl(
  deps: GitHubModuleDeps,
  baseBranch: string,
  headBranch: string
): string {
  const { owner, repo } = deps.context.repo;
  const serverUrl = (deps.context.serverUrl || 'https://github.com').replace(/\/$/, '');
  return `${serverUrl}/${owner}/${repo}/compare/${baseBranch}...${headBranch}`;
}

/**
 * Build the human-readable fallback message when the branch was created
 * and pushed but the PR object could not be opened automatically. Includes
 * a one-click compare URL so the user (or agent) can open the PR manually.
 *
 * Exported for unit testing.
 */
export function buildCreateFallbackMessage(
  baseBranch: string,
  headBranch: string,
  compareUrl: string,
  errorMessage: string
): string {
  return (
    `Branch "${headBranch}" was created and pushed successfully, but the pull request ` +
    `could not be opened automatically: ${errorMessage}\n\n` +
    `You can open the PR manually here:\n${compareUrl}`
  );
}

/**
 * Build the structured result for a fallback (branch created, PR not opened).
 * Exported for unit testing.
 */
export function buildCreateFallbackResult(
  message: string,
  headBranch: string,
  baseBranch: string,
  compareUrl: string
): CreatePullRequestResult {
  return {
    content: [{ type: 'text', text: message }],
    details: {
      pullRequestNumber: 0,
      pullRequestUrl: '',
      headBranch,
      baseBranch,
      dryRun: false,
      prCreated: false,
      compareUrl,
    },
  };
}

/**
 * Result of preparing a branch and attempting to open a PR.
 *
 * When `pr` is present the PR was created successfully. When `prError` is
 * present the branch was created and pushed but the PR object could not be
 * opened (e.g. the token has push access but lacks `pull-requests: write`
 * on Forgejo). The caller should provide a compare-URL fallback in that case.
 */
interface PrepareBranchAndPRResult {
  /** The PR object when creation succeeded. */
  pr?: GitHubPullRequestResult;
  /** Error details when PR creation failed (branch was still created). */
  prError?: { status: number | undefined; message: string };
}

/**
 * Prepare the branch and commit via the `git` CLI, then attempt to open
 * a pull request.
 *
 * Wraps the sequence `hasLocalChanges → commitAndPushBranch (checkout -b, add,
 * commit, push) → createPullRequestOnGitHub` into a single step.
 *
 * The git CLI operations and the `pulls.create` call are intentionally
 * separated: git push can succeed with push-only tokens, while `pulls.create`
 * requires `pull-requests: write`. On Forgejo the ephemeral Actions token
 * sometimes has the former but not the latter, so we catch **only** 401/403/404
 * (permission) errors from `pulls.create` and return a structured result
 * instead of throwing. (Forgejo returns 404 — "Can't read pulls or
 * can't read UnitTypeCode" — instead of 403 when the internal actions
 * bot user lacks the unit-level permission to create PRs; see the
 * inline comment below for details.) All other errors (422
 * already-exists, 5xx, etc.) are re-thrown so they are not silently
 * masked as partial success.
 *
 * Throws `Error` when branch/commit creation itself fails (e.g. no changes
 * detected, git push error) or when PR creation fails with a non-permission
 * HTTP status.
 */
async function prepareBranchAndCreatePR(
  deps: GitHubModuleDeps,
  baseBranch: string,
  head: string,
  title: string,
  bodyText: string,
  log: ReturnType<typeof createLogger>
): Promise<PrepareBranchAndPRResult> {
  const workspace = deps.context.workspace;

  // Check for changes in the working tree using the git CLI.
  //
  // We use `git status` (via `workspaceHasChanges`) instead of the Git Data
  // API because the API write endpoints (`createRef`, `createBlob`,
  // `createTree`, `createCommit`, `updateRef`) return 404/405 on Forgejo/Gitea.
  // The `git` CLI works uniformly across GitHub, Forgejo, Gitea, and Codeberg.
  log.debug(`Checking for changes in workspace "${workspace}"...`);
  const hasChanges = await workspaceHasChanges(workspace);

  if (!hasChanges) {
    throw new Error(
      'No changes detected. Please add new files and/or make your changes before creating a pull request.'
    );
  }

  // Create a new branch from the current HEAD, commit all changes, and push.
  //
  // The commit message includes a Co-authored-by trailer when an actor is
  // available. The branch name includes a timestamp so collisions are
  // effectively impossible.
  const commitMessage = appendCoAuthoredBy(deps, title);
  log.debug(`Creating branch "${head}", committing, and pushing via git CLI...`);
  await commitAndPushBranch({
    cwd: workspace,
    branchName: head,
    message: commitMessage,
    isNewBranch: true,
    actor: deps.context.actor,
    log,
  });
  log.debug(`Branch "${head}" created and pushed successfully`);

  // Open the PR — this can fail independently of branch creation (e.g.
  // the token has push access but lacks pull-requests: write on Forgejo).
  //
  // We only fall back to a compare URL for token-permission failures,
  // which is the Forgejo scenario this targets:
  //   - 401/403 — classic permission-denied responses.
  //   - 404 — Forgejo returns this ("Can't read pulls or can't read
  //     UnitTypeCode") when the internal actions bot user lacks the
  //     unit-level permission to create PRs, even though git push
  //     succeeded. The 404 is semantically a permission error here,
  //     not a "branch not found" error (the branch was just pushed).
  //
  // Other errors are re-thrown so they surface to the agent/user rather
  // than being silently masked as partial success:
  //   - 422 "A pull request already exists" (e.g. action re-run) → the
  //     agent should use update_pull_request instead of opening a PR
  //     that already exists.
  //   - 5xx / transient network errors → the agent should be able to
  //     retry or report the real failure.
  try {
    const pr = await createPullRequestOnGitHub(deps, title, bodyText, baseBranch, head);
    return { pr };
  } catch (error) {
    const status = getErrorStatus(error);
    const message = error instanceof Error ? error.message : String(error);
    if (status !== 401 && status !== 403 && status !== 404) {
      log.debug(
        `PR creation failed with HTTP ${status ?? 'unknown'} (not a ` +
          `permission error) — re-throwing after branch "${head}" was pushed.`
      );
      throw error;
    }
    log.warning(
      `PR creation failed after branch "${head}" was pushed ` +
        `(HTTP ${status}): ${message}. ` +
        `The branch is ready — a compare URL will be provided.`
    );
    return { prError: { status, message } };
  }
}

async function createPullRequestOnGitHub(
  deps: GitHubModuleDeps,
  title: string,
  body: string,
  baseBranch: string,
  headBranch: string
): Promise<GitHubPullRequestResult> {
  const owner = deps.context.repo.owner;
  const repo = deps.context.repo.repo;
  const log = createLogger(deps);

  log.debug(`Creating pull request...`);

  const result = await deps.octokit.rest.pulls.create({
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
 * Orchestrates the full flow: determines the base branch, checks for working-tree
 * changes, creates a branch + commit + push via the `git` CLI, and opens the PR.
 * When `dryRun` is `true` the operation is simulated and no resources are created.
 *
 * @param deps - Module dependencies.
 * @param params - Parameters controlling title, body, base branch, and dry-run.
 * @returns The tool result containing a human-readable message and structured
 *          details about the created PR (or dry-run output).
 * @throws {Error} If no changed files are detected or the GitHub API call fails.
 */
// fallow-ignore-next-line complexity
export async function createPullRequest(
  deps: GitHubModuleDeps,
  params: CreatePullRequestParams
): Promise<CreatePullRequestResult> {
  const { title, body, base, dryRun } = params;
  const log = createLogger(deps);

  // Validate input parameters early
  validateCreatePullRequestParams(params);

  // Auto-generate branch name from template and validate
  const template = deps.branchNameTemplate ?? '';
  const head = generateBranchName(deps, title, template);
  validateBranchName(head);

  log.debug(`Title: ${title}`);
  log.debug(`Auto-generated branch: ${head}`);
  log.debug(`Base: ${base ?? 'default'}`);
  log.debug(`DryRun: ${dryRun ?? false}`);

  // Determine base branch + body text (shared by dry-run and live paths)
  const baseBranch = await determineBaseBranch(deps, base);
  const bodyText = generatePullRequestBody(deps, body);

  // Dry run mode: return without calling the API
  if (dryRun) {
    const message = buildCreateDryRunMessage(title, bodyText, baseBranch, head);
    log.debug(message);
    return buildCreateDryRunResult(message, head, baseBranch);
  }

  // Create and push the new branch via git CLI
  log.debug(`Preparing branch and changes via git CLI...`);

  try {
    const result = await prepareBranchAndCreatePR(deps, baseBranch, head, title, bodyText, log);

    // PR was created successfully
    if (result.pr) {
      const successMessage = buildCreateSuccessMessage(result.pr);
      log.info(`SUCCESS: ${successMessage}`);
      return buildCreateSuccessResult(result.pr);
    }

    // Branch was created and pushed but the PR object could not be opened
    // (e.g. token lacks pull-requests:write on Forgejo). Provide a compare
    // URL so the user or agent can open the PR manually.
    if (result.prError) {
      const compareUrl = buildCompareUrl(deps, baseBranch, head);
      const message = buildCreateFallbackMessage(
        baseBranch,
        head,
        compareUrl,
        result.prError.message
      );
      log.info(`PARTIAL SUCCESS: ${message}`);
      return buildCreateFallbackResult(message, head, baseBranch, compareUrl);
    }

    // Defensive — should never reach here
    throw new Error('prepareBranchAndCreatePR returned neither pr nor prError');
  } catch (error) {
    throw new Error(formatCreateError(error));
  }
}

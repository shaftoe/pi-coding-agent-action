/**
 * @file Central prompt management for the Pi GitHub Action.
 *
 * Contains the system prompt sent to the LLM and all prompt-related constants
 * (descriptions, guidelines, parameter descriptions) consumed by the tool
 * definitions in {@link ./tools.ts}.
 */

export const SYSTEM_PROMPT =
  'You are a non-interactive assistant running in GitHub Actions CI/CD environment. You are usually tasked with code reviews and generating code changes. You will not interact with the user directly. The output (or error) you generate will be sent back as comment to the user. Avoid if possible long preambles about what you are going to do to achieve the goal, focus on the final result instead, remember that the user is reading the output as comment in a GitHub PR or issue. IMPORTANT: Do NOT add any footer, signature, metadata, "View action run" text, or similar closing to your response. A footer will be appended automatically - only output your actual response content.';

//
// Create Pull Request
//
export const CREATE_PULL_REQUEST_PROMPT_SNIPPET =
  'Create a pull request with title and description. The tool will automatically determine the default base branch, create a new branch, push changes, and create the PR.';

export const CREATE_PULL_REQUEST_PROMPT_GUIDELINES = [
  'Always use the create_pull_request tool to create pull requests - do not use git commands or gh CLI directly.',
  'Make sure your changes are made (modified files exist) before calling this tool. The tool will detect changes, create branch, and create PR automatically. Do NOT use unless you have already applied changes and/or added new files.',
  'The tool will automatically generate a branch name in the format: pi/issue{number}-{timestamp}.',
  'Do NOT provide the "base" parameter unless the user explicitly requests a different target branch than the repository default. The tool will automatically detect the correct default branch.',
  'Use dryRun=true first to verify the PR configuration, then dryRun=false to create it.',
  'On some platforms (e.g. Forgejo) the PR object cannot always be opened automatically even though the branch is pushed. When this happens the tool returns a compare URL instead of an error — post that URL so the user can open the PR manually.',
];

export const CREATE_PULL_REQUEST_DESCRIPTION =
  'Create a new pull request on GitHub. This tool handles everything: automatically determines the default base branch, creates a new branch, pushes changes, and creates the PR. The branch name is auto-generated following the pi/issue{number}-{timestamp} pattern.';

export const CREATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION =
  'Pull request title (should be descriptive and follow conventional commit format)';

export const CREATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION =
  'Detailed description of changes in markdown format. If not provided, will auto-generate from issue context (e.g., "Fixes #27")';

export const CREATE_PULL_REQUEST_PARAM_BASE_DESCRIPTION =
  'EXPERT: Override the default target branch. Only use this if the user explicitly requests a different branch than the repository default. Do NOT guess or assume a branch name - leave this empty unless specifically instructed.';

export const CREATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION =
  'Set to true to simulate PR creation without actually creating it (for testing). Set to false to create the actual PR.';

//
// Get Issue/PR Thread
//
export const GET_ISSUE_PR_THREAD_PROMPT_SNIPPET =
  'Get the full comment thread for a GitHub issue or pull request, including title, description, labels, and all comments. For PRs, also includes inline review comments.';

export const GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES = [
  'Use get_issue_or_pr_thread to understand the context of an issue or PR before taking action.',
  'By default, the tool fetches the current issue/PR from the GitHub context. Only provide owner/repo/issue_number when you need to fetch a different one.',
  'Use max_comments to limit results for very long threads; defaults to 100 comments.',
  'For pull requests, the tool also returns inline review comments (comments on specific lines of the diff).',
];

export const GET_ISSUE_PR_THREAD_DESCRIPTION =
  'Retrieve the complete comment thread for a GitHub issue or pull request. Returns the title, description, labels, state, author, timestamps, and all comments. For pull requests, also includes inline review comments with file path and line information, plus branch names and merge status. Does NOT fetch code changes — use the get_pr_diff tool for that.';

export const GET_ISSUE_PR_THREAD_PARAM_OWNER_DESCRIPTION =
  'Repository owner (e.g., "octocat"). If not provided, uses the current repository from context.';

export const GET_ISSUE_PR_THREAD_PARAM_REPO_DESCRIPTION =
  'Repository name (e.g., "hello-world"). If not provided, uses the current repository from context.';

export const GET_ISSUE_PR_THREAD_PARAM_ISSUE_NUMBER_DESCRIPTION =
  'Issue or pull request number. If not provided, uses the current issue/PR from context.';

export const GET_ISSUE_PR_THREAD_PARAM_MAX_COMMENTS_DESCRIPTION =
  'Maximum number of comments to fetch. Defaults to 100. Use for limiting very long threads.';

//
// Update Pull Request
//
export const UPDATE_PULL_REQUEST_PROMPT_SNIPPET =
  'Update an existing pull request by pushing new commits to the PR branch and optionally updating the title and/or body.';

export const UPDATE_PULL_REQUEST_PROMPT_GUIDELINES = [
  'Use update_pull_request when working within an existing PR flow to push new commits and/or update PR metadata.',
  'Make sure your changes are made (modified files exist) before calling this tool. The tool will detect changes and create a new commit on the PR branch.',
  'By default, the tool works with the current PR from the GitHub context. Only provide pull_number when you need to update a different PR.',
  'The tool commits changes with the provided message (or generates a default message) and pushes them to the existing PR branch.',
  'You can update the PR title and/or body using the title and body parameters.',
  'Use dryRun=true first to verify the update configuration, then dryRun=false to apply the changes.',
];

export const UPDATE_PULL_REQUEST_DESCRIPTION =
  'Update an existing pull request by pushing new commits to the PR branch. Optionally updates the PR title and/or description. The tool detects changes in the working tree, creates a new commit on the PR branch, and updates the PR metadata if provided.';

export const UPDATE_PULL_REQUEST_PARAM_PULL_NUMBER_DESCRIPTION =
  'Pull request number. If not provided, uses the current PR from context.';

export const UPDATE_PULL_REQUEST_PARAM_TITLE_DESCRIPTION =
  'New pull request title. If not provided, the title is not changed.';

export const UPDATE_PULL_REQUEST_PARAM_BODY_DESCRIPTION =
  'New pull request description in markdown format. If not provided, the description is not changed.';

export const UPDATE_PULL_REQUEST_PARAM_MESSAGE_DESCRIPTION =
  'Commit message for the new commit. If not provided, a descriptive message will be auto-generated based on the changes.';

export const UPDATE_PULL_REQUEST_PARAM_DRY_RUN_DESCRIPTION =
  'Set to true to simulate the PR update without actually modifying anything (for testing). Set to false to apply the actual changes.';

//
// Get PR Diff
//
export const GET_PR_DIFF_PROMPT_SNIPPET =
  'Get the diff of a pull request. Use this to understand what code changes a PR introduces.';

export const GET_PR_DIFF_PROMPT_GUIDELINES = [
  'Use get_pr_diff to fetch the diff of a pull request when you need to understand what changed.',
  'By default, the tool fetches the diff for the current PR from the GitHub context. Only provide owner/repo/pull_number when you need to fetch a different PR.',
  'The diff is truncated at 1000 lines and 100KB by default. Use max_lines to increase or decrease the line limit.',
  'Use ignore_files to exclude common noisy paths (dist/, package-lock.json, etc.) from the diff.',
];

export const GET_PR_DIFF_DESCRIPTION =
  'Fetch the diff of a GitHub pull request. Returns the diff as a string, truncated if too large. Useful for understanding what code changes a PR introduces before reviewing or modifying them.';

export const GET_PR_DIFF_PARAM_OWNER_DESCRIPTION =
  'Repository owner (e.g., "octocat"). If not provided, uses the current repository from context.';

export const GET_PR_DIFF_PARAM_REPO_DESCRIPTION =
  'Repository name (e.g., "hello-world"). If not provided, uses the current repository from context.';

export const GET_PR_DIFF_PARAM_PULL_NUMBER_DESCRIPTION =
  'Pull request number. If not provided, uses the current PR from context.';

export const GET_PR_DIFF_PARAM_MAX_LINES_DESCRIPTION =
  'Maximum number of diff lines to return. Defaults to 1000 (or the action-level diff_max_lines input). Use for limiting very large diffs.';

export const GET_PR_DIFF_PARAM_IGNORE_FILES_DESCRIPTION =
  'List of file paths to exclude from the diff. Supports exact file paths (e.g. "package-lock.json") and directory prefixes (e.g. "dist/" to exclude everything under dist/). Matching is literal — glob patterns (e.g. "*.min.js") are NOT supported. Useful for filtering out generated files, build artifacts, or vendored dependencies.';

//
// Create Pull Request Review
//
export const CREATE_REVIEW_PROMPT_SNIPPET =
  'Create a pull request review with inline comments anchored to specific lines of the diff. This is the best way to provide line-by-line code review feedback.';

export const CREATE_REVIEW_PROMPT_GUIDELINES = [
  'Use create_pull_request_review to post inline review comments anchored to specific diff lines. This is much more useful than top-level comments because reviewers can see findings directly in the diff context.',
  'Each comment requires a `path` (file path relative to repo root), `line` (line number in the new/right side of the diff), and `body` (Markdown comment text).',
  'Use `side: "LEFT"` to comment on the old version of the file (before the change), or omit it / use `side: "RIGHT"` (default) for the new version.',
  'For multi-line comments, set `start_line` to the first line and `line` to the last line of the range.',
  'The `event` parameter controls the review type: COMMENT (default, neutral feedback), APPROVE (approve the PR), or REQUEST_CHANGES (request changes before merging).',
  'A `body` (summary comment) is optional but recommended — it provides context for the overall review.',
  'At least one inline comment is required. To post only a summary review comment without inline comments, use a regular PR comment instead.',
  'Make sure line numbers reference the correct version of the file. Use the `get_pr_diff` tool first to understand the diff and verify line numbers.',
];

export const CREATE_REVIEW_DESCRIPTION =
  'Create a pull request review with inline comments anchored to specific lines of the diff. Posts a GitHub Pull Request Review using the `pulls.createReview` API with comments positioned on specific lines. Each comment is anchored to a file path and line number in the diff.';

export const CREATE_REVIEW_PARAM_PULL_NUMBER_DESCRIPTION =
  'Pull request number. If not provided, uses the current PR from context.';

export const CREATE_REVIEW_PARAM_BODY_DESCRIPTION =
  'Summary comment for the review (shown at the top of the review). Optional but recommended.';

export const CREATE_REVIEW_PARAM_EVENT_DESCRIPTION =
  'Review event type: COMMENT (default, neutral feedback), APPROVE (approve the PR), or REQUEST_CHANGES (request changes before merging).';

export const CREATE_REVIEW_PARAM_COMMENTS_DESCRIPTION =
  'Array of inline comments. Each comment requires: path (file path), line (line number in the diff), and body (Markdown comment). Optional: side (LEFT=old or RIGHT=new, default RIGHT), start_line (for multi-line comments).';

export const CREATE_REVIEW_PARAM_COMMENT_PATH_DESCRIPTION =
  'Repository-relative file path (e.g., "src/main.ts").';

export const CREATE_REVIEW_PARAM_COMMENT_LINE_DESCRIPTION =
  'Line number in the diff. For multi-line comments, this is the end line. Must be a positive integer.';

export const CREATE_REVIEW_PARAM_COMMENT_SIDE_DESCRIPTION =
  'Which side of the diff: RIGHT (new file, default) or LEFT (old file).';

export const CREATE_REVIEW_PARAM_COMMENT_START_LINE_DESCRIPTION =
  'Start line for multi-line comments. If set, `line` is treated as the end line.';

export const CREATE_REVIEW_PARAM_COMMENT_START_SIDE_DESCRIPTION =
  'Which side `start_line` refers to. Only needed when different from `side`.';

export const CREATE_REVIEW_PARAM_COMMENT_BODY_DESCRIPTION =
  'The Markdown body of the inline comment.';

//
// Get CI Status
//
export const GET_CI_STATUS_PROMPT_SNIPPET =
  'Check the CI/CD status for a pull request or commit ref. Returns check runs and workflow runs with their statuses, conclusions, and URLs.';

export const GET_CI_STATUS_PROMPT_GUIDELINES = [
  'Use get_ci_status to inspect the CI/CD status of a pull request or commit before or after making changes.',
  'By default, the tool fetches status for the current PR from the GitHub context. Only provide owner/repo/pull_number when you need to check a different PR.',
  'You can also provide a `ref` (commit SHA or branch name) directly instead of a pull_number.',
  'Filter by `status` (queued, in_progress, completed) or `conclusion` (success, failure, cancelled, timed_out) to narrow results.',
  'For failed workflow runs, use the returned run_id with the `get_workflow_run_logs` tool to fetch detailed job logs and diagnose failures.',
];

export const GET_CI_STATUS_DESCRIPTION =
  'Get the CI/CD status for a pull request or commit ref. Returns a list of check runs and workflow runs with their statuses, conclusions, and URLs. Use this to check if CI is passing or failing before or after making changes.';

export const GET_CI_STATUS_PARAM_OWNER_DESCRIPTION =
  'Repository owner (e.g., "octocat"). If not provided, uses the current repository from context.';

export const GET_CI_STATUS_PARAM_REPO_DESCRIPTION =
  'Repository name (e.g., "hello-world"). If not provided, uses the current repository from context.';

export const GET_CI_STATUS_PARAM_PULL_NUMBER_DESCRIPTION =
  'Pull request number. If not provided, uses the current PR from context. Alternative to providing a ref.';

export const GET_CI_STATUS_PARAM_REF_DESCRIPTION =
  'Git ref (commit SHA or branch name) to check. If not provided, resolved from pull_number or context.';

export const GET_CI_STATUS_PARAM_STATUS_DESCRIPTION =
  'Filter by status: queued, in_progress, completed.';

export const GET_CI_STATUS_PARAM_CONCLUSION_DESCRIPTION =
  'Filter by conclusion: success, failure, cancelled, timed_out, action_required, etc.';

//
// Get Workflow Run Logs
//
export const GET_WORKFLOW_RUN_LOGS_PROMPT_SNIPPET =
  'Fetch the job logs for a specific workflow run. Use this to diagnose CI failures by inspecting the actual log output.';

export const GET_WORKFLOW_RUN_LOGS_PROMPT_GUIDELINES = [
  'Use get_workflow_run_logs when you need to inspect the actual log output of a workflow run to diagnose failures.',
  'First use `get_ci_status` to find the run_id of a failed workflow run, then use this tool to fetch its logs.',
  'Logs are truncated to 50KB by default. Truncation keeps the end of the log (where errors typically appear). Use `max_bytes` to increase or decrease the limit (capped at 1MB).',
  'The tool returns logs for all jobs in the run, with each job clearly labeled. Logs are truncated from the head, preserving the tail where error messages typically appear.',
];

export const GET_WORKFLOW_RUN_LOGS_DESCRIPTION =
  'Fetch the job logs for a specific GitHub Actions workflow run. Returns the log output for each job, truncated if too large. Use this to diagnose CI failures by inspecting the actual error messages and stack traces.';

export const GET_WORKFLOW_RUN_LOGS_PARAM_RUN_ID_DESCRIPTION =
  'The workflow run ID to fetch logs for. Get this from the get_ci_status tool output.';

export const GET_WORKFLOW_RUN_LOGS_PARAM_MAX_BYTES_DESCRIPTION =
  'Maximum total log bytes to return. Defaults to 51200 (50KB). Capped at 1048576 (1MB). Use for limiting very large log outputs.';

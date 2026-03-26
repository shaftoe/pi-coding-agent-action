# Code Quality Recommendations for `src/`

This document provides an analysis and recommendations for improving code quality in the `src/` directory.

## Summary of Findings

The codebase is generally well-structured with good TypeScript practices, proper separation of concerns between modules, and comprehensive test coverage. However, there are several areas for improvement related to:

1. **Code Organization & Separation of Concerns**
2. **Error Handling & Validation**
3. **Code Duplication**
4. **Type Safety**
5. **Configuration & Magic Values**
6. **Documentation**
7. **Testing**
8. **Performance & Resource Management**
9. **Maintainability**

---

## 1. Code Organization & Separation of Concerns

### Issue: Mixed Responsibilities in `gh.ts`
**File:** `src/gh.ts`

**Severity:** Medium

The `GitHubClient` class mixes GitHub CLI operations with Octokit API calls. This violates the single responsibility principle and makes the class harder to test and maintain.

**Current Code:**
```typescript
class GitHubClient {
  // CLI operations
  cli(command: string[], options?: { input?: string }): string { ... }
  getIssueData(issueNumber: number): IssueNode { ... }
  getPRData(prNumber: number): PRNode { ... }

  // API operations
  async createComment(issueNumber: number, body: string): Promise<void> { ... }
  async addReaction(commentId: number, content: GitHubReaction): Promise<number> { ... }
  async removeReaction(commentId: number, reactionId: number): Promise<void> { ... }
  async createPR(base: string, head: string, title: string, body: string): Promise<number> { ... }
}
```

**Recommendation:**
```typescript
// Split into separate concerns:

// 1. CLI operations only
class GitHubCLIClient {
  cli(command: string[], options?: { input?: string }): string { ... }
  getIssueData(issueNumber: number): IssueNode { ... }
  getPRData(prNumber: number): PRNode { ... }
}

// 2. API operations only
class GitHubAPIClient {
  private readonly octokit: ReturnType<typeof github.getOctokit>;
  
  async createComment(issueNumber: number, body: string): Promise<void> { ... }
  async addReaction(commentId: number, content: GitHubReaction): Promise<number> { ... }
  async removeReaction(commentId: number, reactionId: number): Promise<void> { ... }
  async createPR(base: string, head: string, title: string, body: string): Promise<number> { ... }
}

// 3. Orchestration layer
export class GitHubService {
  constructor(
    private readonly cli: GitHubCLIClient,
    private readonly api: GitHubAPIClient
  ) {}
  
  // Delegates to appropriate client
}
```

**Benefits:**
- Clearer separation of concerns
- Easier to test CLI and API operations independently
- Better error handling per concern
- More maintainable code

---

### Issue: `runPi` Function Too Large
**File:** `src/pi.ts` (lines ~36-113)

**Severity:** High

The `runPi` function handles multiple responsibilities:
- Reading action inputs
- Writing temp files
- Building command arguments
- Injecting environment variables
- Executing external commands
- Cleaning up temp files

**Recommendation:**
Extract into smaller, focused functions:

```typescript
// Helper functions
async function writePromptFile(prompt: string): Promise<string> {
  const promptFile = path.join(os.tmpdir(), PROMPT_TEMP_FILE);
  await fs.promises.writeFile(promptFile, prompt, 'utf8');
  return promptFile;
}

async function writeSystemPromptFile(content: string): Promise<string> {
  const systemPromptFile = path.join(
    os.tmpdir(),
    `${SYSTEM_PROMPT_TEMP_FILE_PREFIX}_${crypto.randomUUID()}.md`
  );
  await fs.promises.writeFile(systemPromptFile, content, 'utf8');
  return systemPromptFile;
}

function buildPiArgs(
  provider: string,
  model: string,
  extraTools: string,
  promptFile: string,
  systemPromptFile?: string
): string[] {
  const args = [
    '--provider', provider,
    '--model', model,
    '-p',
    `@${promptFile}`,
  ];

  if (extraTools) {
    args.push('--tools', extraTools);
  }

  if (systemPromptFile) {
    args.push('--system', systemPromptFile);
  }

  return args;
}

function injectEnvVars(envVars: EnvVar[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const { key, value } of envVars) {
    core.info(`Setting env var: ${key}=***`);
    env[key] = value;
  }
  return env;
}

async function executePiCommand(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  core.info(`Running: pi ${args.join(' ')}`);
  const rawOutput = runCommand(
    ['pi', ...args],
    { timeout: PI_TIMEOUT_MS, stdio: 'inherit' },
    env
  );
  core.info(`\nPi raw output:\n${rawOutput}`);
  return rawOutput;
}

// Main function becomes much clearer
export async function runPi(
  prompt: string,
  overrideProvider?: string,
  overrideModel?: string
): Promise<string> {
  const provider = overrideProvider ?? core.getInput('provider') ?? DEFAULT_PI_PROVIDER;
  const model = overrideModel ?? core.getInput('model') ?? DEFAULT_PI_MODEL;
  const extraTools = core.getInput('extra_tools') ?? '';
  const customSystemPrompt = core.getInput('prompt') ?? '';
  const envVarsString = core.getInput('env_vars') ?? '';
  const envVars = parseEnvVars(envVarsString);

  const promptFile = await writePromptFile(prompt);
  let systemPromptFile: string | undefined;

  try {
    if (customSystemPrompt) {
      systemPromptFile = await writeSystemPromptFile(customSystemPrompt);
    }

    const args = buildPiArgs(provider, model, extraTools, promptFile, systemPromptFile);
    const env = injectEnvVars(envVars);

    return await executePiCommand(args, env);
  } finally {
    await safeRemoveFile(promptFile);
    if (systemPromptFile) {
      await safeRemoveFile(systemPromptFile);
    }
  }
}
```

**Benefits:**
- Each function has a single responsibility
- Easier to test individual components
- Better error handling for each step
- More readable and maintainable

---

## 2. Error Handling & Validation

### Issue: Missing Input Validation
**Files:** `src/index.ts`, `src/pi.ts`

**Severity:** High

Several functions lack proper input validation:

**In `src/index.ts`:**
```typescript
function extractContext(payload: GitHubPayload) {
  if (!payload.issue) {
    throw new Error('GitHub payload is missing issue data');
  }

  const issueNumber = payload.issue.number;
  const commentBody = payload.comment?.body ?? '';
  const commentId = payload.comment?.id ?? undefined;  // No validation

  // ...
}
```

**In `src/pi.ts`:**
```typescript
export function runPi(prompt: string, ...): string {
  // No validation of prompt parameter
  if (prompt.trim() === '') { // Should check before processing
    // ...
  }
}
```

**Recommendation:**
Add validation helper functions and type guards:

```typescript
// Validation utilities

/**
 * Validates that the GitHub payload has the required issue data.
 */
function validateGitHubPayload(payload: unknown): asserts payload is GitHubPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid GitHub payload: not an object');
  }

  if (!('issue' in payload) || !payload.issue) {
    throw new Error('GitHub payload is missing issue data');
  }

  const issue = payload.issue as IssueWithPR;
  if (typeof issue.number !== 'number') {
    throw new Error('Invalid GitHub payload: issue number is not a number');
  }
}

/**
 * Validates and type-guards a comment ID.
 */
function validateCommentId(commentId: unknown): number | undefined {
  if (commentId === undefined || commentId === null) {
    return undefined;
  }

  if (typeof commentId !== 'number') {
    throw new Error(`Invalid comment ID: expected number, got ${typeof commentId}`);
  }

  return commentId;
}

/**
 * Validates that a prompt is non-empty.
 */
function validatePrompt(prompt: string): void {
  if (typeof prompt !== 'string') {
    throw new Error(`Invalid prompt: expected string, got ${typeof prompt}`);
  }

  if (!prompt.trim()) {
    throw new Error('Prompt cannot be empty');
  }
}

/**
 * Validates that the GitHub context is available.
 */
function validateGitHubContext(): void {
  if (!github.context?.repo?.owner || !github.context?.repo?.repo) {
    throw new Error('Invalid GitHub context: missing repository information');
  }

  if (!github.context?.serverUrl) {
    throw new Error('Invalid GitHub context: missing server URL');
  }
}

// Updated extractContext function
function extractContext(payload: GitHubPayload) {
  validateGitHubPayload(payload);

  const issueNumber = payload.issue.number;
  const commentBody = payload.comment?.body ?? '';
  const commentId = validateCommentId(payload.comment?.id);

  const userPrompt = extractUserPrompt(commentBody) ?? '';
  const runUrl = buildRunUrl();

  validateGitHubContext();

  return { issueNumber, userPrompt, runUrl, commentId };
}
```

---

### Issue: Generic Error Messages
**File:** `src/gh.ts` (lines ~39-49)

**Severity:** Medium

The `parseJSONOutput` method provides minimal context when parsing fails:

```typescript
private parseJSONOutput<T>(output: string, dataType: string, number: number): T {
  try {
    return JSON.parse(output) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse ${dataType} data for #${number}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
```

**Recommendation:**
Provide more context for debugging:

```typescript
private parseJSONOutput<T>(output: string, dataType: string, number: number): T {
  try {
    return JSON.parse(output) as T;
  } catch (e) {
    const preview = output.length > 200
      ? output.substring(0, 200) + '... (truncated)'
      : output;

    const errorDetails = [
      `Failed to parse ${dataType} data for #${number}`,
      `Error: ${e instanceof Error ? e.message : String(e)}`,
      `Output preview: "${preview}"`,
      `Output length: ${output.length} bytes`,
    ].join('\n');

    core.error(errorDetails);
    throw new Error(errorDetails);
  }
}
```

---

## 3. Code Duplication

### Issue: Duplicate URL Building Logic
**File:** `src/index.ts` (lines ~35-42, ~94-98, ~147-152)

**Severity:** Medium

URL construction logic is scattered across multiple functions:

```typescript
// Lines ~35-42
function buildRunUrl(): string {
  const serverUrl = github.context.serverUrl || 'https://github.com';
  const owner = github.context.repo.owner || 'unknown';
  const repo = github.context.repo.repo || 'unknown';
  const runId = process.env.GITHUB_RUN_ID ?? 'unknown';
  return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
}

// Lines ~94-98 (in handlePRWorkflow)
const { owner, repo } = github.context.repo;
const serverUrl = github.context.serverUrl || 'https://github.com';
const branchUrl = `${serverUrl}/${owner}/${repo}/tree/${newBranch}`;

// Lines ~147-152 (in handleIssueWorkflow)
const serverUrl = github.context.serverUrl || 'https://github.com';
const { owner, repo } = github.context.repo;
const prUrl = `${serverUrl}/${owner}/${repo}/pull/${prNumber}`;
```

**Recommendation:**
Create a URL builder utility:

```typescript
// src/url-builder.ts
import * as github from '@actions/github';

/**
 * Interface for building GitHub URLs.
 */
interface URLBuilder {
  buildBranchUrl(branch: string): string;
  buildPRUrl(prNumber: number): string;
  buildRunUrl(): string;
}

/**
 * Builds URLs for GitHub resources.
 */
export class GitHubURLBuilder implements URLBuilder {
  private readonly serverUrl: string;
  private readonly owner: string;
  private readonly repo: string;

  constructor() {
    this.serverUrl = github.context.serverUrl || 'https://github.com';
    this.owner = github.context.repo.owner || 'unknown';
    this.repo = github.context.repo.repo || 'unknown';
  }

  buildBranchUrl(branch: string): string {
    return `${this.serverUrl}/${this.owner}/${this.repo}/tree/${branch}`;
  }

  buildPRUrl(prNumber: number): string {
    return `${this.serverUrl}/${this.owner}/${this.repo}/pull/${prNumber}`;
  }

  buildRunUrl(): string {
    const runId = process.env.GITHUB_RUN_ID ?? 'unknown';
    return `${this.serverUrl}/${this.owner}/${this.repo}/actions/runs/${runId}`;
  }
}

// Usage in src/index.ts
const urlBuilder = new GitHubURLBuilder();

// In handlePRWorkflow
const branchUrl = urlBuilder.buildBranchUrl(newBranch);
const runUrl = urlBuilder.buildRunUrl();

// In handleIssueWorkflow
const prUrl = urlBuilder.buildPRUrl(prNumber);
const runUrl = urlBuilder.buildRunUrl();
```

---

### Issue: Duplicate Format Logic
**File:** `src/prompts.ts` (lines ~25-82)

**Severity:** Low

The format functions (`formatComments`, `formatFiles`, `formatReviews`) have similar patterns:

```typescript
function formatComments(...): string {
  return comments
    .filter(c => commentId === undefined || c.databaseId !== commentId)
    .map(c => `${indent}${c.author.login} at ${c.createdAt}: ${c.body}`)
    .join('\n');
}

function formatFiles(...): string {
  return files.map(f => `- ${f.path} (${f.changeType}) +${f.additions}/-${f.deletions}`).join('\n');
}

function formatReviews(...): string {
  return reviews
    .map(r => {
      const rc = (r.comments ?? [])
        .map(c => `    - ${c.path ?? 'unknown'}:${c.line ?? '?'}: ${c.body}`)
        .join('\n');
      return `- ${r.author.login} at ${r.submittedAt}: ${r.body}${rc ? '\n' + rc : ''}`;
    })
    .join('\n');
}
```

**Recommendation:**
Use a generic formatter interface:

```typescript
// Formatter interface
interface Formatter<T> {
  format(item: T, indent?: string): string;
}

// Comment formatter
class CommentFormatter implements Formatter<IssueComment> {
  format(comment: IssueComment, indent = '  - '): string {
    return `${indent}${comment.author.login} at ${comment.createdAt}: ${comment.body}`;
  }
}

// File formatter
class FileFormatter implements Formatter<PRFileChange> {
  format(file: PRFileChange): string {
    return `- ${file.path} (${file.changeType}) +${file.additions}/-${file.deletions}`;
  }
}

// Review formatter
class ReviewFormatter implements Formatter<PRReview> {
  format(review: PRReview): string {
    const commentFormatter = new ReviewCommentFormatter();
    const comments = (review.comments ?? [])
      .map(c => commentFormatter.format(c))
      .join('\n');
    return `- ${review.author.login} at ${review.submittedAt}: ${review.body}${comments ? '\n' + comments : ''}`;
  }
}

// Updated format functions
function formatComments(
  comments: IssueComment[],
  commentId: number | undefined,
  indent = '  - '
): string {
  const formatter = new CommentFormatter();
  return comments
    .filter(c => commentId === undefined || c.databaseId !== commentId)
    .map(c => formatter.format(c, indent))
    .join('\n');
}

function formatFiles(files: PRFileChange[]): string {
  const formatter = new FileFormatter();
  return files.map(f => formatter.format(f)).join('\n');
}

function formatReviews(reviews: PRReview[]): string {
  const formatter = new ReviewFormatter();
  return reviews.map(r => formatter.format(r)).join('\n');
}
```

---

## 4. Type Safety

### Issue: Loose Error Handling
**File:** `src/index.ts` (lines ~160-176)

**Severity:** Medium

The `handleError` function uses loose error type handling:

```typescript
async function handleError(err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  // ...
}
```

**Recommendation:**
Define a custom error type hierarchy:

```typescript
// src/errors.ts
/**
 * Base error class for pi-agent specific errors.
 */
export class PiAgentError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'PiAgentError';
  }

  toString(): string {
    let output = `[${this.code}] ${this.message}`;
    if (this.originalError) {
      output += `\nCaused by: ${this.originalError instanceof Error ? this.originalError.stack : String(this.originalError)}`;
    }
    return output;
  }
}

/**
 * Error thrown when GitHub API operations fail.
 */
export class GitHubAPIError extends PiAgentError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'GITHUB_API_ERROR', originalError);
    this.name = 'GitHubAPIError';
  }
}

/**
 * Error thrown when Git operations fail.
 */
export class GitError extends PiAgentError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'GIT_ERROR', originalError);
    this.name = 'GitError';
  }
}

/**
 * Error thrown when the pi-agent CLI fails.
 */
export class PiCLIError extends PiAgentError {
  constructor(message: string, originalError?: unknown) {
    super(message, 'PI_CLI_ERROR', originalError);
    this.name = 'PiCLIError';
  }
}

/**
 * Error thrown when input validation fails.
 */
export class ValidationError extends PiAgentError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

// Usage in handleError
async function handleError(err: unknown): Promise<void> {
  const runUrl = buildRunUrl();
  const issueNumber = github.context.payload.issue?.number;

  let errorMessage: string;
  let errorContext: string;

  if (err instanceof PiAgentError) {
    errorMessage = err.toString();
    errorContext = `Error code: ${err.code}`;
  } else if (err instanceof Error) {
    errorMessage = err.message;
    errorContext = err.stack || 'No stack trace available';
  } else {
    errorMessage = String(err);
    errorContext = 'Unknown error type';
  }

  core.error(`Error details:\n${errorContext}`);

  if (issueNumber !== undefined) {
    await gh.createComment(
      issueNumber,
      `❌ pi agent error:\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\n[View run](${runUrl})`
    );
  } else {
    core.info(`[View run](${runUrl})`);
  }
  core.setFailed(errorMessage);
}
```

---

### Issue: Unused No-Op Method
**File:** `src/git.ts` (lines ~61-88)

**Severity:** Low

The `configureCredentials` method is documented as a no-op but still exists, which is confusing for maintainers.

**Current Code:**
```typescript
/**
 * Validates and logs git credential configuration.
 *
 * Note: This is a no-op for isomorphic-git which handles credentials via
 * onAuth callbacks during push. The method is kept for potential future
 * enhancements and to validate repository context availability.
 */
async configureCredentials(): Promise<void> {
  // Check if GitHub context is available (may not be in test environments)
  try {
    const repo = github.context?.repo;
    if (repo) {
      const { owner, repo: repoName } = repo;
      core.debug(`Git context validated for ${owner}/${repoName}`);
    } else {
      core.debug('Git context validation skipped (no github context)');
    }
  } catch (error) {
    // Only silence errors related to missing context - rethrow others
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!errorMsg.includes('context') && !errorMsg.includes('undefined')) {
      throw error;
    }
    core.debug(`Git context validation skipped: ${errorMsg}`);
  }
  // Credentials are provided via onAuth callback during push operations
}
```

**Recommendation:**
Remove the method entirely since:
1. It's documented as a no-op
2. Credentials are already handled via `onAuth` callback in `commitAndPush`
3. The context validation happens anyway in `commitAndPush`

Or, if you want to keep it for future use, actually implement something useful:

```typescript
/**
 * Validates git credential configuration and GitHub context.
 *
 * @throws {Error} If GitHub context is missing or invalid
 */
async configureCredentials(): Promise<void> {
  const { owner, repo } = github.context.repo;

  if (!owner || !repo) {
    throw new Error(
      'Invalid GitHub context: missing repository information. ' +
      'This action requires a GitHub repository context to function correctly.'
    );
  }

  if (!this.token) {
    throw new Error(
      'Invalid git configuration: authentication token is missing. ' +
      'Please ensure the github_token input is provided.'
    );
  }

  core.debug(`Git credentials validated for ${owner}/${repo}`);
  // Future: Add actual credential validation if needed
}
```

---

## 5. Configuration & Magic Values

### Issue: Magic Values in Code
**File:** `src/pi.ts` (line ~52)

**Severity:** Low

The GENERIC_PREFIX_PATTERN regex is defined inline but should be in constants.

**Current Code:**
```typescript
const GENERIC_PREFIX_PATTERN = /^(I|I'll|Sure|OK|Great|Here|The|This|A)/i;
```

**Recommendation:**
Move to `src/constants.ts`:

```typescript
// In src/constants.ts
/**
 * Regex pattern for detecting generic AI response prefixes.
 * These patterns make poor commit message subjects.
 */
export const GENERIC_PREFIX_PATTERN = /^(I|I'll|Sure|OK|Great|Here|The|This|A)/i;

// In src/pi.ts
import { GENERIC_PREFIX_PATTERN } from './constants.js';
```

---

### Issue: Hardcoded Indentation Strings
**File:** `src/prompts.ts`

**Severity:** Low

Indentation is hardcoded as `'  - '` in multiple places.

**Recommendation:**
Move to constants:

```typescript
// In src/constants.ts
/**
 * Indentation string for prompt formatting.
 */
export const PROMPT_INDENT = '  - ';

/**
 * Indentation string for nested prompt items.
 */
export const PROMPT_INDENT_NESTED = '    - ';

// In src/prompts.ts
import { PROMPT_INDENT, PROMPT_INDENT_NESTED } from './constants.js';

function formatComments(..., indent = PROMPT_INDENT): string {
  // ...
}

function formatReviews(...): string {
  // ...
  const rc = (r.comments ?? [])
    .map(c => `${PROMPT_INDENT_NESTED}${c.path ?? 'unknown'}:${c.line ?? '?'}: ${c.body}`)
    .join('\n');
  // ...
}
```

---

## 6. Documentation

### Issue: Incomplete JSDoc
**Files:** Multiple files

**Severity:** Low

Several functions are missing parameter descriptions or return value documentation.

**Examples:**

```typescript
// src/utils.ts
export function extractUserPrompt(body: string): string | null {
  // Missing JSDoc
}

export function parseEnvVars(envVarsString: string): EnvVar[] {
  // Missing JSDoc
}

// src/pi.ts
export function runPi(prompt: string, overrideProvider?: string, overrideModel?: string): string {
  // Missing JSDoc
}

export function summarize(text: string, issueNumber: number): string {
  // Has some JSDoc but could be more detailed
}
```

**Recommendation:**
Add comprehensive JSDoc to all public APIs:

```typescript
/**
 * Extracts the user prompt from a comment body by removing the mention prefix.
 *
 * @param body - The comment body text to parse
 * @returns The extracted user prompt without the mention, or null if the body is empty
 *
 * @example
 * ```ts
 * extractUserPrompt('/pi fix this bug'); // Returns: 'fix this bug'
 * extractUserPrompt('/pi'); // Returns: null
 * extractUserPrompt('just a comment'); // Returns: 'just a comment'
 * ```
 */
export function extractUserPrompt(body: string): string | null {
  // ...
}

/**
 * Parses environment variables from a multi-line string of KEY=VALUE pairs.
 *
 * @param envVarsString - Multi-line string with KEY=VALUE pairs
 * @returns Array of parsed environment variable key-value pairs
 * @throws {Error} If any environment variable key is invalid
 *
 * @example
 * ```ts
 * parseEnvVars('API_KEY=secret\nDEBUG=true');
 * // Returns: [{ key: 'API_KEY', value: 'secret' }, { key: 'DEBUG', value: 'true' }]
 * ```
 */
export function parseEnvVars(envVarsString: string): EnvVar[] {
  // ...
}

/**
 * Runs the pi agent with the given prompt.
 *
 * @param prompt - The prompt to send to pi (must be non-empty)
 * @param overrideProvider - Optional provider override (e.g., 'anthropic', 'openai')
 * @param overrideModel - Optional model override (e.g., 'claude-3-opus')
 * @returns The response from pi
 * @throws {Error} If the prompt is empty or pi execution fails
 *
 * @example
 * ```ts
 * const response = runPi('Fix this bug', 'anthropic', 'claude-3-opus');
 * ```
 */
export function runPi(
  prompt: string,
  overrideProvider?: string,
  overrideModel?: string
): string {
  // ...
}

/**
 * Summarizes text for use as a git commit message.
 * Uses a simple heuristic to avoid expensive AI calls.
 *
 * @param text - The text to summarize
 * @param issueNumber - The issue number used for fallback message
 * @returns A short summary suitable for a git commit message (max 50 characters)
 *
 * @example
 * ```ts
 * summarize('Fixed memory leak in user service', 123);
 * // Returns: 'Fixed memory leak'
 *
 * summarize('I will help you fix this issue', 456);
 * // Returns: 'Fix issue #456' (generic prefix is removed)
 * ```
 */
export function summarize(text: string, issueNumber: number): string {
  // ...
}
```

---

## 7. Testing

### Issue: Insufficient Test Coverage
**Files:** Test files across the board

**Severity:** Medium

Many test files only check function signatures or simple cases, missing:
- Edge cases and error conditions
- Complex workflow integration
- Mock external dependencies properly

**Current Test Patterns:**

```typescript
// src/utils.test.ts
describe('runCommand', () => {
  it('should execute a simple command successfully', () => {
    const result = runCommand(['echo', 'hello']);
    expect(result).toBe('hello');
  });
  // Missing: timeout tests, error cases, special characters, etc.
});

// src/gh.test.ts
describe('GitHubClient', () => {
  it('should be available on gh instance', () => {
    expect(typeof gh.cli).toBe('function');
  });
  // Missing: actual CLI command tests, error handling tests, etc.
});
```

**Recommendation:**
Add comprehensive tests:

```typescript
// src/utils.test.ts - Enhanced
describe('runCommand', () => {
  it('should execute a simple command successfully', () => {
    const result = runCommand(['echo', 'hello']);
    expect(result).toBe('hello');
  });

  it('should handle commands with multiple arguments', () => {
    const result = runCommand(['echo', 'hello', 'world']);
    expect(result).toBe('hello world');
  });

  it('should throw error on non-zero exit status', () => {
    expect(() => runCommand(['false'])).toThrow();
  });

  it('should handle commands with special characters', () => {
    const result = runCommand(['echo', 'hello world; echo danger']);
    expect(result).toBe('hello world; echo danger');
  });

  it('should handle commands with quotes', () => {
    const result = runCommand(['sh', '-c', 'echo "quoted text"']);
    expect(result).toBe('quoted text');
  });

  it('should respect timeout and throw error', () => {
    expect(() => runCommand(['sleep', '10'], { timeout: 100 })).toThrow();
  });

  it('should preserve environment variable expansion', () => {
    process.env.TEST_VALUE = 'expanded';
    const result = runCommand(['sh', '-c', 'echo $TEST_VALUE']);
    expect(result).toBe('expanded');
  });

  it('should handle empty input', () => {
    const result = runCommand(['cat'], { input: '' });
    expect(result).toBe('');
  });

  it('should handle binary data without error', () => {
    expect(() => runCommand(['echo', '-n', 'test'])).not.toThrow();
  });
});

// src/gh.test.ts - Enhanced with mocking
import { mock } from 'bun:test';

describe('GitHubClient', () => {
  beforeEach(() => {
    // Mock core.getInput to provide test token
    mock.module('@actions/core', () => ({
      getInput: () => 'test-token',
      info: () => {},
      debug: () => {},
    }));
  });

  it('should throw error when CLI command fails', () => {
    // Mock runCommand to throw
    const client = new GitHubClient();
    expect(() => client.getIssueData(999)).toThrow();
  });

  it('should handle JSON parsing errors gracefully', () => {
    // Test parseJSONOutput with invalid JSON
    // Implementation depends on testing strategy
  });
});
```

**Create test utilities:**

```typescript
// test-helpers.ts
import type { IssueNode, PRNode } from './types.js';

/**
 * Creates a mock issue for testing.
 */
export function createMockIssue(overrides?: Partial<IssueNode>): IssueNode {
  return {
    title: 'Test Issue',
    body: 'Test body',
    state: 'OPEN',
    author: { login: 'testuser' },
    createdAt: '2026-03-22T12:00:00Z',
    comments: [],
    ...overrides,
  };
}

/**
 * Creates a mock PR for testing.
 */
export function createMockPR(overrides?: Partial<PRNode>): PRNode {
  return {
    title: 'Test PR',
    body: 'Test PR body',
    state: 'OPEN',
    author: { login: 'prauthor' },
    baseRefName: 'main',
    headRefName: 'feature',
    createdAt: '2026-03-22T12:00:00Z',
    additions: 10,
    deletions: 5,
    baseRepository: { nameWithOwner: 'owner/repo' },
    headRepository: { nameWithOwner: 'owner/repo' },
    commits: { totalCount: 1 },
    ...overrides,
  };
}
```

---

## 8. Performance & Resource Management

### Issue: Inefficient File Operations
**File:** `src/pi.ts`

**Severity:** Low

Temp files are created synchronously with `fs.writeFileSync`, which can block the event loop.

**Current Code:**
```typescript
function safeRemoveFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    core.warning(`Failed to clean up temp file ${filePath}: ${errorMsg}`);
  }
}
```

**Recommendation:**
Use async file operations:

```typescript
async function safeRemoveFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    core.warning(`Failed to clean up temp file ${filePath}: ${errorMsg}`);
  }
}

// Update runPi to be async
export async function runPi(
  prompt: string,
  overrideProvider?: string,
  overrideModel?: string
): Promise<string> {
  // ... implementation using async file operations
}
```

**Note:** This is a minor optimization since the action is already async and file operations are not in a hot path. However, it's a good practice.

---

## 9. Maintainability

### Issue: Complex Branch Logic
**File:** `src/index.ts` (lines ~103-157)

**Severity:** Low

The `run` function has complex nested logic with multiple levels of try/catch/finally.

**Current Code:**
```typescript
async function run(): Promise<void> {
  const payload = github.context.payload;
  const { issueNumber, userPrompt, runUrl, commentId } = extractContext(payload);

  let reactionId: number | undefined;

  try {
    if (commentId !== undefined) {
      reactionId = await gh.addReaction(commentId, 'eyes');
    }

    const gitService = new GitService(GITHUB_TOKEN);

    const isPR = Boolean(payload.issue?.pull_request);

    if (isPR) {
      await handlePRWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
    } else {
      await handleIssueWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
    }
  } finally {
    if (reactionId !== undefined && commentId !== undefined) {
      await gh.removeReaction(commentId, reactionId).catch(err => {
        // ...
      });
    }
  }
}
```

**Recommendation:**
Use strategy pattern or extract the reaction management:

```typescript
// Option 1: Extract reaction management
async function withReaction<T>(
  commentId: number | undefined,
  callback: () => Promise<T>
): Promise<T> {
  if (commentId === undefined) {
    return await callback();
  }

  const reactionId = await gh.addReaction(commentId, 'eyes');
  try {
    return await callback();
  } finally {
    await gh.removeReaction(commentId, reactionId).catch(err => {
      core.debug(`Failed to remove reaction: ${err}`);
    });
  }
}

async function run(): Promise<void> {
  const payload = github.context.payload;
  const { issueNumber, userPrompt, runUrl, commentId } = extractContext(payload);

  return withReaction(commentId, async () => {
    const gitService = new GitService(GITHUB_TOKEN);
    const isPR = Boolean(payload.issue?.pull_request);

    if (isPR) {
      await handlePRWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
    } else {
      await handleIssueWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
    }
  });
}

// Option 2: Strategy pattern (if workflows grow more complex)
interface WorkflowStrategy {
  execute(gitService: GitService, issueNumber: number, userPrompt: string, runUrl: string, commentId: number | undefined): Promise<void>;
}

class PRWorkflowStrategy implements WorkflowStrategy {
  async execute(gitService: GitService, issueNumber: number, userPrompt: string, runUrl: string, commentId: number | undefined): Promise<void> {
    await handlePRWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
  }
}

class IssueWorkflowStrategy implements WorkflowStrategy {
  async execute(gitService: GitService, issueNumber: number, userPrompt: string, runUrl: string, commentId: number | undefined): Promise<void> {
    await handleIssueWorkflow(gitService, issueNumber, userPrompt, runUrl, commentId);
  }
}

async function run(): Promise<void> {
  const payload = github.context.payload;
  const { issueNumber, userPrompt, runUrl, commentId } = extractContext(payload);

  const strategy = payload.issue?.pull_request
    ? new PRWorkflowStrategy()
    : new IssueWorkflowStrategy();

  return withReaction(commentId, () => 
    strategy.execute(new GitService(GITHUB_TOKEN), issueNumber, userPrompt, runUrl, commentId)
  );
}
```

---

## Summary of Recommended Actions

### High Priority (Impact: High, Effort: Medium)
1. ✅ Extract `runPi` function into smaller, testable functions
2. ✅ Add comprehensive input validation to public APIs
3. ✅ Implement custom error types for better error handling
4. ✅ Split `GitHubClient` into CLI and API concerns

### Medium Priority (Impact: Medium, Effort: Low-Medium)
5. ✅ Remove duplicate URL building logic with utility class
6. ✅ Consolidate format functions with generic formatters
7. ✅ Move magic values (regex patterns, indentation) to constants
8. ✅ Add comprehensive JSDoc to public APIs

### Low Priority (Impact: Low, Effort: Low)
9. ⏳ Convert file operations to async (minor optimization)
10. ⏳ Implement strategy pattern for workflows (optional, if complexity grows)
11. ⏳ Add integration tests for complex workflows
12. ⏳ Refactor `GitService.commitAndPush` into smaller methods
13. ⏳ Remove or implement `GitService.configureCredentials`

---

## Testing Checklist

Before implementing changes, ensure:

- [ ] All existing tests pass
- [ ] New tests cover added functionality
- [ ] Edge cases are tested (empty inputs, invalid data, errors)
- [ ] External dependencies (GitHub CLI, git, Octokit) are properly mocked
- [ ] Tests are fast and reliable

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- Add input validation helpers
- Create custom error types
- Move magic values to constants

### Phase 2: Refactoring (Week 2)
- Extract `runPi` into smaller functions
- Create URL builder utility
- Split `GitHubClient` into CLI and API clients

### Phase 3: Testing (Week 3)
- Add comprehensive unit tests
- Create test utilities and mocks
- Add integration tests for workflows

### Phase 4: Documentation (Week 4)
- Add JSDoc to all public APIs
- Update README with architecture overview
- Create developer guide for contributing

---

## Additional Recommendations

1. **Add Linting Rules**: Consider adding ESLint rules to enforce some of these patterns automatically (e.g., requiring JSDoc on exports).

2. **Pre-commit Hooks**: Add Husky or similar to run tests and linting before commits.

3. **Code Coverage**: Set up coverage reporting and aim for >80% coverage.

4. **Dependency Updates**: Regularly update dependencies to benefit from security fixes and improvements.

5. **Type Strict Mode**: Consider enabling more strict TypeScript compiler options (exactOptionalPropertyTypes is already enabled, which is great).

6. **CI Improvements**: Add steps to validate TypeScript types, run tests, and check code coverage in CI.

---

## Conclusion

The codebase is generally well-written with good TypeScript practices. The recommendations in this document focus on:

- **Reducing technical debt** through refactoring large functions
- **Improving maintainability** by eliminating duplication and adding documentation
- **Enhancing reliability** through better error handling and validation
- **Increasing testability** by extracting concerns and adding comprehensive tests

Implementing these changes will result in a more robust, maintainable, and developer-friendly codebase.

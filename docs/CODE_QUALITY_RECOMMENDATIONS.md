# Code Quality Recommendations for `src/*`

This document provides recommendations for improving the code quality, maintainability, and robustness of the `src/` directory in the pi-coding-agent-action project.

## Executive Summary

The codebase is well-structured overall with good TypeScript practices, comprehensive error handling, and consistent coding style. However, there are several opportunities for improvement that would enhance code quality, maintainability, and robustness.

## Priority Recommendations

### 🔴 High Priority (Critical Issues)

#### 1. Fix Duplicate Variable Declaration in `prompts.ts`

**Location:** `src/prompts.ts`, function `buildIssuePrompt`

**Issue:** The variable `comments` is declared twice, which would cause a runtime error.

```typescript
// Current code (lines ~49-50)
const safeTitle = formatField(issue.title, '(no title)');
const safeBody = formatField(issue.body, '(no body)');
const comments = formatComments(issue.comments ?? [], commentId); // First declaration

const comments = formatComments(issue.comments ?? [], commentId, ISSUE_COMMENT_INDENT); // Second declaration - DUPLICATE!
```

**Recommendation:** Remove one of the duplicate declarations. Since the second one is more explicit with the indent parameter, remove the first one.

```typescript
const safeTitle = formatField(issue.title, '(no title)');
const safeBody = formatField(issue.body, '(no body)');
const comments = formatComments(issue.comments ?? [], commentId, ISSUE_COMMENT_INDENT);
```

**Impact:** This is a bug that prevents the code from running.

---

#### 2. Improve Error Handling in `index.ts` Workflow Functions

**Location:** `src/index.ts`, functions `handlePRWorkflow` and `handleIssueWorkflow`

**Issue:** The workflow functions have complex logic that could fail in multiple ways but only catch errors at the top level.

**Recommendation:** Add more granular error handling with specific error types and recovery strategies:

```typescript
async function handlePRWorkflow(...): Promise<void> {
  try {
    const pr = gh.getPRData(issueNumber);
    await gitService.configureCredentials();
    // ... rest of the code
  } catch (error) {
    if (isGitHubError(error)) {
      // Handle GitHub-specific errors (404, 403, etc.)
      await gh.createComment(
        issueNumber,
        `❌ GitHub API error: ${error.message}`
      );
    } else if (isGitError(error)) {
      // Handle git-specific errors
      if (error.isAuthenticationError()) {
        await gh.createComment(
          issueNumber,
          '❌ Git authentication failed. Please check token permissions.'
        );
      }
    }
    throw error;
  }
}
```

**Impact:** Better error messages for users, easier debugging.

---

### 🟡 Medium Priority (Code Health & Maintainability)

#### 3. Extract Complex Logic from `index.ts`

**Location:** `src/index.ts`, functions `handlePRWorkflow` and `handleIssueWorkflow`

**Issue:** Both functions are long (~60-70 lines) with multiple responsibilities:
- Getting PR/Issue data
- Building prompts
- Running Pi agent
- Checking git status
- Committing changes
- Creating branches
- Creating comments

**Recommendation:** Extract smaller, focused functions:

```typescript
async function executePiAgentAndCommit(
  prompt: string,
  gitService: GitService,
  branch: string,
  issueNumber: number
): Promise<{ response: string; committed: boolean }> {
  const response = runPi(prompt);
  const isDirty = await gitService.branchIsDirty();

  if (!isDirty) {
    return { response, committed: false };
  }

  const summary = summarize(response, issueNumber);
  await gitService.checkoutBranch(branch);
  await gitService.commitAndPush(summary, getAuthorInfo(), branch);
  
  return { response, committed: true };
}

async function handlePRWorkflow(
  gitService: GitService,
  issueNumber: number,
  userPrompt: string,
  runUrl: string,
  commentId: number | undefined
): Promise<void> {
  const pr = gh.getPRData(issueNumber);
  await gitService.configureCredentials();
  
  const fullPrompt = buildPRPrompt(pr, userPrompt, commentId);
  const newBranch = `pi-pr-${issueNumber}-${Date.now()}`;
  
  const { response, committed } = await executePiAgentAndCommit(
    fullPrompt,
    gitService,
    newBranch,
    issueNumber
  );

  await postWorkflowComment(
    issueNumber,
    response,
    runUrl,
    committed ? { type: 'pr_branch', branch: newBranch } : undefined
  );
}
```

**Impact:** Better testability, reusability, and readability.

---

#### 4. Improve Type Safety in `utils.ts`

**Location:** `src/utils.ts`, function `runCommand`

**Issue:** The function doesn't validate input parameters thoroughly.

**Recommendation:** Add runtime validation:

```typescript
export function runCommand(
  cmd: string[],
  options?: { input?: string; timeout?: number; stdio?: 'pipe' | 'inherit' },
  env?: NodeJS.ProcessEnv
): string {
  // Add validation
  if (!Array.isArray(cmd)) {
    throw new ValidationError('Command must be an array', 'cmd', cmd);
  }

  if (cmd.length === 0) {
    throw new ValidationError('Command cannot be empty', 'cmd', cmd);
  }

  if (typeof cmd[0] !== 'string' || cmd[0].trim() === '') {
    throw new ValidationError('Command name must be a non-empty string', 'cmd', cmd);
  }

  if (options?.timeout !== undefined && (options.timeout < 0 || !Number.isFinite(options.timeout))) {
    throw new ValidationError('Timeout must be a positive number', 'timeout', options.timeout);
  }

  // ... rest of the function
}
```

**Impact:** Early detection of configuration errors, better error messages.

---

#### 5. Add Input Validation to GitHub Client Methods

**Location:** `src/gh.ts`, class `GitHubClient`

**Issue:** Methods like `getIssueData`, `getPRData`, `createComment` don't validate inputs.

**Recommendation:** Add validation:

```typescript
getIssueData(issueNumber: number): IssueNode {
  validateIssueNumber(issueNumber);
  // ... rest of the method
}

getPRData(prNumber: number): PRNode {
  validateIssueNumber(prNumber);
  // ... rest of the method
}

async createComment(issueNumber: number, body: string): Promise<void> {
  validateIssueNumber(issueNumber);
  
  if (!body || body.trim().length === 0) {
    throw new ValidationError('Comment body cannot be empty', 'body', body);
  }

  // ... rest of the method
}
```

**Impact:** Prevents invalid API calls, provides better error messages.

---

#### 6. Extract URL Building Logic from `index.ts`

**Location:** `src/index.ts`, function `buildRunUrl` and inline URL building

**Issue:** URL building is duplicated across the codebase (also in `src/index.ts`).

**Recommendation:** Use the existing `GitHubUrlBuilder` from `src/url.ts` consistently:

```typescript
// In index.ts
import { githubUrlBuilder } from './url.js';

function buildRunUrl(): string {
  const runId = process.env.GITHUB_RUN_ID;
  if (!runId) {
    throw new Error('GITHUB_RUN_ID environment variable not found');
  }
  return githubUrlBuilder.run(runId);
}

// Update URL building to use the builder
const branchUrl = githubUrlBuilder.branch(newBranch);
const prUrl = githubUrlBuilder.pr(prNumber);
```

**Impact:** Consistency, reduced duplication, easier to maintain.

---

#### 7. Improve Test Coverage

**Location:** All test files

**Issue:** While tests exist, coverage could be improved for:
- Error scenarios
- Edge cases
- Integration scenarios
- Git operations
- GitHub API failures

**Recommendation:** Add more comprehensive tests:

```typescript
// Example: Add error case tests to git.test.ts
describe('GitService', () => {
  describe('branchIsDirty', () => {
    it('should handle authentication errors', async () => {
      // Test with invalid credentials
    });

    it('should handle repository not found', async () => {
      // Test with invalid repository path
    });

    it('should handle network timeouts', async () => {
      // Test with timeout scenarios
    });
  });

  describe('commitAndPush', () => {
    it('should handle merge conflicts', async () => {
      // Test conflict scenarios
    });

    it('should handle push failures', async () => {
      // Test push failures
    });
  });
});
```

**Impact:** Higher confidence in code changes, better regression prevention.

---

### 🟢 Low Priority (Nice to Have)

#### 8. Add Logging Levels and Structured Logging

**Location:** Throughout the codebase

**Issue:** Current logging uses `core.info`, `core.debug`, `core.warning` without structured format.

**Recommendation:** Implement a structured logging utility:

```typescript
// src/logger.ts
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp?: string;
}

export class Logger {
  private context: Record<string, unknown> = {};

  constructor(context?: Record<string, unknown>) {
    if (context) {
      this.context = context;
    }
  }

  info(message: string, additionalContext?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, additionalContext);
  }

  debug(message: string, additionalContext?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, additionalContext);
  }

  warn(message: string, additionalContext?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, additionalContext);
  }

  error(message: string, error?: Error, additionalContext?: Record<string, unknown>): void {
    const context = {
      ...additionalContext,
      error: error?.message,
      stack: error?.stack,
    };
    this.log(LogLevel.ERROR, message, context);
  }

  private log(level: LogLevel, message: string, additionalContext?: Record<string, unknown>): void {
    const entry: LogEntry = {
      level,
      message,
      context: { ...this.context, ...additionalContext },
      timestamp: new Date().toISOString(),
    };

    switch (level) {
      case LogLevel.DEBUG:
        core.debug(JSON.stringify(entry));
        break;
      case LogLevel.INFO:
        core.info(`${message} ${Object.keys(entry.context || {}).length > 0 ? JSON.stringify(entry.context) : ''}`);
        break;
      case LogLevel.WARN:
        core.warning(`${message} ${Object.keys(entry.context || {}).length > 0 ? JSON.stringify(entry.context) : ''}`);
        break;
      case LogLevel.ERROR:
        core.error(`${message} ${Object.keys(entry.context || {}).length > 0 ? JSON.stringify(entry.context) : ''}`);
        break;
    }
  }
}
```

**Impact:** Better debugging, structured logs for analysis.

---

#### 9. Extract Magic Strings to Constants

**Location:** Multiple files

**Issue:** Several magic strings are used directly in code:
- Branch name patterns (`pi-pr-`, `pi/issue`)
- Error messages
- Comment prefixes

**Recommendation:** Extract to constants:

```typescript
// Add to src/constants.ts
export const PR_BRANCH_PREFIX = 'pi-pr-';
export const ISSUE_BRANCH_PREFIX = 'pi/issue';
export const DEFAULT_PR_INSTRUCTIONS = 'Review this PR and suggest improvements.';
export const DEFAULT_ISSUE_INSTRUCTIONS = 'Summarize this issue and suggest next steps.';

export const ErrorMessages = {
  GITHUB_PAYLOAD_MISSING: 'GitHub payload is missing issue data',
  INVALID_REPOSITORY_CONTEXT: (owner: string, repo: string) =>
    `Invalid repository context: owner="${owner}", repo="${repo}". Cannot construct push URL.`,
  COMMAND_EMPTY: 'Command cannot be empty',
  // ... etc
} as const;
```

**Impact:** Consistency, easier to update, better maintainability.

---

#### 10. Add Type Guards for Runtime Type Checking

**Location:** `src/types.ts` or new file `src/guards.ts`

**Issue:** While TypeScript provides compile-time safety, runtime data from APIs needs validation.

**Recommendation:** Add runtime type guards:

```typescript
// src/guards.ts
export function isIssueComment(value: unknown): value is IssueComment {
  if (!value || typeof value !== 'object') return false;
  
  const comment = value as Record<string, unknown>;
  
  return (
    typeof comment.databaseId === 'number' &&
    typeof comment.body === 'string' &&
    typeof comment.author === 'object' &&
    typeof (comment.author as Record<string, unknown>).login === 'string' &&
    typeof comment.createdAt === 'string'
  );
}

export function isIssueNode(value: unknown): value is IssueNode {
  if (!value || typeof value !== 'object') return false;
  
  const issue = value as Record<string, unknown>;
  
  return (
    typeof issue.title === 'string' &&
    typeof issue.body === 'string' &&
    typeof issue.state === 'string' &&
    typeof issue.author === 'object' &&
    typeof (issue.author as Record<string, unknown>).login === 'string' &&
    typeof issue.createdAt === 'string' &&
    (issue.comments === undefined || Array.isArray(issue.comments))
  );
}
```

**Impact:** Runtime safety, better error handling for external API responses.

---

#### 11. Add Retry Logic for Network Operations

**Location:** `src/gh.ts`, `src/git.ts`

**Issue:** Network operations don't have retry logic, making them susceptible to transient failures.

**Recommendation:** Add retry utility:

```typescript
// src/retry.ts
export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: (error: Error) => boolean;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    retryableErrors = (error: Error) => 
      error.message.includes('timeout') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ETIMEDOUT'),
  } = options;

  let lastError: Error | undefined;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxAttempts || !retryableErrors(lastError)) {
        throw lastError;
      }

      core.warning(
        `Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. Retrying in ${currentDelay}ms...`
      );

      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError;
}

// Usage in gh.ts
async createComment(issueNumber: number, body: string): Promise<void> {
  return retry(async () => {
    const octokit = this.getOctokit();
    const { owner, repo } = this.getRepoContext();

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
  });
}
```

**Impact:** More resilient to transient network failures.

---

#### 12. Add Performance Monitoring

**Location:** Performance-critical operations throughout the codebase

**Issue:** No visibility into operation durations or performance bottlenecks.

**Recommendation:** Add timing utilities:

```typescript
// src/performance.ts
export class PerformanceTimer {
  private readonly name: string;
  private startTime: bigint;
  private endTime?: bigint;

  constructor(name: string) {
    this.name = name;
    this.startTime = process.hrtime.bigint();
  }

  end(): number {
    this.endTime = process.hrtime.bigint();
    const durationNs = Number(this.endTime - this.startTime);
    const durationMs = durationNs / 1_000_000;
    
    core.info(`${this.name} completed in ${durationMs.toFixed(2)}ms`);
    
    return durationMs;
  }

  static async measure<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<{ result: T; duration: number }> {
    const timer = new PerformanceTimer(name);
    try {
      const result = await fn();
      const duration = timer.end();
      return { result, duration };
    } catch (error) {
      timer.end();
      throw error;
    }
  }
}

// Usage
const { result: prData, duration } = await PerformanceTimer.measure(
  'getPRData',
  () => gh.getPRData(issueNumber)
);
```

**Impact:** Better performance insights, easier optimization.

---

## Code Style & Formatting Recommendations

### 13. Enforce Consistent Import Ordering

**Current State:** Imports are inconsistent across files.

**Recommendation:** Configure ESLint to enforce a consistent import order:

```javascript
// In eslint.config.mjs, add:
'import/order': [
  'error',
  {
    groups: [
      'builtin',
      'external',
      'internal',
      ['parent', 'sibling'],
      'index',
      'object',
      'type',
    ],
    'newlines-between': 'always',
    alphabetize: {
      order: 'asc',
      caseInsensitive: true,
    },
  },
],
```

---

### 14. Add Comments for Complex Business Logic

**Location:** Several files have complex logic without explanatory comments.

**Recommendation:** Add inline comments explaining the "why" not just the "what":

```typescript
// In git.ts, commitAndPush method
// Stage all modified/added/deleted files
// Note: We iterate through statusMatrix rather than using 'git add .' to have
// explicit control over which files are staged and to handle deleted files correctly.
// statusMatrix returns: [filepath, head, workdir, stage]
// - workdir = 2 means file is deleted in working directory
// - workdir = 1 or 3 means file is added or modified
for (const row of statusMatrix) {
  const [filepath, , workdir] = row;

  if (workdir === 2) {
    // File deleted - remove from index
    await isoGit.remove({
      fs,
      dir: this.dir,
      filepath,
    });
  } else {
    // File added or modified - add to index
    await isoGit.add({
      fs,
      dir: this.dir,
      filepath,
    });
  }
}
```

---

## Architecture & Design Recommendations

### 15. Implement Dependency Injection for Better Testability

**Location:** Throughout the codebase, especially in `index.ts`

**Issue:** Direct dependencies on singletons (`gh`, `GitHubUrlBuilder`) make testing harder.

**Recommendation:** Pass dependencies as parameters:

```typescript
// Instead of:
async function handlePRWorkflow(
  gitService: GitService,
  issueNumber: number,
  // ...
): Promise<void> {
  const pr = gh.getPRData(issueNumber); // Hard dependency
  // ...
}

// Use:
async function handlePRWorkflow(
  gitService: GitService,
  githubClient: GitHubClient,
  issueNumber: number,
  // ...
): Promise<void> {
  const pr = githubClient.getPRData(issueNumber); // Injected dependency
  // ...
}

// In production:
await handlePRWorkflow(gitService, gh, issueNumber, userPrompt, runUrl, commentId);

// In tests:
await handlePRWorkflow(gitService, mockGitHubClient, issueNumber, userPrompt, runUrl, commentId);
```

**Impact:** Better testability, more flexible architecture.

---

### 16. Consider Using a Result Type for Error Handling

**Location:** Throughout the codebase

**Issue:** Error handling relies on try/catch and throwing errors.

**Recommendation:** Consider using a Result/Either pattern for better error handling:

```typescript
// src/result.ts
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

export function success<T>(value: T): Result<T> {
  return { success: true, value };
}

export function failure<E>(error: E): Result<never, E> {
  return { success: false, error };
}

export async function tryAsync<T, E = Error>(
  fn: () => Promise<T>
): Promise<Result<T, E>> {
  try {
    return success(await fn());
  } catch (error) {
    return failure(error as E);
  }
}

// Usage
const prResult = await tryAsync(() => gh.getPRData(issueNumber));
if (!prResult.success) {
  await gh.createComment(issueNumber, `Failed to get PR data: ${prResult.error.message}`);
  return;
}
const pr = prResult.value;
```

**Impact:** More explicit error handling, better type safety.

---

## Security Recommendations

### 17. Add Sanitization for User-Provided Content

**Location:** `src/prompts.ts`, `src/utils.ts`

**Issue:** User prompts are passed directly to the AI agent without sanitization.

**Recommendation:** Add content sanitization:

```typescript
// In src/prompts.ts
import { validateUserPrompt } from './validation.js';

export function buildIssuePrompt(
  issue: IssueNode,
  userPrompt: string | null,
  commentId: number | undefined
): string {
  // Validate user input
  if (userPrompt) {
    validateUserPrompt(userPrompt);
  }

  // ... rest of the function
}
```

---

### 18. Add Rate Limiting for API Calls

**Location:** `src/gh.ts`

**Issue:** No rate limiting for GitHub API calls could lead to hitting rate limits.

**Recommendation:** Implement a simple rate limiter:

```typescript
// src/ratelimit.ts
export class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests: number, windowMs: number) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(timestamp => now - timestamp < this.windowMs);
    
    // Check if we've hit the limit
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = oldestRequest + this.windowMs - now;
      core.warning(`Rate limit hit. Waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire();
    }
    
    this.requests.push(now);
  }
}

// Usage in GitHubClient
private readonly rateLimiter = new RateLimiter(30, 60000); // 30 requests per minute

async createComment(issueNumber: number, body: string): Promise<void> {
  await this.rateLimiter.acquire();
  // ... rest of the method
}
```

---

## Documentation Recommendations

### 19. Add JSDoc Comments to All Public APIs

**Location:** Throughout the codebase

**Issue:** Some public functions lack comprehensive JSDoc comments.

**Recommendation:** Ensure all public exports have complete JSDoc:

```typescript
/**
 * Executes the pi agent with the given prompt and configuration.
 * 
 * This is the main interface for running the pi AI coding agent.
 * The agent is executed as a subprocess with the provided configuration.
 * 
 * @param prompt - The prompt text to send to the pi agent
 * @param overrideProvider - Optional provider override (e.g., 'anthropic', 'openai')
 * @param overrideModel - Optional model override (e.g., 'claude-sonnet-4-5', 'gpt-4')
 * @returns The response text from the pi agent
 * @throws {Error} If the pi agent exits with a non-zero status code
 * @throws {Error} If the timeout is exceeded
 * 
 * @example
 * ```typescript
 * const response = runPi('Fix the bug in auth.ts');
 * console.log(response);
 * ```
 * 
 * @remarks
 * The function writes the prompt to a temporary file to avoid shell escaping issues.
 * The temporary file is cleaned up automatically, even if an error occurs.
 */
export function runPi(
  prompt: string,
  overrideProvider?: string,
  overrideModel?: string
): string {
  // ... implementation
}
```

---

### 20. Add Architecture Documentation

**Location:** Create new file `docs/ARCHITECTURE.md`

**Recommendation:** Document the overall architecture:

```markdown
# Architecture Overview

## High-Level Flow

```
User Comment → GitHub Webhook → index.ts
                                      ↓
                              ┌─────────────────┐
                              │ Extract Context │
                              └─────────────────┘
                                      ↓
                              ┌─────────────────┐
                              │ Build Prompt    │
                              └─────────────────┘
                                      ↓
                              ┌─────────────────┐
                              │ Run Pi Agent    │
                              └─────────────────┘
                                      ↓
                              ┌─────────────────┐
                              │ Check Git Status│
                              └─────────────────┘
                                      ↓
                              ┌─────────────────┐
                              │ Commit & Push   │
                              └─────────────────┘
                                      ↓
                              ┌─────────────────┐
                              │ Create PR/Comment│
                              └─────────────────┘
```

## Module Responsibilities

- **index.ts**: Main workflow orchestration
- **gh.ts**: GitHub API interactions
- **git.ts**: Git operations
- **pi.ts**: Pi agent execution
- **prompts.ts**: Prompt building
- **types.ts**: Type definitions
- **utils.ts**: Utility functions
- **validation.ts**: Input validation
- **errors.ts**: Error handling
- **url.ts**: URL building
- **constants.ts**: Configuration constants

## Data Flow

[Detailed description of how data flows through the system]
```

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Week 1)
- [ ] Fix duplicate variable declaration in `prompts.ts`
- [ ] Add input validation to GitHub client methods
- [ ] Extract URL building to use `GitHubUrlBuilder`

### Phase 2: Code Health (Week 2-3)
- [ ] Extract complex logic from `index.ts`
- [ ] Improve error handling in workflow functions
- [ ] Add test coverage for error scenarios

### Phase 3: Robustness (Week 4)
- [ ] Add retry logic for network operations
- [ ] Add rate limiting for GitHub API
- [ ] Add performance monitoring

### Phase 4: Polish (Week 5+)
- [ ] Add structured logging
- [ ] Add JSDoc to all public APIs
- [ ] Add architecture documentation
- [ ] Consider Result type pattern
- [ ] Implement dependency injection

---

## Testing Strategy

### Unit Tests
- Aim for >80% code coverage
- Test all error paths
- Test edge cases and boundary conditions

### Integration Tests
- Test workflows end-to-end
- Test with real GitHub API (mocked or staging environment)
- Test git operations with real repositories

### Property-Based Tests
Consider using a library like `fast-check` for:
- Validation functions
- URL building
- Branch name generation

---

## Metrics to Track

1. **Code Coverage**: Target >80%
2. **Test Pass Rate**: Should be 100% in CI
3. **TypeScript Strict Mode Compliance**: All files should compile with no errors
4. **Lint Rule Violations**: Zero in CI
5. **Function Cyclomatic Complexity**: Target <10 per function
6. **Function Length**: Target <50 lines per function
7. **File Length**: Target <500 lines per file

---

## Conclusion

This codebase has a solid foundation with good TypeScript practices and a clear separation of concerns. The recommendations above focus on:

1. **Fixing critical bugs** (duplicate declaration)
2. **Improving robustness** (error handling, validation, retries)
3. **Enhancing maintainability** (function extraction, documentation)
4. **Increasing testability** (dependency injection, test coverage)

Implementing these recommendations incrementally will significantly improve the code quality while minimizing disruption to existing functionality.

# Code Quality Improvement Recommendations

This document provides comprehensive recommendations for improving the code quality of the `src/*` directory in the pi-coding-agent-action project. Recommendations are prioritized by severity and impact.

## Table of Contents

1. [Critical Issues](#critical-issues)
2. [Error Handling Improvements](#error-handling-improvements)
3. [Validation Consistency](#validation-consistency)
4. [Security Enhancements](#security-enhancements)
5. [Code Duplication](#code-duplication)
6. [Type Safety Improvements](#type-safety-improvements)
7. [Testing Recommendations](#testing-recommendations)
8. [Documentation Improvements](#documentation-improvements)
9. [Performance Optimizations](#performance-optimizations)
10. [Code Organization](#code-organization)

---

## Critical Issues

### 1. **Duplicate Variable Declaration in `src/prompts.ts`** 🔴 CRITICAL

**Location:** `src/prompts.ts`, lines 48-49

```typescript
// Line 48
const comments = formatComments(issue.comments ?? [], commentId);

// Line 49
const comments = formatComments(issue.comments ?? [], commentId, ISSUE_COMMENT_INDENT);
```

**Issue:** Two declarations of `comments` with different signatures will cause a compilation error or overwrite the first value.

**Fix:**
```typescript
const comments = formatComments(issue.comments ?? [], commentId, ISSUE_COMMENT_INDENT);
```

**Priority:** Must fix immediately - code won't compile.

---

### 2. **Inconsistent Use of Custom Error Classes**

**Location:** `src/index.ts`, line 49

```typescript
throw new Error('GitHub payload is missing issue data');
```

**Issue:** The codebase defines custom error classes (`GitHubError`, `ValidationError`, `GitError`, `PiAgentError`) but throws generic `Error` objects.

**Impact:** Makes error handling less precise and harder to catch specific error types.

**Fix:**
```typescript
throw new ValidationError('GitHub payload is missing issue data', 'payload', payload);
```

**Priority:** High - affects error handling throughout the codebase.

---

### 3. **Missing Input Validation in Core Functions**

**Location:** Multiple files

**Issues:**
- `src/index.ts`: No validation for `issueNumber`, `userPrompt` after extraction
- `src/gh.ts`: No validation for issue/PR numbers before API calls
- `src/git.ts`: No validation for branch names, commit messages
- `src/utils.ts`: No validation for branch names in `generateBranchName()`

**Fix Example:**
```typescript
// In src/index.ts
import { validateIssueNumber, validateUserPrompt } from './validation.js';

function extractContext(payload: GitHubPayload) {
  if (!payload.issue) {
    throw new ValidationError('GitHub payload is missing issue data', 'payload', payload);
  }

  const issueNumber = payload.issue.number;
  validateIssueNumber(issueNumber);

  const commentBody = payload.comment?.body ?? '';
  const commentId = payload.comment?.id ?? undefined;

  const userPrompt = extractUserPrompt(commentBody) ?? '';
  if (userPrompt) {
    validateUserPrompt(userPrompt);
  }

  // ... rest of function
}
```

**Priority:** High - security and correctness implications.

---

## Error Handling Improvements

### 4. **Enhance Error Context in `src/gh.ts`**

**Location:** `src/gh.ts`, line 61

**Current:**
```typescript
throw new Error(`GitHub CLI command failed: ${commandStr}\n${message}`);
```

**Improvement:**
```typescript
const error = new GitHubError(
  `GitHub CLI command failed: ${commandStr}`,
  undefined,
  command[0], // operation type (issue, pr, etc.)
  error instanceof Error ? error : new Error(String(error))
);
throw error;
```

**Priority:** Medium - improves debugging and error recovery.

---

### 5. **Add Error Recovery in Git Operations**

**Location:** `src/git.ts`, `commitAndPush` method

**Current:** No retry logic for transient network failures.

**Improvement:**
```typescript
async commitAndPush(summary: string, author: GitAuthor, branch: string, retries = 3): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // ... existing commit logic ...

      await isoGit.push({
        fs,
        http,
        dir: this.dir,
        url: authUrl,
        ref: `refs/heads/${branch}`,
        onAuth: () => ({ username: 'oauth2', password: this.token }),
        onProgress: progress => {
          if (progress.phase) {
            core.debug(`Git push: ${progress.phase} ${progress.loaded || 0}/${progress.total || 0}`);
          }
        },
      });

      core.info('Push complete');
      return;
    } catch (error) {
      const gitError = new GitError('Push operation failed', 'push', error);
      
      if (attempt < retries && gitError.isNetworkError()) {
        core.warning(`Push attempt ${attempt} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      throw gitError;
    }
  }
}
```

**Priority:** Medium - improves resilience.

---

### 6. **Consistent Error Logging Pattern**

**Location:** Multiple files

**Issue:** Mix of `core.error`, `core.warning`, and `core.info` for errors.

**Recommendation:** Create a centralized logging utility:

```typescript
// src/logging.ts
import * as core from '@actions/core';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
}

export function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  const fullMessage = `[${level.toUpperCase()}] ${message}${contextStr}`;
  
  switch (level) {
    case LogLevel.DEBUG:
      core.debug(fullMessage);
      break;
    case LogLevel.INFO:
      core.info(fullMessage);
      break;
    case LogLevel.WARNING:
      core.warning(fullMessage);
      break;
    case LogLevel.ERROR:
      core.error(fullMessage);
      break;
  }
}

export function logError(error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  log(LogLevel.ERROR, message, { ...context, error: error instanceof Error ? error.stack : undefined });
}
```

**Priority:** Low - improves consistency and debugging.

---

## Validation Consistency

### 7. **Consolidate Validation Usage**

**Location:** `src/utils.ts` and `src/validation.ts`

**Issue:** Validation logic exists in `validation.ts` but not consistently used across the codebase.

**Recommendations:**

1. **Add validation to `generateBranchName`:**
```typescript
// src/utils.ts
import { validateBranchName } from './validation.js';

export function generateBranchName(type: string, issueNumber: number): string {
  const now = Temporal.Now.plainDateTimeISO();
  const timestamp = `${now.year}${String(now.month).padStart(2, '0')}${String(now.day).padStart(2, '0')}${String(now.hour).padStart(2, '0')}${String(now.minute).padStart(2, '0')}${String(now.second).padStart(2, '0')}`;
  const branch = `${PI_BRANCH_PREFIX}/${type}${issueNumber}-${timestamp}`;
  
  // Validate the generated branch name
  validateBranchName(branch);
  
  return branch;
}
```

2. **Add validation to Git operations:**
```typescript
// src/git.ts
import { validateBranchName, validateCommitMessage } from './validation.js';

async checkoutBranch(branch: string): Promise<void> {
  validateBranchName(branch);
  // ... rest of method
}

async commitAndPush(summary: string, author: GitAuthor, branch: string): Promise<void> {
  validateCommitMessage(summary);
  // ... rest of method
}
```

3. **Add validation to GitHub operations:**
```typescript
// src/gh.ts
import { validateIssueNumber } from './validation.js';

getIssueData(issueNumber: number): IssueNode {
  validateIssueNumber(issueNumber);
  // ... rest of method
}

getPRData(prNumber: number): PRNode {
  validateIssueNumber(prNumber); // Issue number validation applies to PRs too
  // ... rest of method
}
```

**Priority:** High - security and correctness.

---

### 8. **Add Email Validation in `src/index.ts`**

**Location:** `src/index.ts`, lines 67-68, 108

**Current:**
```typescript
email: `${ACTOR}@users.noreply.github.com`,
```

**Issue:** No validation that the email format is valid.

**Fix:**
```typescript
import { validateEmail } from './validation.js';

// When creating the email
const email = `${ACTOR}@users.noreply.github.com`;
validateEmail(email);
```

**Priority:** Medium - improves robustness.

---

## Security Enhancements

### 9. **Sanitize Temporary File Paths**

**Location:** `src/pi.ts`, lines 29, 40

**Issue:** Using predictable names for temporary files could lead to race conditions or file tampering.

**Current:**
```typescript
const promptFile = path.join(os.tmpdir(), PROMPT_TEMP_FILE);
```

**Improvement:**
```typescript
import crypto from 'node:crypto';

const promptFile = path.join(os.tmpdir(), `${PROMPT_TEMP_FILE}_${crypto.randomUUID()}`);
```

**Priority:** Medium - security improvement.

---

### 10. **Validate Command Arguments**

**Location:** `src/utils.ts`, `runCommand` function

**Issue:** No validation that command arguments don't contain injection attempts.

**Improvement:**
```typescript
import { validateSafePath } from './validation.js';

export function runCommand(
  cmd: string[],
  options?: { input?: string; timeout?: number; stdio?: 'pipe' | 'inherit' },
  env?: NodeJS.ProcessEnv
): string {
  if (cmd.length === 0 || !cmd[0]) {
    throw new ValidationError('Command cannot be empty', 'cmd', cmd);
  }

  // Validate the command is not attempting path traversal
  for (const arg of cmd.slice(1)) {
    if (typeof arg === 'string' && (arg.includes('..') || arg.includes('\0'))) {
      throw new ValidationError(
        'Command argument contains potentially dangerous characters',
        'cmd',
        cmd
      );
    }
  }

  // ... rest of function
}
```

**Priority:** High - security.

---

### 11. **Secure Environment Variable Handling**

**Location:** `src/pi.ts`, lines 42-46

**Current:**
```typescript
for (const { key, value } of envVars) {
  core.info(`Setting env var: ${key}=***`);
  env[key] = value;
}
```

**Issue:** Values could contain sensitive data that should be sanitized.

**Improvement:**
```typescript
import { validateEnvVarKey, sanitizeEnvVarValue } from './validation.js';

for (const envVar of envVars) {
  validateEnvVarKey(envVar.key);
  const sanitizedValue = sanitizeEnvVarValue(envVar.key, envVar.value);
  core.info(`Setting env var: ${envVar.key}=***`);
  env[envVar.key] = sanitizedValue;
}
```

**Priority:** Medium - security.

---

## Code Duplication

### 12. **Eliminate URL Building Duplication**

**Location:** `src/index.ts` and `src/url.ts`

**Issue:** URL building logic is duplicated between manual string concatenation in `index.ts` and the `GitHubUrlBuilder` class.

**Current in `index.ts`:**
```typescript
const serverUrl = github.context.serverUrl || 'https://github.com';
const owner = github.context.repo.owner || 'unknown';
const repo = github.context.repo.repo || 'unknown';
const runId = process.env.GITHUB_RUN_ID ?? 'unknown';
return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
```

**Fix:**
```typescript
import { buildRunUrl } from './url.js';

function buildRunUrl(): string {
  return buildRunUrl() ?? 'https://github.com/unknown/unknown/actions/runs/unknown';
}
```

**Priority:** Medium - code maintainability.

---

### 13. **Consolidate Error Message Formatting**

**Location:** Multiple files

**Issue:** Error message patterns are repeated throughout the codebase.

**Recommendation:** Create error message templates:

```typescript
// src/error-messages.ts
export const ErrorMessages = {
  GITHUB_PAYLOAD_MISSING: 'GitHub payload is missing issue data',
  GITHUB_REQUEST_FAILED: (operation: string, status: number) => 
    `GitHub request failed for operation '${operation}' (status ${status})`,
  GIT_OPERATION_FAILED: (operation: string) => 
    `Git operation '${operation}' failed`,
  PI_AGENT_FAILED: (exitCode?: number) => 
    `Pi Agent exited with code ${exitCode ?? 'unknown'}`,
  VALIDATION_FAILED: (field: string, value: unknown, reason: string) =>
    `Invalid value for field '${field}': ${reason}`,
} as const;
```

**Priority:** Low - code maintainability.

---

### 14. **Merge Duplicate Validation Logic**

**Location:** `src/utils.ts` (lines 114-126) and `src/validation.ts` (lines 229-244)

**Issue:** Environment variable validation logic is duplicated.

**Fix:** Remove duplicate from `utils.ts` and use only the version in `validation.ts`.

**Priority:** Low - code maintainability.

---

## Type Safety Improvements

### 15. **Add Explicit Return Types**

**Location:** Multiple functions across all files

**Issue:** Many functions lack explicit return type annotations, relying on type inference.

**Example Fix:**
```typescript
// Before
function extractUserPrompt(body: string): string | null {
  // ...
}

// After - explicit return type
function extractUserPrompt(body: string): string | null {
  // ...
}

// Add to complex functions
export async function handlePRWorkflow(
  gitService: GitService,
  issueNumber: number,
  userPrompt: string,
  runUrl: string,
  commentId: number | undefined
): Promise<void> {
  // ...
}
```

**Priority:** Medium - type safety and IDE support.

---

### 16. **Add Strict Type Checks**

**Location:** `src/gh.ts`, line 52

**Current:**
```typescript
output: string, dataType: string, number: number
```

**Improvement:**
```typescript
type DataType = 'issue' | 'pr' | 'comment' | 'review';

private parseJSONOutput<T>(output: string, dataType: DataType, identifier: number | string): T {
  try {
    return JSON.parse(output) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse ${dataType} data for #${identifier}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
```

**Priority:** Low - type safety.

---

### 17. **Improve Type Guards Usage**

**Location:** `src/types.ts`

**Issue:** Type guards exist in `errors.ts` but aren't consistently used for narrowing types.

**Recommendation:** Add type guards for common types:

```typescript
// src/types.ts
export function isIssueNode(value: unknown): value is IssueNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    'body' in value &&
    'state' in value &&
    'author' in value
  );
}

export function isPRNode(value: unknown): value is PRNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'title' in value &&
    'body' in value &&
    'state' in value &&
    'baseRefName' in value &&
    'headRefName' in value &&
    'files' in value
  );
}

export function isGitAuthor(value: unknown): value is GitAuthor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'email' in value &&
    typeof value.name === 'string' &&
    typeof value.email === 'string'
  );
}
```

**Priority:** Medium - type safety.

---

### 18. **Use Exact Optional Properties**

**Location:** Multiple interface definitions

**Current:** Some interfaces use optional properties loosely.

**Recommendation:** With `exactOptionalPropertyTypes: true` in tsconfig.json, ensure:

```typescript
// Good
interface IssueComment {
  databaseId: number;
  body: string;
  author: { login: string };
  createdAt: string;
}

// Avoid ambiguous optional types
interface IssueNode {
  title: string;
  body: string;
  state: string;
  author: { login: string };
  createdAt: string;
  comments?: IssueComment[]; // undefined vs [] should be explicit
}
```

**Priority:** Low - type precision.

---

## Testing Recommendations

### 19. **Add Integration Tests**

**Location:** New test files needed

**Issue:** Current tests are unit tests only. Missing integration tests for:
- End-to-end workflow (issue → branch → commit → push → PR)
- Git operations with real repositories
- GitHub API interactions

**Recommendation:** Create `src/index.integration.test.ts`:

```typescript
// src/index.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { GitService } from './git.js';
import { gh } from './gh.js';
import { generateBranchName } from './utils.js';

describe('Issue Workflow Integration', () => {
  let gitService: GitService;
  const testBranch = generateBranchName('issue', 999);

  beforeAll(() => {
    gitService = new GitService('test-token');
  });

  afterAll(async () => {
    // Cleanup: delete test branch
    // await gitService.deleteBranch(testBranch);
  });

  it('should create branch, commit, and push', async () => {
    await gitService.checkoutBranch(testBranch);
    // Create test file
    // await gitService.commitAndPush(...);
    expect(await gitService.branchIsDirty()).toBe(false);
  });
});
```

**Priority:** Medium - test coverage.

---

### 20. **Add Error Path Testing**

**Location:** All test files

**Issue:** Tests focus on happy paths; error scenarios are under-tested.

**Recommendation:** Add tests for:
- Invalid GitHub tokens
- Network timeouts
- Merge conflicts
- Invalid branch names
- Invalid issue numbers

**Example:**
```typescript
describe('GitHub Client Error Handling', () => {
  it('should throw GitHubError for 404', async () => {
    await expect(gh.getIssueData(999999999)).toThrow();
  });

  it('should throw ValidationError for negative issue numbers', () => {
    expect(() => validateIssueNumber(-1)).toThrow(ValidationError);
  });
});
```

**Priority:** Medium - reliability.

---

### 21. **Add Property-Based Testing**

**Location:** Test files for validation functions

**Issue:** Tests use specific values rather than property-based testing.

**Recommendation:** Use property-based testing for validation functions:

```typescript
// src/validation.property.test.ts
import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import { validateBranchName } from './validation.js';

describe('Branch Name Validation - Property Based', () => {
  it('should accept valid branch names', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/),
        (branchName) => {
          expect(() => validateBranchName(branchName)).not.toThrow();
        }
      ),
      { numRuns: 1000 }
    );
  });

  it('should reject branch names with spaces', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => s.includes(' ')),
        (branchName) => {
          expect(() => validateBranchName(branchName)).toThrow(ValidationError);
        }
      )
    );
  });
});
```

**Priority:** Low - advanced testing.

---

## Documentation Improvements

### 22. **Add JSDoc Examples**

**Location:** All public APIs

**Issue:** Some functions lack usage examples in JSDoc.

**Example:**
```typescript
/**
 * Extracts the user prompt from a comment body by removing the mention prefix.
 * 
 * @param body - The comment body text
 * @returns The extracted prompt, or null if body is empty
 * 
 * @example
 * ```typescript
 * const prompt = extractUserPrompt('/pi fix the bug');
 * // Returns: 'fix the bug'
 * 
 * const prompt2 = extractUserPrompt('just a comment');
 * // Returns: 'just a comment'
 * ```
 */
export function extractUserPrompt(body: string): string | null {
  // ...
}
```

**Priority:** Low - documentation.

---

### 23. **Add Architecture Documentation**

**Location:** New file `docs/architecture.md`

**Issue:** No documentation explaining the overall architecture and data flow.

**Recommendation:** Create architecture documentation:

```markdown
# Architecture

## Data Flow

1. **Trigger**: Issue or PR comment containing `/pi`
2. **Context Extraction**: Parse GitHub payload, extract issue/PR data
3. **Prompt Building**: Format issue/PR data into a prompt for the AI agent
4. **AI Execution**: Run pi agent with the prompt
5. **Code Changes**: Parse AI response and apply code changes
6. **Git Operations**: Stage, commit, and push changes
7. **PR Creation**: Create PR for issues, comment for PRs

## Component Responsibilities

- `index.ts`: Main workflow orchestration
- `gh.ts`: GitHub API interactions
- `git.ts`: Git operations using isomorphic-git
- `pi.ts`: Pi agent execution
- `prompts.ts`: Prompt building for AI context
- `validation.ts`: Input validation and sanitization
- `utils.ts`: Shared utility functions
- `url.ts`: GitHub URL building
- `errors.ts`: Custom error classes
- `types.ts`: TypeScript type definitions
```

**Priority:** Low - documentation.

---

### 24. **Add Changelog Maintenance**

**Location:** `CHANGELOG.md`

**Issue:** No changelog file exists.

**Recommendation:** Create a changelog following [Keep a Changelog](https://keepachangelog.com/) format:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- - 

### Changed
- - 

### Fixed
- - 

## [1.0.3] - 2024-XX-XX

### Added
- Initial version
```

**Priority:** Low - documentation.

---

## Performance Optimizations

### 25. **Optimize Git Status Checks**

**Location:** `src/git.ts`, `branchIsDirty` method

**Current:** Checks all files every time.

**Improvement:** Add caching for short-lived operations:

```typescript
export class GitService {
  private readonly dir: string;
  private readonly token: string;
  private _statusCache: { timestamp: number; isDirty: boolean } | undefined;
  private readonly CACHE_TTL_MS = 1000; // 1 second cache

  async branchIsDirty(): Promise<boolean> {
    const now = Date.now();
    
    // Return cached result if fresh
    if (
      this._statusCache &&
      (now - this._statusCache.timestamp) < this.CACHE_TTL_MS
    ) {
      return this._statusCache.isDirty;
    }

    const statusMatrix = await isoGit.statusMatrix({
      fs,
      dir: this.dir,
    });

    const isDirty = statusMatrix.some(
      row => row[1] !== row[2] || row[2] !== row[3]
    );

    this._statusCache = { timestamp: now, isDirty };
    return isDirty;
  }
}
```

**Priority:** Low - optimization.

---

### 26. **Reduce Repeated GitHub API Calls**

**Location:** `src/index.ts`

**Issue:** Could potentially call GitHub API multiple times for the same data.

**Recommendation:** Add memoization:

```typescript
// src/gh.ts
export class GitHubClient {
  private readonly token: string;
  private octokitInstance: ReturnType<typeof github.getOctokit> | undefined;
  private readonly cache = new Map<string, { data: unknown; timestamp: number }>();
  private readonly CACHE_TTL_MS = 5000; // 5 second cache

  private async withCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
      return cached.data as T;
    }

    const data = await fn();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  getIssueData(issueNumber: number): IssueNode {
    return this.withCache(`issue:${issueNumber}`, () => {
      const output = this.cli(['issue', 'view', `${issueNumber}`, '--json', 'title,body,state,author,createdAt,comments']);
      return this.parseJSONOutput<IssueNode>(output, 'issue', issueNumber);
    });
  }
}
```

**Priority:** Low - optimization.

---

### 27. **Optimize File Staging in Git**

**Location:** `src/git.ts`, `commitAndPush` method

**Current:** Iterates through all files sequentially.

**Improvement:** Batch operations where possible:

```typescript
async commitAndPush(summary: string, author: GitAuthor, branch: string): Promise<void> {
  // ... validation ...

  const statusMatrix = await isoGit.statusMatrix({
    fs,
    dir: this.dir,
  });

  // Separate into batches for efficiency
  const toAdd: string[] = [];
  const toRemove: string[] = [];

  for (const row of statusMatrix) {
    const [filepath, , workdir] = row;
    if (workdir === 2) {
      toRemove.push(filepath);
    } else {
      toAdd.push(filepath);
    }
  }

  // Batch operations
  for (const filepath of toRemove) {
    await isoGit.remove({ fs, dir: this.dir, filepath });
  }

  for (const filepath of toAdd) {
    await isoGit.add({ fs, dir: this.dir, filepath });
  }

  // ... rest of commit logic ...
}
```

**Priority:** Low - optimization.

---

## Code Organization

### 28. **Separate Concerns in `src/index.ts`**

**Location:** `src/index.ts`

**Issue:** The main file is large (230+ lines) and mixes concerns.

**Recommendation:** Split into focused modules:

```
src/
├── workflows/
│   ├── index.ts          # Main entry point
│   ├── issue-workflow.ts # Issue-specific workflow
│   ├── pr-workflow.ts    # PR-specific workflow
│   └── error-handler.ts  # Centralized error handling
├── services/             # Current service files (gh.ts, git.ts)
├── utils/                # Current utility files
└── ... (rest of files)
```

**Priority:** Medium - maintainability.

---

### 29. **Create Configuration Module**

**Location:** New file `src/config.ts`

**Issue:** Configuration is scattered across multiple files (`core.getInput()` calls).

**Recommendation:** Centralize configuration:

```typescript
// src/config.ts
import * as core from '@actions/core';
import {
  DEFAULT_PI_PROVIDER,
  DEFAULT_PI_MODEL,
  DEFAULT_GITHUB_BRANCH,
} from './constants.js';

export interface ActionConfig {
  githubToken: string;
  provider: string;
  model: string;
  extraTools: string;
  customSystemPrompt: string;
  envVars: Record<string, string>;
  defaultBranch: string;
}

export function loadConfig(): ActionConfig {
  const githubToken = core.getInput('github_token');
  
  if (!githubToken) {
    throw new ValidationError('GITHUB_TOKEN is required', 'github_token', undefined);
  }

  return {
    githubToken,
    provider: core.getInput('provider') ?? DEFAULT_PI_PROVIDER,
    model: core.getInput('model') ?? DEFAULT_PI_MODEL,
    extraTools: core.getInput('extra_tools') ?? '',
    customSystemPrompt: core.getInput('prompt') ?? '',
    envVars: Object.fromEntries(
      parseEnvVars(core.getInput('env_vars') ?? '').map(ev => [ev.key, ev.value])
    ),
    defaultBranch: github.context.payload.repository?.default_branch ?? DEFAULT_GITHUB_BRANCH,
  };
}

// Singleton instance
export const config = loadConfig();
```

**Priority:** Medium - maintainability.

---

### 30. **Implement Dependency Injection**

**Location:** Service classes (`GitHubClient`, `GitService`)

**Issue:** Services are tightly coupled to singleton patterns and environment.

**Recommendation:** Allow dependency injection for better testability:

```typescript
// src/gh.ts
export interface GitHubClientConfig {
  token: string;
  octokit?: ReturnType<typeof github.getOctokit>;
  logger?: (message: string) => void;
}

export class GitHubClient {
  private readonly token: string;
  private octokitInstance: ReturnType<typeof github.getOctokit> | undefined;
  private readonly logger: (message: string) => void;

  constructor(config: GitHubClientConfig) {
    this.token = config.token;
    this.octokitInstance = config.octokit;
    this.logger = config.logger ?? ((msg) => core.info(msg));
  }

  // ... rest of class with singleton pattern still available
}

// Maintain backward compatibility
export function createGitHubClient(): GitHubClient {
  return new GitHubClient({
    token: core.getInput('github_token'),
  });
}
```

**Priority:** Low - testability.

---

## Additional Recommendations

### 31. **Add Logging Levels**

Implement a proper logging system with configurable levels (debug, info, warning, error) to help with troubleshooting in production.

### 32. **Add Metrics Collection**

Consider adding metrics for:
- API call counts and latencies
- Git operation durations
- Error rates by type

### 33. **Implement Circuit Breaker**

For GitHub API calls, implement a circuit breaker pattern to handle outages gracefully.

### 34. **Add Request Retry Logic**

For transient network failures, add exponential backoff retry logic to all external API calls.

### 35. **Improve Error Messages**

Make error messages more actionable by including:
- What went wrong
- Why it went wrong
- How to fix it

---

## Priority Summary

| Priority | Issues | Impact |
|----------|--------|--------|
| Critical | 1 | Compilation error |
| High | 2, 3, 7, 10 | Security, correctness |
| Medium | 4, 5, 8, 11, 12, 15, 17, 19, 20, 28, 29 | Robustness, maintainability |
| Low | 6, 13, 14, 16, 18, 21, 22, 23, 24, 25, 26, 27, 30, 31, 32, 33, 34, 35 | Polish, optimization |

---

## Implementation Roadmap

### Phase 1: Critical Fixes (Immediate)
- [ ] Fix duplicate variable declaration in `src/prompts.ts`
- [ ] Replace generic errors with custom error classes

### Phase 2: High Priority (1 week)
- [ ] Add comprehensive input validation
- [ ] Consolidate validation usage
- [ ] Implement security enhancements

### Phase 3: Medium Priority (2-3 weeks)
- [ ] Improve error handling and recovery
- [ ] Add integration tests
- [ ] Refactor code organization
- [ ] Centralize configuration

### Phase 4: Low Priority (Ongoing)
- [ ] Enhance documentation
- [ ] Add performance optimizations
- [ ] Implement advanced testing strategies

---

## Contributing

When addressing these recommendations:

1. **Create a separate branch** for each major change
2. **Write tests** for any new functionality
3. **Update documentation** for API changes
4. **Run the full test suite** before submitting
5. **Follow existing code style** (use `bun run lint` and `bun run format`)

---

## Additional Resources

- [TypeScript Best Practices](https://github.com/typescript-cheatsheets/react-typescript-cheatsheet)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [isomorphic-git Documentation](https://isomorphic-git.org/)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)

---

**Last Updated:** 2025-03-26
**Maintainer:** Development Team
**Review Cycle:** Quarterly

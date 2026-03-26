# Code Quality Recommendations for `src/` Directory

This document outlines comprehensive recommendations for improving the code quality of the `src/` directory, organized by priority and category.

## 🔴 High Priority

### 1. Missing Test Coverage for `index.ts`

**Issue**: The main entry point (`src/index.ts`) has no corresponding test file, leaving critical workflow logic untested.

**Recommendations**:
- Create `src/index.test.ts` with comprehensive tests for:
  - `extractContext()` function
  - `handlePRWorkflow()` function (mocking GitService and gh)
  - `handleIssueWorkflow()` function (mocking GitService and gh)
  - `handleError()` function
  - Main `run()` function workflow
- Test error scenarios and edge cases
- Test the reaction management (add/remove eyes)

**Impact**: Critical - This is the main entry point and contains complex workflow logic that should be tested.

---

### 2. Type Safety: Move Local Types to `types.ts`

**Issue**: Interface definitions in `src/index.ts` are defined locally when they should be centralized.

**Current Code** (`src/index.ts`):
```typescript
interface IssueCommentPayload {
  id: number;
  body?: string;
}

interface PullRequestReference {
  number: number;
  html_url: string;
}

interface IssueWithPR {
  number: number;
  pull_request?: PullRequestReference;
}

interface GitHubPayload {
  issue?: IssueWithPR;
  comment?: IssueCommentPayload | undefined;
}
```

**Recommendation**: Move these interfaces to `src/types.ts` for better organization and reusability:

```typescript
// src/types.ts
export interface IssueCommentPayload {
  id: number;
  body?: string;
}

export interface PullRequestReference {
  number: number;
  html_url: string;
}

export interface IssueWithPR {
  number: number;
  pull_request?: PullRequestReference;
}

export interface GitHubPayload {
  issue?: IssueWithPR;
  comment?: IssueCommentPayload | undefined;
}
```

**Impact**: High - Improves code organization, reusability, and maintainability.

---

### 3. Error Handling Improvements in `git.ts`

**Issue**: The `configureCredentials()` method catches errors broadly and may silently fail without proper feedback.

**Current Code** (`src/git.ts`):
```typescript
async configureCredentials(): Promise<void> {
  try {
    const repo = github.context?.repo;
    if (repo) {
      const { owner, repo: repoName } = repo;
      core.debug(`Git context validated for ${owner}/${repoName}`);
    } else {
      core.debug('Git context validation skipped (no github context)');
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (!errorMsg.includes('context') && !errorMsg.includes('undefined')) {
      throw error;
    }
    core.debug(`Git context validation skipped: ${errorMsg}`);
  }
  // Credentials are provided via onAuth callback during push operations
}
```

**Recommendation**: Make the error handling more specific and provide better feedback:

```typescript
async configureCredentials(): Promise<void> {
  // Check if GitHub context is available (may not be in test environments)
  if (!github.context?.repo) {
    core.debug('Git context validation skipped (no github context)');
    return;
  }

  try {
    const { owner, repo: repoName } = github.context.repo;
    core.debug(`Git context validated for ${owner}/${repoName}`);
  } catch (error) {
    // Only silence errors related to missing context - rethrow others
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('context') || errorMsg.includes('undefined')) {
      core.debug(`Git context validation skipped: ${errorMsg}`);
      return;
    }
    throw new Error(`Failed to validate git context: ${errorMsg}`);
  }
  // Credentials are provided via onAuth callback during push operations
}
```

**Impact**: High - Improves error visibility and debugging.

---

### 4. Add Input Validation in `runPi()`

**Issue**: The `runPi()` function in `src/pi.ts` doesn't validate that required inputs are present.

**Current Code** (`src/pi.ts`):
```typescript
export function runPi(prompt: string, overrideProvider?: string, overrideModel?: string): string {
  const provider = overrideProvider ?? core.getInput('provider') ?? DEFAULT_PI_PROVIDER;
  const model = overrideModel ?? core.getInput('model') ?? DEFAULT_PI_MODEL;
  // ... rest of function
}
```

**Recommendation**: Add validation at the start:

```typescript
export function runPi(prompt: string, overrideProvider?: string, overrideModel?: string): string {
  // Validate inputs
  if (!prompt || prompt.trim().length === 0) {
    throw new Error('Prompt cannot be empty');
  }

  const provider = overrideProvider ?? core.getInput('provider') ?? DEFAULT_PI_PROVIDER;
  const model = overrideModel ?? core.getInput('model') ?? DEFAULT_PI_MODEL;

  if (!provider || provider.trim().length === 0) {
    throw new Error('Provider must be specified');
  }

  if (!model || model.trim().length === 0) {
    throw new Error('Model must be specified');
  }

  // ... rest of function
}
```

**Impact**: High - Prevents runtime errors from invalid inputs.

---

## 🟡 Medium Priority

### 5. Refactor Duplicated Code in `index.ts`

**Issue**: `handlePRWorkflow()` and `handleIssueWorkflow()` share significant duplicated logic.

**Recommendation**: Extract common logic into a helper function:

```typescript
async function executeWorkflow(
  gitService: GitService,
  issueNumber: number,
  userPrompt: string,
  runUrl: string,
  commentId: number | undefined,
  promptBuilder: (data: unknown, prompt: string, commentId: number | undefined) => string,
  getData: (number: number) => unknown
): Promise<void> {
  // Configure git credentials before running pi so it can detect push permissions
  await gitService.configureCredentials();

  const data = getData(issueNumber);
  const fullPrompt = promptBuilder(data, userPrompt, commentId);
  const response = runPi(fullPrompt);

  // Return data for further processing
  return { response, gitService };
}
```

**Impact**: Medium - Improves code maintainability and reduces duplication.

---

### 6. Move `INSTRUCTIONS_MESSAGE` to `constants.ts`

**Issue**: The `INSTRUCTIONS_MESSAGE` constant in `src/prompts.ts` should be in `src/constants.ts`.

**Current Code** (`src/prompts.ts`):
```typescript
const INSTRUCTIONS_MESSAGE =
  'IMPORTANT: Provide your response as a single, complete message. Do not include interim progress updates, status messages, or step-by-step commentary. Your response will be used directly as a comment and PR description.';
```

**Recommendation**: Move to `src/constants.ts`:
```typescript
export const INSTRUCTIONS_MESSAGE =
  'IMPORTANT: Provide your response as a single, complete message. Do not include interim progress updates, status messages, or step-by-step commentary. Your response will be used directly as a comment and PR description.';
```

**Impact**: Medium - Improves code organization and maintainability.

---

### 7. Improve Type Safety in `gh.ts`

**Issue**: The `parseJSONOutput()` method uses a generic but the error message is non-type-safe.

**Current Code** (`src/gh.ts`):
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

**Recommendation**: Add validation that the parsed object matches expected structure:

```typescript
private parseJSONOutput<T extends Record<string, unknown>>(
  output: string,
  dataType: string,
  number: number,
  requiredFields: (keyof T)[]
): T {
  try {
    const parsed = JSON.parse(output) as T;

    // Validate required fields exist
    for (const field of requiredFields) {
      if (!(field in parsed)) {
        throw new Error(`Missing required field '${String(field)}' in ${dataType} data`);
      }
    }

    return parsed;
  } catch (e) {
    if (e instanceof Error && e.message.includes('Missing required field')) {
      throw e;
    }
    throw new Error(
      `Failed to parse ${dataType} data for #${number}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
```

**Usage**:
```typescript
getIssueData(issueNumber: number): IssueNode {
  const output = this.cli([
    'issue',
    'view',
    `${issueNumber}`,
    '--json',
    'title,body,state,author,createdAt,comments',
  ]);
  return this.parseJSONOutput<IssueNode>(
    output,
    'issue',
    issueNumber,
    ['title', 'body', 'state', 'author', 'createdAt']
  );
}
```

**Impact**: Medium - Improves type safety and error messages.

---

### 8. Add JSDoc Comments to Public APIs

**Issue**: Several public functions lack comprehensive JSDoc documentation.

**Recommendation**: Add detailed JSDoc comments to all exported functions, especially in:
- `src/index.ts` - All exported functions
- `src/pi.ts` - `runPi()` and `summarize()`
- `src/gh.ts` - All `GitHubClient` methods
- `src/git.ts` - All `GitService` methods

**Example**:
```typescript
/**
 * Runs the pi agent with the given prompt and returns the response.
 *
 * @param prompt - The prompt to send to the pi agent
 * @param overrideProvider - Optional provider override (e.g., 'anthropic', 'openai')
 * @param overrideModel - Optional model override (e.g., 'claude-3-opus-20240229')
 * @returns The response text from the pi agent
 * @throws {Error} If the prompt is empty or the pi agent exits with non-zero status
 * @throws {Error} If provider or model is not specified and no default is available
 *
 * @example
 * ```typescript
 * const response = runPi('What is 2 + 2?', 'anthropic', 'claude-3-opus-20240229');
 * console.log(response); // "4"
 * ```
 */
export function runPi(
  prompt: string,
  overrideProvider?: string,
  overrideModel?: string
): string {
  // ...
}
```

**Impact**: Medium - Improves code documentation and IDE support.

---

### 9. Improve Error Messages in `utils.ts`

**Issue**: Error messages in `runCommand()` could be more descriptive.

**Current Code** (`src/utils.ts`):
```typescript
if (result.status !== 0) {
  const stderr = result.stderr || '';
  const stdout = result.stdout || '';
  throw new Error(
    `Command failed: ${cmd.join(' ')}\n\nExit code: ${result.status}\n\nStdout:\n${stdout}\n\nStderr:\n${stderr}`
  );
}
```

**Recommendation**: Add more context and truncate long output:

```typescript
if (result.status !== 0) {
  const stderr = result.stderr || '';
  const stdout = result.stdout || '';

  // Truncate very long output to avoid error message bloat
  const MAX_OUTPUT_LENGTH = 1000;
  const truncatedStderr = stderr.length > MAX_OUTPUT_LENGTH
    ? stderr.slice(0, MAX_OUTPUT_LENGTH) + '\n... (truncated)'
    : stderr;
  const truncatedStdout = stdout.length > MAX_OUTPUT_LENGTH
    ? stdout.slice(0, MAX_OUTPUT_LENGTH) + '\n... (truncated)'
    : stdout;

  throw new Error(
    `Command failed with exit code ${result.status}: ${cmd.join(' ')}\n\n` +
    `Stdout:\n${truncatedStdout}\n\n` +
    `Stderr:\n${truncatedStderr}`
  );
}
```

**Impact**: Medium - Improves debugging experience.

---

## 🟢 Low Priority

### 10. Add Logging to Async Operations

**Issue**: Some async operations in `index.ts` lack proper logging, making debugging difficult.

**Recommendation**: Add `core.info()` or `core.debug()` logging at key points:
- Before and after long-running operations
- When branching/committing/pushing
- When creating comments/PRs

**Example**:
```typescript
async function handlePRWorkflow(
  gitService: GitService,
  issueNumber: number,
  userPrompt: string,
  runUrl: string,
  commentId: number | undefined
): Promise<void> {
  core.info(`Starting PR workflow for #${issueNumber}`);
  const pr = gh.getPRData(issueNumber);

  await gitService.configureCredentials();
  core.debug('Git credentials configured');

  const fullPrompt = buildPRPrompt(pr, userPrompt, commentId);
  core.debug('Prompt built, running pi agent');
  const response = runPi(fullPrompt);
  core.info('Pi agent completed');

  if (await gitService.branchIsDirty()) {
    core.info('Changes detected, preparing to commit');
    // ... rest of function
  }
}
```

**Impact**: Low - Improves debugging and observability.

---

### 11. Extract Magic Strings to Constants

**Issue**: Some magic strings are hardcoded in the code.

**Current Code** (`src/index.ts`):
```typescript
const newBranch = `pi-pr-${issueNumber}-${Date.now()}`;
// ...
const branchUrl = `${serverUrl}/${owner}/${repo}/tree/${newBranch}`;
```

**Recommendation**: Extract to constants in `constants.ts`:
```typescript
// src/constants.ts
export const PR_BRANCH_PREFIX = 'pi-pr-';
export const ISSUE_BRANCH_PREFIX = 'pi-issue-';
export const BRANCH_URL_TEMPLATE = '{serverUrl}/{owner}/{repo}/tree/{branch}';
```

**Impact**: Low - Improves maintainability and consistency.

---

### 12. Improve `summarize()` Function Robustness

**Issue**: The `summarize()` function uses simple heuristics that may not handle all edge cases well.

**Current Code** (`src/pi.ts`):
```typescript
export function summarize(text: string, issueNumber: number): string {
  const lines = text.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  // Use first line if it's short enough and not generic
  if (firstLine.length > 0 && firstLine.length <= 50 && !GENERIC_PREFIX_PATTERN.test(firstLine)) {
    return firstLine;
  }

  // For longer or generic first lines, use the first sentence or phrase
  const sentences = text.split(/[.!?\n]/);
  const firstSentence = (sentences[0] ?? '')
    .trim()
    .replace(GENERIC_PREFIX_PATTERN, '')
    .substring(0, 50)
    .trim();

  return firstSentence.length > 5 ? firstSentence : `Fix issue #${issueNumber}`;
}
```

**Recommendation**: Add more robust handling:
```typescript
export function summarize(text: string, issueNumber: number): string {
  if (!text || text.trim().length === 0) {
    return `Fix issue #${issueNumber}`;
  }

  const lines = text.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  // Use first line if it's short enough and not generic
  if (
    firstLine.length > 0 &&
    firstLine.length <= 50 &&
    !GENERIC_PREFIX_PATTERN.test(firstLine) &&
    !firstLine.startsWith('```')  // Avoid code block markers
  ) {
    return firstLine;
  }

  // Try to extract a meaningful sentence
  const sentences = text.split(/[.!?]\s+/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (
      trimmed.length > 5 &&
      trimmed.length <= 50 &&
      !GENERIC_PREFIX_PATTERN.test(trimmed) &&
      !trimmed.includes('```')
    ) {
      return trimmed;
    }
  }

  // Try first non-empty line under 50 chars
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length > 5 &&
      trimmed.length <= 50 &&
      !GENERIC_PREFIX_PATTERN.test(trimmed)
    ) {
      return trimmed;
    }
  }

  return `Fix issue #${issueNumber}`;
}
```

**Impact**: Low - Improves commit message quality.

---

### 13. Add Defensive Programming for Optional Properties

**Issue**: Some code doesn't handle optional properties safely.

**Current Code** (`src/prompts.ts`):
```typescript
const comments = formatComments(issue.comments ?? [], commentId);
```

**Recommendation**: Use nullish coalescing and optional chaining consistently:

```typescript
const comments = formatComments(issue?.comments ?? [], commentId);
const safeTitle = issue?.title?.trim() ?? '(no title)';
const safeBody = issue?.body?.trim() ?? '(no body)';
```

**Impact**: Low - Improves robustness and reduces potential runtime errors.

---

### 14. Consider Using `zod` for Runtime Validation

**Issue**: Data from external sources (GitHub CLI, GitHub API) is not validated at runtime.

**Recommendation**: Add `zod` for schema validation:

```typescript
// src/types.ts
import { z } from 'zod';

export const IssueCommentSchema = z.object({
  databaseId: z.number(),
  body: z.string(),
  author: z.object({
    login: z.string(),
  }),
  createdAt: z.string(),
});

export const IssueNodeSchema = z.object({
  title: z.string(),
  body: z.string(),
  state: z.string(),
  author: z.object({
    login: z.string(),
  }),
  createdAt: z.string(),
  comments: z.array(IssueCommentSchema).optional(),
});

// Type can be derived from schema
export type IssueNode = z.infer<typeof IssueNodeSchema>;
```

**Usage in `gh.ts`**:
```typescript
getIssueData(issueNumber: number): IssueNode {
  const output = this.cli([...]);
  const parsed = JSON.parse(output);
  return IssueNodeSchema.parse(parsed); // Throws if invalid
}
```

**Impact**: Low - Adds dependency but significantly improves type safety.

---

### 15. Add Unit Tests for Edge Cases

**Issue**: Test coverage exists but many tests only check basic functionality or types.

**Recommendation**: Add comprehensive edge case tests for:
- Empty/null inputs
- Very long strings
- Special characters in inputs
- Malformed JSON parsing
- Network failures (mocked)
- Invalid git states

**Impact**: Low - Improves test coverage and reliability.

---

### 16. Performance: Optimize File Operations

**Issue**: File operations in `pi.ts` write entire files to memory.

**Current Code** (`src/pi.ts`):
```typescript
const promptFile = path.join(os.tmpdir(), PROMPT_TEMP_FILE);
fs.writeFileSync(promptFile, prompt, 'utf8');
```

**Recommendation**: For very large prompts, consider streaming or chunking:

```typescript
// For small prompts (current case), current approach is fine
// For future scalability, consider:
async function writePromptFile(prompt: string, filePath: string): Promise<void> {
  const CHUNK_SIZE = 64 * 1024; // 64KB chunks
  const buffer = Buffer.from(prompt, 'utf8');
  
  for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
    const chunk = buffer.slice(i, i + CHUNK_SIZE);
    if (i === 0) {
      fs.writeFileSync(filePath, chunk);
    } else {
      fs.appendFileSync(filePath, chunk);
    }
  }
}
```

**Impact**: Low - Future-proofing for larger prompts.

---

## 🔒 Security Considerations

### 17. Command Injection Prevention

**Issue**: The `runCommand()` function could be vulnerable if user input is passed directly.

**Current Code** (`src/utils.ts`):
```typescript
export function runCommand(
  cmd: string[],
  options?: { input?: string; timeout?: number; stdio?: 'pipe' | 'inherit' },
  env?: NodeJS.ProcessEnv
): string {
  if (cmd.length === 0 || !cmd[0]) {
    throw new Error('Command cannot be empty');
  }
  // ...
}
```

**Recommendation**: Add validation for command arguments:

```typescript
/**
 * Validates that a command argument is safe to execute.
 * Only allows alphanumeric characters, hyphens, underscores, slashes, and dots.
 */
function validateCommandArg(arg: string): void {
  // Allow alphanumeric, hyphens, underscores, slashes, dots, colons, at-signs, plus signs
  const safePattern = /^[a-zA-Z0-9_\-./:@+=]+$/;
  if (!safePattern.test(arg)) {
    throw new Error(`Invalid command argument: ${arg}`);
  }
}

export function runCommand(
  cmd: string[],
  options?: { input?: string; timeout?: number; stdio?: 'pipe' | 'inherit' },
  env?: NodeJS.ProcessEnv
): string {
  if (cmd.length === 0 || !cmd[0]) {
    throw new Error('Command cannot be empty');
  }

  // Validate command arguments (skip validation for the command name itself)
  for (const arg of cmd.slice(1)) {
    // Skip validation for file paths and values that legitimately contain special chars
    // Add specific exceptions for known safe patterns
    if (arg.startsWith('/') || arg.startsWith('-') || arg.startsWith('--')) {
      continue;
    }
    validateCommandArg(arg);
  }

  // ... rest of function
}
```

**Impact**: Security - Prevents potential command injection vulnerabilities.

---

### 18. Token Logging Prevention

**Issue**: Ensure tokens are never logged accidentally.

**Recommendation**: Add a helper function to redact sensitive data:

```typescript
// src/utils.ts
/**
 * Redacts sensitive data like tokens from strings for safe logging.
 */
export function redactSensitive(input: string): string {
  // Redact GitHub tokens (typically 40 characters, alphanumeric)
  return input.replace(/ghp_[a-zA-Z0-9]{36}/g, '***REDACTED***')
             .replace(/github_pat_[a-zA-Z0-9_]{82}/g, '***REDACTED***');
}

// Usage in logging
core.info(redactSensitive(`Using token: ${token}`));
```

**Impact**: Security - Prevents accidental token exposure in logs.

---

## 📊 Summary by Category

| Category | High Priority | Medium Priority | Low Priority |
|----------|---------------|-----------------|-------------|
| Testing | 1 | 15 | - |
| Type Safety | 2 | 7 | - |
| Error Handling | 3, 4 | 9 | - |
| Code Organization | - | 5, 6, 11 | - |
| Documentation | - | 8 | - |
| Logging | - | - | 10 |
| Robustness | - | - | 12, 13 |
| Security | 17, 18 | - | - |
| Performance | - | - | 16 |

## 🎯 Recommended Implementation Order

1. **Phase 1** (Critical): Address High Priority items 1-4
2. **Phase 2** (Important): Address Medium Priority items 5-9
3. **Phase 3** (Refinement): Address Low Priority items 10-16
4. **Phase 4** (Security): Address Security items 17-18

---

## 📝 Notes

- These recommendations are based on static analysis of the codebase
- Some recommendations may require discussion before implementation
- Impact levels are subjective and should be validated by the team
- Consider creating separate PRs for each phase to facilitate review

# Testing Guide

This document describes the testing setup for the pi-coding-agent-action project.

## Running Tests

The project uses [Bun's built-in test runner](https://bun.sh/docs/test).

### Run all tests
```bash
bun test
```

### Run tests with coverage
```bash
bun test --coverage
```

### Run tests in watch mode
```bash
bun test --watch
```

### Run specific test files
```bash
bun test src/constants.test.ts
bun test src/utils.test.ts src/prompts.test.ts
```

## Test Structure

Tests are located alongside the source files they test:

- `src/constants.test.ts` - Tests for constant values
- `src/utils.test.ts` - Tests for utility functions
- `src/prompts.test.ts` - Tests for prompt building functions
- `src/types.test.ts` - Tests for TypeScript type definitions
- `src/pi.test.ts` - Tests for pi agent execution
- `src/gh.test.ts` - Tests for GitHub API operations
- `src/git.test.ts` - Tests for git operations
- `src/index.test.ts` - Integration tests for the main entry point

## Test Coverage

### constants.test.ts
- `DEFAULT_FETCH_DEPTH` validation
- `PI_TIMEOUT_MS` validation

### utils.test.ts
- `runCommand()` - Shell command execution with options and environment variables
- `getMentions()` - Parsing mention configuration
- `assertKeyword()` - Validating trigger keywords in comments
- `extractUserPrompt()` - Extracting user prompts from comments
- `generateBranchName()` - Generating unique branch names
- `parseEnvVars()` - Parsing environment variable strings

### prompts.test.ts
- `buildIssuePrompt()` - Building prompts for issue-related requests
- `buildPRPrompt()` - Building prompts for PR-related requests

### types.test.ts
- `IssueComment` type validation
- `IssueNode` type validation
- `PRNode` type validation
- `GitAuthor` type validation
- `BranchCheckoutOptions` type validation
- Type compatibility checks

### pi.test.ts
- `runPi()` - Running pi agent with various configurations
- `summarize()` - Summarizing text for git commit messages

### gh.test.ts
- `gh()` - GitHub CLI wrapper function
- `getIssueData()` - Fetching issue data
- `getPRData()` - Fetching PR data
- `createComment()` - Creating comments via Octokit
- `addReaction()` - Adding reactions to comments
- `createPR()` - Creating pull requests

### git.test.ts
- `GitService` class methods
- Branch operations (checkout, fetch)
- Status operations (dirty check, current branch)
- Commit and push operations
- URL handling for authentication

### index.test.ts
- `run()` function - Main workflow entry point
- Context extraction from GitHub payloads
- Error handling
- Workflow branching (issue vs PR)
- GitHub context and inputs

## Test Stats

As of the latest update:
- Total test files: 8
- Total tests: 77 (for modules that don't require external dependencies)
- Test framework: Bun test

## Notes on External Dependencies

Some test files (`utils.test.ts`, `pi.test.ts`, `gh.test.ts`, `git.test.ts`, `index.test.ts`) require mocking of external dependencies:
- GitHub Actions Core SDK (`@actions/core`)
- GitHub Actions Octokit (`@actions/github`)
- Git CLI commands
- GitHub CLI (`gh`)
- Pi agent CLI

These tests are structured to work with proper mocking, but may require additional setup for full execution in all environments.

## Pre-commit Hooks

The project uses [Lefthook](https://github.com/evilmartians/lefthook) for pre-commit hooks. Tests are automatically run before commits along with linting and type checking.

To skip hooks (not recommended):
```bash
git commit --no-verify
```

## Adding New Tests

1. Create a test file next to the source file: `src/yourfile.test.ts`
2. Import test utilities and the code to test:
   ```typescript
   import { describe, it, expect } from 'bun:test';
   import { yourFunction } from './yourfile.js';
   ```
3. Write test cases:
   ```typescript
   describe('yourFunction', () => {
     it('should do something', () => {
       expect(yourFunction()).toBe('expected');
     });
   });
   ```
4. Run the tests to verify they pass

## Best Practices

- Test pure functions first (they're easiest to test)
- Group related tests in `describe()` blocks
- Use descriptive test names
- Test both success and error cases
- Test edge cases and boundary conditions
- Keep tests independent and fast
- Use mocks for external dependencies

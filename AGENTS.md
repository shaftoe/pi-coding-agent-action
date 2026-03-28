# AGENTS.md

## Project Overview

This is a GitHub Action that integrates the [Pi coding agent](https://pi.dev) with GitHub workflows. Users can invoke the agent by commenting `/pi` in issues or pull requests to get AI assistance with code analysis, fixes, and reviews.

**Key Features:**

- Issue assistance: Analyze issues and create fixes
- PR assistance: Review and improve pull requests
- Automated commits: Make changes, commit them, and create PRs
- Flexible LLM support: Works with various providers (Anthropic, OpenAI, Google, etc.)

## Codebase Structure

- `src/` - TypeScript source code
  - `run.ts` - Main entry point for the action
  - `pi/` - Pi client library and tool definitions
    - `index.ts` - Main entry point (exports Client and extFactory)
    - `client.ts` - Pi client wrapper class
    - `resource-loader.ts` - Resource loader configuration
    - `context-visualizer.ts` - Context and tool execution logging via SDK events
    - `prompt.ts` - Central place for all prompt management (system prompt, tool prompts)
    - `tools/` - Custom tool implementations
      - `index.ts` - Tool registration factory (extFactory)
      - `common.ts` - Shared utilities (formatThreadAsText for thread formatting)
      - `create-pr.ts` - create_pull_request tool definition
      - `get-thread.ts` - get_issue_or_pr_thread tool definition
      - `update-pr.ts` - update_pull_request tool definition
    - `tools.test.ts` - Tests for tool definitions
    - `prompt.test.ts` - Tests for prompt.ts
  - `github/` - GitHub API interactions and context enrichment
  - `github.test.ts`, `run.test.ts` - Test files
- `.github/workflows/` - Workflow definitions

## Important Notes for Agents

1. **Validation**: Before considering any task complete, always run:
   ```bash
   bun run validate
   ```
   This runs: Prettier formatting, ESLint, TypeScript type checking, tests, and build.

2. **Extension Pattern**: The action extends Pi with custom tools (`create_pull_request`, `update_pull_request`, `get_issue_or_pr_thread`) via the `ExtensionAPI` in `src/pi/tools/index.ts`.

3. **Centralized Logging**: Tool execution logging is centralized in `src/pi/context-visualizer.ts` using SDK events (`tool_execution_start`, `tool_execution_end`). Tools check `signal?.aborted` directly and return `details.cancelled: true` for cancellations.

4. **Test Coverage**: The project uses `bun test` for testing. Maintain and expand test coverage when making changes.

5. **Prefer Bun package manager over npm or others**

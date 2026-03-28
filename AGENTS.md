# AGENTS.md

## Project Overview

This is a GitHub Action that integrates the [Pi coding agent](https://pi.dev) with GitHub workflows. Users can invoke the agent by commenting `/pi` in issues or pull requests to get AI assistance with code analysis, fixes, and reviews.

**Key Features:**

- Issue assistance: Analyze issues and create fixes
- PR assistance: Review and improve pull requests
- Automated commits: Make changes, commit them, and create PRs
- Flexible LLM support: Works with various providers (Anthropic, OpenAI, Google, etc.)

## Codebase Structure

- `src/` - TypeScript action source code
  - `run.ts` - Main entry point for the action
  - `pi/` - Pi client library and tool definitions
  - `github/` - GitHub API interactions and context enrichment
- `scripts/` - Utilities, helpers, etc.

## Important Notes for Agents

1. **Validation**: Before considering any task complete, always run:
   ```bash
   bun run validate
   ```
   This runs: Prettier formatting, ESLint, TypeScript type checking, tests, and build.

2. **Extension Pattern**: The action extends Pi with custom tools (`create_pull_request`, `update_pull_request`, `get_issue_or_pr_thread`) via the `ExtensionAPI` in `src/pi/tools/index.ts`.

3. **Centralized Logging**: Tool execution logging is centralized in `src/pi/logging.ts` using SDK events (`tool_execution_start`, `tool_execution_end`). Tools check `signal?.aborted` directly and return `details.cancelled: true` for cancellations.

4. **Test Coverage**: The project uses `bun test` for testing. Maintain and expand test coverage when making changes.

5. **Prefer Bun package manager over npm or others**

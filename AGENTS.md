# AGENTS.md

## Project Overview

This is a CI/CD runner that integrates the [Pi coding agent](https://pi.dev) with Git hosting platforms. It currently supports **GitHub**, **Codeberg**, and **Forgejo** (including self-hosted instances). Users can invoke the agent by commenting `/pi` in issues or pull requests to get AI assistance with code analysis, fixes, and reviews.

**Key Features:**

- Issue assistance: Analyze issues and create fixes
- PR assistance: Review and improve pull requests
- Automated commits: Make changes, commit them, and create PRs
- Flexible LLM support: Works with various providers (Anthropic, OpenAI, Google, etc.)

## Codebase Structure

- `src/` - TypeScript action source code
  - `run.ts` - Main entry point for the action (simplified orchestrator creation)
  - `orchestrator.ts` - Business logic orchestration with testable adapter pattern
  - `types.ts` - Shared type definitions and adapter interfaces
  - `adapters/` - Production implementations of adapter interfaces
    - `core-adapter.ts` - CI/CD Core operations (`RealCoreAdapter` for CI, `ConsoleCoreAdapter` for standalone)
    - `github-adapter.ts` - Git hosting platform API operations
    - `pi-agent-adapter.ts` - Pi agent factory
  - `pi/` - Pi agent library and tool definitions
  - `platform/` - Platform detection and configuration (GitHub, Codeberg, Forgejo)
  - `github/` - Git hosting platform API interactions and context enrichment
- `tests/` - Bun test files (following Bun convention)
  - `*.spec.ts` - Test files named with `.spec.ts` extension
  - `github/` - Tests for GitHub-related modules
  - `pi/` - Tests for Pi agent integration
- `scripts/` - Utilities, helpers, etc.

## Architecture Overview

The action uses a **testable adapter pattern** to separate business logic from external dependencies:

1. **Orchestrator** (`ActionOrchestrator`) - Contains all business logic:
   - Configuration gathering from inputs
   - Prompt retrieval from GitHub
   - Reaction lifecycle management
   - Pi agent execution
   - Error handling and finalization

2. **Adapters** - Abstract external dependencies:
   - `CoreAdapter` - Wraps CI/CD operations (supports `@actions/core` and console fallback)
   - `GitHubAdapter` - Wraps Git hosting platform API operations
   - `PiAgentFactory` - Creates Pi agent instances

3. **Testability** - The orchestrator can be tested with mock adapters, enabling:
   - Unit testing of orchestration flow
   - Verification of error handling behavior
   - Testing of edge cases without external dependencies

## Important Notes for Agents

1. **Validation**: Before considering any task complete, always run:
   ```bash
   bun run validate
   ```
   This runs: ESLint, TypeScript type checking, and Prettier formatting.

2. **Test Convention**: All test files are located under `./tests` and follow the Bun naming convention `*.spec.ts`. When adding new tests, create them in the appropriate subdirectory under `tests/` (e.g., `tests/github/`, `tests/pi/`) and use the `.spec.ts` extension.

3. **Orchestrator Testing**: Business logic is tested in `tests/orchestrator.spec.ts`. When modifying orchestration behavior, update these tests. Do **not** test mocks directly—test the actual business logic flow.

4. **Platform Support**: The runner detects the Git hosting platform from `GITHUB_SERVER_URL` environment variable (set by all supported CI systems). The API client (`src/github/octokit.ts`) automatically configures the correct base URL for GitHub (`api.github.com`), Codeberg (`codeberg.org/api/v1`), or Forgejo (`{server}/api/v1`).

5. **Centralized Logging**: Tool execution logging is centralized in `src/pi/logging.ts` using SDK events (`tool_execution_start`, `tool_execution_end`). Tools check `signal?.aborted` directly and return `details.cancelled: true` for cancellations.

6. **Test Coverage**: The project uses `bun test` for testing. Maintain and expand test coverage when making changes. Focus on behavior verification, not implementation details.

7. **Prefer Bun package manager over npm or others**

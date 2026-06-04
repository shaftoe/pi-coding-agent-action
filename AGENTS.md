# AGENTS.md

## Repository Layout

Monorepo managed with Bun workspaces (`packages/*`):

- **`packages/pi-orchestrator`** (`@alexanderfortin/pi-orchestrator`) — Reusable, platform-agnostic orchestration core. Consumed by the action and by other apps (e.g. GitHub App / web clients).
  - `src/orchestrator.ts` — `ActionOrchestrator`: prompt retrieval, reaction lifecycle, Pi agent execution, error handling.
  - `src/platform/` — `PlatformProvider` interface, `PlatformContext`, `PlatformType` enum.
  - `src/pi/` — Pi agent factory, prompt building, logging, and tool factories (`src/pi/tools/`) registered via the `ExtensionAPI`. Tools receive a `PlatformProvider` through DI (`createToolsFactory(provider)`).
  - `src/git/` — Platform-agnostic git utilities (file scanner, constants, types).

- **`packages/pi-platform-github`** (`@alexanderfortin/pi-platform-github`) — GitHub/Codeberg/Forgejo implementation of `PlatformProvider`. Depends on `pi-orchestrator`.
  - `src/provider.ts` — `createGitHubPlatformProvider()`.
  - `src/tools/` — GitHub-specific tools (CI status, workflow logs, PR create/update, reviews, thread, diff).
  - `src/git/` — GitHub git operations (commit creator, tree builder, file scanner).
  - `src/{reactions,comments,context,context-utils,constants}.ts` — Supporting modules.
  - Platform detection via `detectPlatform()` (uses `GITHUB_SERVER_URL` env var).

- **`packages/pi-action`** (`@alexanderfortin/pi-action`, private) — GitHub Action entry point. Depends on both packages above.
  - `src/run.ts` — Action entrypoint.
  - `src/adapters/` — GitHub-Actions-specific adapters: `CoreAdapter` (`@actions/core`), `GitAdapter`, `PiAgentAdapter`, `ConfigAdapter`, `OutputSink`.
  - `scripts/package.ts` — esbuild bundling for the action release artifact.

- **`tests/`** (root) — E2E tests (`tests/e2e/`) and shared fixtures (`tests/fixtures/`).
- **`scripts/`** (root) — Repo-level tooling (changelog, version sync, readme deps).

## Important Notes for Agents

1. **Validation**: Before considering any task complete, always run:
   ```bash
   bun run validate
   ```
   This runs ESLint, TypeScript type checking, and Prettier formatting.

2. **Test Convention**: Tests live in each package's `tests/` directory (`packages/<pkg>/tests/`) plus root `tests/` for e2e/fixtures. All test files use the Bun `*.spec.ts` convention.

3. **Orchestrator Testing**: Business logic is tested in `packages/pi-orchestrator/tests/orchestrator.spec.ts`. When modifying orchestration behavior, update these tests. Do **not** test mocks directly—test the actual business logic flow.

4. **Extension Pattern**: Tools are split across packages: tool factories and the `ExtensionAPI` plumbing live in `packages/pi-orchestrator/src/pi/tools/`; platform-specific tool implementations live in `packages/pi-platform-github/src/tools/`. The orchestrator remains decoupled from any platform via the `PlatformProvider` interface.

5. **Centralized Logging**: Tool execution logging is centralized in `packages/pi-orchestrator/src/pi/logging.ts` using SDK events (`tool_execution_start`, `tool_execution_end`). Tools check `signal?.aborted` directly and return `details.cancelled: true` for cancellations.

6. **Test Coverage**: The project uses `bun test` for testing. Maintain and expand test coverage when making changes. Focus on behavior verification, not implementation details.

7. **Prefer Bun package manager** over npm or others.

8. **Do not edit `CHANGELOG.md`**: Changelog updates are automated as part of the release workflow. Never add, modify, or remove entries from `CHANGELOG.md` in PRs — they will be generated at release time.

9. **Fallow (codebase intelligence)**: The project uses [Fallow](https://docs.fallow.tools/) for dead code detection, duplication analysis, and complexity hotspot tracking. Key scripts:
   - `bun run fallow` — run all analyses
   - `bun run fallow:dead-code` — find unused exports, files, types, deps
   - `bun run fallow:dupes` — detect code duplication
   - `bun run fallow:fix:dry` — preview auto-fix for unused exports/deps
   - `bun run fallow:fix` — apply auto-fix
   - Config is in `.fallowrc.json`
   - CI runs on every PR via `.github/workflows/fallow.yml` (SARIF + PR comments, non-blocking)
   - Lefthook runs `fallow dead-code --changed-since origin/develop` on pre-push

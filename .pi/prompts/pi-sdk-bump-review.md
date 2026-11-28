---
description: Review the latest Pi SDK version bump for breaking changes and follow-up opportunities
argument-hint: "[from-version..to-version]"
---
# Pi SDK bump review

We just bumped the first-party Pi SDK packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core` — they share a version scheme and are bumped together) in the currently checked-out branch. Review the bump and report what it means for this repository.

Version range to review: ${1:-derive it from git (see step 1)}.

## Context about this repo

- Monorepo (pnpm workspaces). See `AGENTS.md` for the layout. The Pi SDK is consumed mostly from `packages/pi-orchestrator` (`src/pi/`), `packages/pi-platform-github`, `packages/pi-cli`, `packages/pi-action` and `packages/pi-action-bridge`.
- The SDK version is pinned with `^` in every `package.json` and also stamped in `README.md` ("Versions and Bundled Dependencies"). Renovate groups the three packages so they always move together.
- The GitHub Action bundles the SDK into `dist/` (`pnpm run package`), so SDK changes that affect bundling (new runtime dependencies, native/WASM assets, vendored files, dynamic imports, `import.meta` shims, `copy-binary-assets`) matter too. Check `packages/pi-action/scripts/package.ts` and any "SDK vendor allowlist" assertions.
- This project is **not** an interactive TUI consumer: it drives the SDK headlessly (agent session creation, `ExtensionAPI` tool registration, SDK events such as `tool_execution_start` / `tool_execution_end`, resource loader options, providers such as Bedrock via `@earendil-works/pi-ai/bedrock-provider`, `PREFER_STRICT_JSON_SCHEMA`, thinking levels, compaction events). Changelog entries about keybindings, themes, terminal rendering, interactive-only UI, or the `pi` CLI's own slash commands are mostly irrelevant unless they touch shared APIs. Say so briefly rather than spending time on them.

## Steps

1. **Establish the range.** If no explicit range was given, find the bump commit with `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git log --oneline -20` (it looks like `chore(deps): bump deps, Pi to vX.Y.Z`) and read the previous version from the diff of `packages/pi-orchestrator/package.json` (or `pnpm-lock.yaml`). If the range argument was given, trust it. State the resolved `from → to` range up front.

2. **Read the release notes.**
   - `@earendil-works/pi-coding-agent`: the changelog is shipped inside the installed package — read `node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md` and extract every version in the range (`## [X.Y.Z]`). Pay special attention to **Breaking Changes**, **Removed**, **Deprecated**, and **Changed** sections; also read **New Features** and **Added** (needed for step 4). The package also ships `docs/` — use it to confirm the current shape of any API that looks affected.
   - `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` do not ship a changelog in the npm tarball; read them upstream: `https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md` and `https://github.com/earendil-works/pi/blob/main/packages/agent/CHANGELOG.md` (fall back to the GitHub releases page or the repo's git history if those paths moved).
   - Note that the Pi repo and npm scope used to be different names; if a link 404s, search for the current location instead of giving up.

3. **Check for breaking changes that could affect us.** For each candidate entry in the range:
   - Identify the API/behaviour it changes, then grep our sources (`packages/*/src`, `packages/*/tests`, `tests/`, `action.yml`, `scripts/`) for the affected symbols, env vars (`PI_*`), settings keys, event names, CLI flags, and config shapes. Do not assume — show the grep/build evidence.
   - Classify the finding as **Breaking (confirmed)**, **Breaking (potential, needs runtime check)**, **Behavioural change (no API break)**, or **Not applicable to us** (with a one-line reason).
   - Remember that TypeScript may catch signature changes but will NOT catch behavioural changes (defaults, ordering, deprecations, event payloads, tool-result shapes, cancellation semantics, model/provider defaults, bundled asset paths). Reason about those explicitly.
   - Validate with `pnpm run validate` and the test suite (`pnpm run test` or the package-level Vitest runs) before declaring anything safe. Also run `pnpm run package` if an entry touches bundling/assets.

4. **Look for opportunities** the new version unlocks:
   - **Workarounds to remove**: search our code and comments for `workaround`, `hack`, `TODO`, `FIXME`, `pin`, `because of pi`, `until pi`, `deprecated`, `compat`, and version guards (`getPiVersion`, semver checks, `PI_CODING_AGENT_VERSION__`). Check whether any exist because of an SDK limitation that the new release fixed.
   - **Deprecations we now hit**: are we using anything the new changelog marks as deprecated? Propose the migration.
   - **New features worth adopting**: e.g. new SDK events for our centralized tool logging, new `ExtensionAPI` capabilities, new tool annotations/namespaces, provider/model changes relevant to Bedrock or Copilot users, codemode / tool-search changes, compaction hooks, schema strictness options, new CLI flags that could become action inputs.
   - **Housekeeping**: things like pnpm `minimumReleaseAgeExclude` / build-script allowlists in `pnpm-workspace.yaml`, the vendored asset allowlist in the packaging script, README version tables, `renovate.json` grouping rules — anything that references the SDK by name, version, or file layout and may need adjusting.

5. **Report** (concise, actionable, in a single Markdown response):
   - **Range**: `from → to`, bump commit SHA.
   - **Breaking changes**: a table with columns `Entry | Affects us? | Evidence | Action`. Put confirmed breakages first.
   - **Behavioural changes to watch**: bullet list, each with the user-visible consequence for the action (issue/PR comment flow, cancellations, CI log retrieval, PR creation, etc.).
   - **Recommended changes**: an ordered list, each with the file(s) involved and a short rationale; separate **safe cleanups** from **optional improvements**. Include concrete code sketches only when they are short.
   - **Things verified as unaffected**: one-liners so the reader knows they were checked.
   - **Validation status**: which commands were run and their results.
   - Do **not** edit `CHANGELOG.md`, and do **not** commit or push — just report. Offer to implement the recommended changes as a follow-up.

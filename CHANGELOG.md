# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **orchestrator**: report provider errors (quota/rate-limit) when session ends early (#239)

## [2.19.1] - 2026-06-03

### Changed

- add deps versions to readme, update package workflow
- add warning about GITHUB_TOKEN limitation for .github/workflows (#256)
- ensure all deps are show in readme
- move PI_PACKAGE_DIR env var handling from Agent to action adapter
- note that Pi is bundled and deps update daily (#253)
- **README.md**: remove hallucination (#257)
- update readme

### Fixed

- **comments**: abs() possible negative costs (#254)

## [2.19.0] - 2026-06-02

### Added

- add `loaded_tools` input for selective tool loading (#218)
- add CI/CD awareness tools (get_ci_status / get_workflow_run_logs) (#216)
- add optional auto-compaction and JSONL session export (#227)
- add separate Cost column in comment footer (#248)

### Changed

- add auto-compaction and JSONL session export to README (#231)
- add PR review with existing context example to README (#234)
- cleanup AGENTS.md
- consolidate ESLint config to reduce duplication (#220)
- eliminate env-var coupling in library code (#242)
- eliminate module-level singletons and @actions/* fallbacks (#238)
- implement reusable Pi orchestrator library (#233) (#236)
- README.md: fix `|` char escape (#246)
- replace build-time constants with runtime version resolution (#244)
- Update AGENTS.md
- **deps**: update dependencies (#217)
- **deps**: update dependencies (#223)

### Fixed

- ensure custom models/providers are imported before Agent setup
- ensure newline char before debug log
- ensure packages are loaded correctly in the build
- ensure versions strings are ok
- stop tracking dist/ in git, prevent PRs from sneaking in dist changes
- update dependencies and simplify loaded_tools with SDK native tools option (#222)
- use correct path for packageDir
- use list for loaded_tools inputs

## [2.18.0] - 2026-05-27

### Added

- add customizable branch naming with branch_name_template input (#207)
- append Co-authored-by trailer to commit messages (#206)

### Changed

- **deps**: update dependencies (#212)
- **deps**: update dependencies (#213)

### Fixed

- add git ref validation and fix truncation test for branch naming (#211)

## [2.17.1] - 2026-05-24

### Changed

- **deps**: update dependencies (#201)
- **deps**: update dependencies (#204)

## [2.17.0] - 2026-05-19

### Added

- add create_pull_request_review tool for inline diff-anchored review comments (#189)
- ensure get_pr_diff does not overflow context window (#195)

### Changed

- **deps**: update dependencies (#196)
- **deps**: update dependencies (#197)

## [2.16.1] - 2026-05-17

### Changed

- **deps**: update dependencies (#182)
- **deps**: update dependencies (#184)
- **deps**: update dependencies (#186)
- **deps**: update dependencies (#187)
- **deps**: update dependencies (#190)

### Fixed

- ensure final comment is always sent after Pi session completes (#192)
- revert message_end/compaction_end error handling

## [2.16.0] - 2026-05-07

### Added

- add ignore to fetchPRDiff to exclude e.g. dist/ (#175)
- update dependencies to use new @earendil-works namespace

## [2.15.5] - 2026-05-05

### Changed

- **deps**: update dependencies (#174)

## [2.15.4] - 2026-05-04

### Fixed

- only fail workflow on terminal session errors, not transient recovered ones (#172)

## [2.15.3] - 2026-05-04

### Changed

- default to openai for examples
- split context.ts into cohesive modules and create tools subpackage (#170)
- update readme about optional token input

### Fixed

- catch Pi agent session errors and fail the workflow (#168)

## [2.15.2] - 2026-05-04

### Fixed

- remove hard token input requirement to allow for ADC auth (#164)

## [2.15.1] - 2026-05-02

### Fixed

- prevent duplicate "Agent session completed" messages (#160)

## [2.15.0] - 2026-05-02

### Added

- add get_pr_diff tool and review comments to get_issue_or_pr_thread (#161)
- enable custom provider registration via models.json (#158)

### Changed

- update readme

## [2.14.0] - 2026-05-02

### Added

- export session as self-contained HTML artifact (#151)

## [2.13.4] - 2026-05-02

### Changed

- **deps**: update dependencies (#154)

## [2.13.3] - 2026-05-01

### Fixed

- make tool call logging consistent between start and end events (#148)

## [2.13.2] - 2026-04-30

### Changed

- update feature descriptions in README.md

### Fixed

- improve error messages for missing required inputs (#143)

## [2.13.1] - 2026-04-27

### Changed

- update readme to explicit Node version requirement
- **deps**: upgrade Pi to v0.70.2

### Fixed

- **deps**: upgrade @mariozechner/pi-coding-agent from v0.70.2 to v0.70.5 (#134)

## [2.13.1] - 2026-04-27

### Changed

- **deps**: upgrade `@mariozechner/pi-coding-agent` from v0.70.2 to v0.70.5 (#133)

### Fixed

- Inherits upstream fix for API-key environment discovery falling back to `/proc/self/environ` when Bun's sandbox leaves `process.env` empty
- Inherits upstream fix for Bun sandboxed package-manager commands when `process.env` is empty
- Inherits upstream fix for symlinked packages/resources/skills being duplicated in loaders
- Inherits upstream fix for bash executor temp output streams leaking file descriptors when output was truncated by line count
- Inherits upstream fix for Anthropic SSE parsing ignoring unknown proxy events
- Inherits upstream fix for long local-LLM SSE streams aborting at 5 minutes with `UND_ERR_BODY_TIMEOUT`

## [2.13.0] - 2026-04-24

### Added

- add base_url input to override provider endpoint URL (#125)

### Changed

- fix changelog

## [2.12.0] - 2026-04-22

### Changed

- **deps**: upgrade `@mariozechner/pi-coding-agent` from v0.68.1 to v0.69.0 (#121)
- Migrate TypeBox imports from `@sinclair/typebox` 0.34.x to `typebox` 1.x (following upstream breaking change)
- Remove direct `@sinclair/typebox` dependency (now provided transitively via the Pi SDK)
- Remove stale `@ts-expect-error` comments on tool parameter schemas (fixed by TypeBox 1.x migration)

## [2.11.1] - 2026-04-22

### Changed

- reorder examples in readme
- **deps**: update dependencies

### Fixed

- skip final comment creation when no issue/PR number in context (#120)

## [2.11.0] - 2026-04-21

### Added

- add action outputs

## [2.10.0] - 2026-04-21

### Added

- upgrade Pi to v0.68.0 with new SDK features (#118)

### Changed

- update README.md

## [2.9.1] - 2026-04-20

### Changed

- add Goals to README, remove redundant test info
- extract platform-agnostic git utilities into shared module (#111)
- udpate readme about env vars
- **deps-dev**: update dependencies

### Fixed

- catch finalization errors to ensure action always signals failure (#116)

## [2.9.0] - 2026-04-19

### Added

- add multi-platform support with platform abstraction (#106)

## [2.8.2] - 2026-04-18

### Changed

- **deps**: update Pi to v0.67.68
- update README.md

### Fixed

- handle nested .gitignore files and prevent incorrect deletion of gitignored tracked files (#105)

## [2.8.1] - 2026-04-17

### Changed

- update readme

### Fixed

- use @semantic-release/npm to bump package.json during semantic release (#101)

## [2.8.0] - 2026-04-17

### Added

- add support for review comments (#96)

### Changed

- **deps**: bump Pi and typescript
- remove useless and stale info from readme
- update readme

## [2.7.2] - 2026-04-16

### Fixed

- support PR inline (review) comments (#91)

## [2.7.1] - 2026-04-16

### Changed

- **deps**: bump Pi and prettier
- rename toolsFactory for clarity

### Fixed

- bump Pi SDK v0.67.5

## [2.7.0] - 2026-04-15

### Added

- add opt-out option for built-in GitHub extensions (#88)

## [2.6.1] - 2026-04-13

### Changed

- update README, fix release flow

### Fixed

- new changelog updating flow to ensure correctness

## [2.6.0] - 2026-04-06

### Added

- Semantic-release for automated versioning and release management
- Automated CHANGELOG.md generation
- Automated package.json version updates

### Changed

- Release workflow now uses semantic-release to handle versioning, changelog generation, and GitHub releases

### Fixed

- CHANGELOG.md and package.json were not being updated during releases (now handled by semantic-release)

## [2.5.0] - 2026-04-05

### Added

- CHANGELOG.md to track project changes
- Custom extensions support via `extensions` input (npm packages, git repos, local files)

### Changed
- Tool execution refactored to reduce duplication
- Dependencies updated
- Updated README architecture section

## [2.4.0] - 2026-04-03

### Added
- Support for custom Pi extensions to add additional tools and modify agent behavior
- `extensions` input accepting npm packages, git repositories, and local file paths

### Changed
- Updated tools to use new `defineTool()` from Pi SDK
- Dependencies bumped
- Development dependency (eslint) bumped

## [2.3.3] - 2026-04-03

### Changed
- Upgraded Pi to version 0.65.0 and related dependencies
- Added caution note about securing workflows in README

## [2.3.2] - 2026-04-03

### Changed
- Updated tag-version script to create bundle during release

## [2.3.1] - 2026-04-01

### Added
- Test coverage improvements
- E2E test flow and coverage extensions

### Changed
- Improved module-level state management in `src/github/index.ts`
- Merged Pi flows into single pi.yml workflow
- Unified type configuration across tests
- Removed core import to simplify testing
- Extracted duplicate `getContextType()` to shared utility

### Fixed
- Missing action version in footer and logs
- Missing SDK version in logs and footer
- Silent errors being swallowed
- Unsafe type assertion for tree entry sha field
- Logging issues

## [2.3.0] - 2026-03-31

### Fixed
- README link corrections
- Codecov action updated, removed double build

[unreleased]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.19.1...HEAD
[2.19.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.19.0...v2.19.1
[2.19.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.18.0...v2.19.0
[2.18.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.17.1...v2.18.0
[2.17.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.17.0...v2.17.1
[2.17.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.16.1...v2.17.0
[2.16.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.16.0...v2.16.1
[2.16.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.15.5...v2.16.0
[2.15.5]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.15.4...v2.15.5
[2.15.4]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.15.3...v2.15.4
[2.15.3]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.15.2...v2.15.3
[2.15.2]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.15.1...v2.15.2
[2.15.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.15.0...v2.15.1
[2.15.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.14.0...v2.15.0
[2.14.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.13.4...v2.14.0
[2.13.4]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.13.3...v2.13.4
[2.13.3]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.13.2...v2.13.3
[2.13.2]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.13.1...v2.13.2
[2.13.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.13.0...v2.13.1
[2.13.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.12.0...v2.13.0
[2.12.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.11.1...v2.12.0
[2.11.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.11.0...v2.11.1
[2.11.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.10.0...v2.11.0
[2.10.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.9.1...v2.10.0
[2.9.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.9.0...v2.9.1
[2.9.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.8.2...v2.9.0
[2.8.2]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.8.1...v2.8.2
[2.8.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.8.0...v2.8.1
[2.8.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.7.2...v2.8.0
[2.7.2]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.7.1...v2.7.2
[2.7.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.7.0...v2.7.1
[2.7.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.6.1...v2.7.0
[2.6.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.6.0...v2.6.1
[2.6.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.3.3...v2.4.0
[2.3.3]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.3.2...v2.3.3
[2.3.2]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/shaftoe/pi-coding-agent-action/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/shaftoe/pi-coding-agent-action/releases/tag/v2.3.0

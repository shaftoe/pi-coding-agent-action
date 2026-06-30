# Pi Coding Agent Action

<p align="center">
  <a href="https://github.com/shaftoe/pi-coding-agent-action/releases"><img alt="GitHub release" src="https://img.shields.io/github/v/release/shaftoe/pi-coding-agent-action?logo=github"></a>
  <a href="https://github.com/marketplace/actions/pi-github-action"><img alt="Marketplace" src="https://img.shields.io/badge/Marketplace-2C8EBB?logo=githubactions&logoColor=white"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white"></a>
  <a href="https://github.com/shaftoe/pi-coding-agent-action/actions/workflows/build.yml"><img alt="Build" src="https://github.com/shaftoe/pi-coding-agent-action/actions/workflows/build.yml/badge.svg?branch=v2"></a>
  <a href="https://github.com/shaftoe/pi-coding-agent-action/actions/workflows/release.yml"><img alt="Release" src="https://github.com/shaftoe/pi-coding-agent-action/actions/workflows/release.yml/badge.svg?branch=v2"></a>
  <a href="https://github.com/shaftoe/pi-coding-agent-action/actions/workflows/fallow.yml"><img src="https://img.shields.io/badge/self--analyzed-fallow-brightgreen" alt="Self analyzed"></a>
  <a href="https://github.com/shaftoe/pi-coding-agent-action/pulls"><img alt="PRs Welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen"></a>
  <a href="https://github.com/semantic-release/semantic-release"><img alt="semantic-release" src="https://img.shields.io/badge/semantic--release-e10079?logo=semantic-release"></a>
  <a href="https://codecov.io/gh/shaftoe/pi-coding-agent-action/"><img alt="Codecov" src="https://codecov.io/gh/shaftoe/pi-coding-agent-action/branch/v2/graph/badge.svg"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/shaftoe/pi-coding-agent-action"></a>
</p>

A CI/CD action that integrates [Pi coding agent](https://pi.dev) with git hosting platform workflows. Works with **GitHub**, **Codeberg**, and self-hosted **Forgejo** instances — any platform that provides GitHub-compatible APIs and CI/CD environment variables.

Inspired by OpenCode's [GitHub action](https://opencode.ai/docs/github/).

## Features

- **Familiar workflow**: Supports the familiar workflow of running Pi coding agent as CLI (loading skills, extensions, AGENTS.md, sharing sessions, etc.) in a GitHub CI/CD workflow.
- **Minimal batteries included**: Tries to follow Pi minimalistic phylosophy while providing a comfortable UX out of the box, e.g. pretty print of logs, auto replies to comments, and tools to interact efficiently with git and GitHub-compatible APIs.
- **Composable**: Provides useful inputs and outputs for chaining together multiple Pi sessions and/or other GitHub actions/workflows.
- **Integrates with GitHub workflows**: Natively integrates with usual GitHub issue/PR workflows, invoke Pi both interactively (e.g. prefixing `/pi ` in an issue/PR comment) and programmatically (e.g. as a step in a workflow).
- **Up-to-date**: Pi SDK and dependencies updated regularly.

## Use cases

- **Issue assistance**: Prefix any new issue description and/or any issue comment with `/pi ` to have the agent analyze the issue, generate a report and/or create a new PR with the fix
- **PR assistance**: Prefix any PR comment, review comment or review message with `/pi ` to have the agent review the pull request and/or to apply further changes
- **Automated code reviews**: Have Pi review every new pull request automatically
- **Recurring tasks**: Schedule Pi to run periodic maintenance tasks such as dependency audits, security scans, documentation updates, or code quality checks
- **Add Pi to your own pipelines**: (Optionally) generate prompt from upstream actions/workflows and have Pi do the work in background for you anywhere you like in your workflows

## Quick Start

Create a workflow file, e.g., `.github/workflows/pi-agent.yml`. See the [interactive](./.github/workflows/pi.yml) and [non-interactive](./.github/workflows/pr.yml) workflows in this repository to get started.

## Securing your workflows

> [!WARNING]
> We recommend to be as conservative as possible with how the action can be triggered.
> Depending on the permissions assigned to your workflow you should consider restricting who's allowed to trigger it e.g. filtering for GitHub user name or role (`if github.actor == '<my-user>'`).
> You should also consider disabling automated PRs reviews for forks (`if: github.event.pull_request.head.repo.fork == false`), see [Review PR](.github/workflows/pr.yml) workflow for an actual example.

> [!WARNING]
> **GitHub `GITHUB_TOKEN` cannot push changes to files under `.github/workflows/`.** This is a [GitHub security restriction](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication) — even when the workflow has `contents: write` permission, the automatic `GITHUB_TOKEN` is **never** allowed to create or modify workflow files. If you need Pi to create PRs that touch `.github/workflows/*.yml`, you must provide a [Personal Access Token (PAT)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) with the `workflow` scope instead of the default `GITHUB_TOKEN`.

> [!CAUTION]
> **Project trust is automatically enabled.** The Pi SDK (v0.79.0+) uses a [project trust system](https://pi.dev/docs/latest/security#project-trust) to decide whether to load project-level resources such as `AGENTS.md`, `.pi` settings, project extensions, and skills. In a CI environment there is no interactive user to approve trust, so this action **always marks the workspace as trusted** (`projectTrusted: true`) when creating the agent session. This means any `AGENTS.md`, `.pi/` configuration, or project extensions present in the repository checkout will be loaded and followed by the agent. Keep this in mind when deciding what to commit to your repository — anyone with push access can influence agent behavior through these files.
> See [the official Pi documentation](https://pi.dev/docs/latest/security#project-trust) for more information on project trust.

## Versions and Bundled Dependencies

The `develop` branch is in constant development while the `v2` branch is considered stable, if you don't want the bleeding edge you can pin to a specific release, e.g.

```yaml
   uses: shaftoe/pi-coding-agent-action@v2.24.0
```

> [!NOTE]
> **This action uses GitHub's immutable releases feature.** Once a release tag is published, it cannot be modified — the tag always points to the exact same commit SHA. This means pinning to a release tag (e.g., `@v2.20.3`) is functionally equivalent to pinning to a commit hash (e.g., `@abc123def456`) for security and reproducibility purposes. You get the stability of a fixed commit with the readability of semantic versioning. See [GitHub's official documentation](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/using-immutable-releases-and-tags-to-manage-your-actions-releases) for more details on immutable releases.

The action is bundled into a single `dist/index.js` via [esbuild](https://esbuild.github.io/) so no `node_modules` are needed at runtime. Non-code Pi SDK assets (HTML templates, theme JSON) are copied to `dist/pi-sdk/` and resolved via the `PI_PACKAGE_DIR` environment variable.

Dependencies (including Pi itself) are [updated regularly](./.github/workflows/daily-deps-update.yml) to keep up with new releases.

If you need to pin to a specific Pi SDK version check out previous release tags and refer to the following table to find the correct version:

<!-- DEPS_TABLE_START -->

| Dependency | Version | Description |
|---|---|---|
| `@actions/core` | `3.0.1` | GitHub Actions core I/O (inputs, outputs, logging) |
| `@actions/github` | `9.1.1` | GitHub API client (Octokit wrapper) |
| `@earendil-works/pi-agent-core` | `0.80.2` | Pi Agent Core — agent orchestration primitives |
| `@earendil-works/pi-ai` | `0.80.2` | Pi AI — AI model abstractions and providers |
| `@earendil-works/pi-coding-agent` | `0.80.2` | Pi SDK — AI coding agent runtime |
| `@js-temporal/polyfill` | `0.5.1` | Temporal API polyfill |
| `@octokit/core` | `7.0.6` | Octokit REST API client core |
| `@octokit/plugin-rest-endpoint-methods` | `17.0.0` | Octokit REST API endpoint methods |
| `ignore` | `7.0.5` | `.gitignore`-style pattern matching |
| `typebox` | `1.3.2` | JSON Schema Type Builder |

<!-- DEPS_TABLE_END -->

> _This table is auto-updated by the [`develop.yml`](./.github/workflows/develop.yml) workflow whenever dependencies change._

> [!NOTE]
> If you don't want to use latest and greatest dependencies, pin the action to a specific release, e.g. `uses: shaftoe/pi-coding-agent-action@v2.0.0`

## Usage

### Interactive Workflows

- Create a GitHub workflow which triggers when comments are added (e.g., `issue_comment`)
- Filter by `if` to only run on the trigger phrase (e.g., `startsWith(github.event.comment.body, '/pi ')`)
- Add `actions/setup-node` as prerequisite step (Node version >= `v22.x`)
- Finally, add `shaftoe/pi-coding-agent-action`

Example:

```yaml
name: Pi Agent

on:
  issue_comment:
    types: [created]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  pi-agent:
    if: startsWith(github.event.comment.body, '/pi ')
    runs-on: ubuntu-latest
    steps:
      - name: Setup Node
        uses: actions/setup-node@v6
        with:
          node-version: 24

      - name: Run Pi agent
        uses: shaftoe/pi-coding-agent-action@v2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: my-provider
          model: some-model
          token: ${{ secrets.MODEL_API_KEY }}
          base_url: https://my-gateway.example.com/v1
          thinking_level: medium
```

### Non-Interactive Workflows

You can use the `prompt` input to run the agent without requiring a comment trigger. This is useful for automated workflows like PR reviews, scheduled tasks, or prompts generated by a previous step:

```yaml
- name: Run Pi agent with fixed prompt
  uses: shaftoe/pi-coding-agent-action@v2
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}
    prompt: 'Review this pull request for security issues' # or e.g. ${{ steps.generate-prompt.outputs.prompt }}
```

When using the `prompt` input, the action still enriches the prompt with issue/PR context (title and description) if available in the workflow context.

#### PR Review with Existing Context

When running automated PR reviews (e.g. on `pull_request: [opened, synchronize]`), you can instruct the agent to fetch existing review comments before reviewing. This prevents duplicate feedback and provides continuity across re-runs:

```yaml
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.pull_request.head.ref }}
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - uses: shaftoe/pi-coding-agent-action@v2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: openai
          model: gpt-5.4
          token: ${{ secrets.OPENAI_API_KEY }}
          prompt: |
            Review this pull request. Before starting, use get_issue_or_pr_thread to
            fetch any existing review comments so you don't duplicate feedback that
            has already been given. Focus on issues, bugs, and security concerns.
            Post your findings as a PR review when done.
```

> [!TIP]
> The `get_issue_or_pr_thread` tool returns both regular comments and inline review comments (with file path and line information). Telling the agent to call it first is all you need to provide full review context — no special configuration required.

### On-Demand PR Reviews (`workflow_dispatch`)

Use the `pr_number` input to run the agent against any pull request on demand, without requiring a triggering comment or event. This is ideal for manual reviews triggered via the GitHub Actions "Run workflow" button or from other automation pipelines.

When `pr_number` is provided:

- The action targets the specified PR for all operations (diff, thread, review, etc.).
- PR context (title, description) is fetched from the GitHub API and included in the prompt.
- If no `prompt` input is provided, a default instruction ("Review this pull request and provide feedback") is used.
- Reactions are automatically skipped since there is no triggering comment.

#### Example: manual trigger from the GitHub UI

```yaml
name: On-demand PR Review

on:
  workflow_dispatch:
    inputs:
      pr_number:
        description: 'PR number to review'
        required: true
        type: number
      instruction:
        description: 'Custom instruction (optional)'
        required: false
        default: 'Review this PR for bugs, security issues, and improvements'

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - uses: shaftoe/pi-coding-agent-action@v2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: ${{ vars.PROVIDER }}
          model: ${{ vars.MODEL }}
          token: ${{ secrets.API_KEY }}
          pr_number: ${{ inputs.pr_number }}
          prompt: ${{ inputs.instruction }}
```

#### Example: triggered by another workflow

You can also call a `workflow_dispatch` from another workflow step, e.g. to automatically request a review after a specific event:

```yaml
- name: Trigger PR review
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    gh workflow run on-demand-review.yml \
      --field pr_number=${{ github.event.pull_request.number }} \
      --field instruction="Review the latest changes for regressions"
```

> [!TIP]
> Combine `pr_number` with other inputs like `thinking_level`, `loaded_tools`, or `extensions` to customize the review behavior. For example, use `loaded_tools` to restrict the agent to read-only tools when you only want feedback without automatic fixes.

### Recurring Tasks

You can use the `schedule` trigger to run the action periodically for automated maintenance tasks like dependency audits, security scans, documentation updates, or code quality checks.

#### Example: weekly dependency audit

```yaml
name: Weekly Dependency Audit

on:
  schedule:
    # Runs every Monday at 9:00 AM UTC
    - cron: '0 9 * * 1'
  # Allow manual trigger via the UI
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  dependency-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - uses: shaftoe/pi-coding-agent-action@v2
        id: pi
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: openai
          model: gpt-5.4
          token: ${{ secrets.OPENAI_API_KEY }}
          prompt: |
            Audit the project's dependencies for security vulnerabilities, outdated packages,
            and deprecated APIs. Check package.json, bun.lockb, and any lock files.
            If issues are found, create a pull request with updates and a summary of changes.
            If no issues are found, post a comment on the most recent issue or PR indicating
            the audit completed successfully with no findings.
```

#### Example: daily documentation sync

```yaml
name: Daily Documentation Sync

on:
  schedule:
    # Runs daily at 6:00 AM UTC
    - cron: '0 6 * * *'

permissions:
  contents: write
  pull-requests: write

jobs:
  docs-sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v6
        with:
          node-version: 24

      - uses: shaftoe/pi-coding-agent-action@v2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: openai
          model: gpt-5.4
          token: ${{ secrets.OPENAI_API_KEY }}
          prompt: |
            Check if the documentation is up to date with the latest code changes.
            Review README.md, any docs/ directory, and inline code comments.
            If you find discrepancies, create a pull request with the necessary documentation updates.
          branch_name_template: 'docs/{title}-{number}'
```

> [!TIP]
> Use `workflow_dispatch` alongside `schedule` to allow manual runs for testing or ad-hoc execution. Combine with `export_session_html` and `export_session_jsonl` to archive periodic task results as workflow artifacts.

### Custom Extensions

You can load custom Pi extensions to add additional custom tools or modify agent behavior:

```yaml
- name: Run Pi agent with extensions
  uses: shaftoe/pi-coding-agent-action@v2
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}
    extensions: |
      npm:pi-subagents
      git:github.com/user/pi-custom-tools
      ./my-local-extension.ts
```

Supported extension sources:
- **npm packages**: `npm:package-name` or `npm:package@version`
- **git repositories**: `git:github.com/user/repo` (supports branches with `#branch`)
- **local files**: Relative paths to `.ts` extension files

Refer to <https://pi.dev/docs/latest/extensions> to know more about Pi's powerful extensions APIs.

### Custom Providers via `models.json`

The Pi SDK supports registering custom LLM providers (e.g., local servers, API gateways, OpenAI-compatible endpoints) through a `models.json` configuration file. By default the SDK looks for `~/.pi/agent/models.json`. When the file doesn't exist, only the built-in providers are available — identical to the previous behavior.

See the [Custom Provider documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md) for the full schema reference.

#### Example: configure a custom provider in a previous workflow step

```yaml
- name: Configure custom LLM provider
  run: |
    mkdir -p ~/.pi/agent
    cat > ~/.pi/agent/models.json << 'EOF'
    {
      "providers": {
        "my-llm": {
          "baseUrl": "https://api.example.com/v1",
          "apiKey": "${{ secrets.LLM_API_KEY }}",
          "models": [{
            "id": "my-model-v1",
            "name": "My Model V1",
            "api": "openai-chat",
            "cost": { "input": 0.001, "output": 0.002, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 128000,
            "maxTokens": 4096
          }]
        }
      }
    }
    EOF

- uses: shaftoe/pi-coding-agent-action@v2
  with:
    provider: my-llm
    model: my-model-v1
    token: ${{ secrets.LLM_API_KEY }}
```

> [!TIP]
> You might want to configure custom providers via the extension APIs with a package instead, e.g.:
> 
> ```yaml
> - name: Run Pi agent
>   uses: shaftoe/pi-coding-agent-action@v2
>   with:
>     github_token: ${{ secrets.GITHUB_TOKEN }}
>     provider: my-llm
>     model: my-model-v1
>     token: ${{ secrets.LLM_API_KEY }}
>     extensions: |
>       git:github.com/user/my-custom-pi-tools.git
> ```
>
> Refer to <https://pi.dev/docs/latest/custom-provider> for details.

### Disabling Built-in Extensions

By default the action loads all built-in GitHub tools (see [Custom Tools](#custom-tools) for the full list) to help Pi better interact with GitHub Actions environment without relying on external tools like `gh` or special skills setup. If you want Pi to use only your own custom extensions (or none at all), set `load_builtin_extensions` to `false`:

```yaml
- name: Run Pi agent
  uses: shaftoe/pi-coding-agent-action@v2
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}
    load_builtin_extensions: false
    extensions: |
      npm:my-custom-github-tools
```

### Selective Tool Loading

Use `loaded_tools` to control exactly which tools (built-in **and** Pi's own) are available in the session. This is useful when you want to keep built-in extensions enabled but restrict the agent to a subset of tools.

```yaml
- name: Run Pi agent (read-only tools only)
  uses: shaftoe/pi-coding-agent-action@v2
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}
    loaded_tools: |
      get_pr_diff
      create_pull_request_review
      get_issue_or_pr_thread
```

The default value is `all`. Tool names must match exactly — the run fails early if a name doesn't correspond to a registered tool.

> [!WARNING]
> `loaded_tools` can only reference tools that are actually available in the session. If `load_builtin_extensions` is set to `false`, built-in GitHub tool names won't be available to list — use `load_builtin_extensions: true` (the default) and then restrict with `loaded_tools` instead.

### Custom Branch Names

You can customize the auto-generated branch names used when Pi creates pull requests. By default, branches follow the `pi/issue{number}-{timestamp}` pattern. Use the `branch_name_template` input to override this:

```yaml
- uses: shaftoe/pi-coding-agent-action@v2
  with:
    branch_name_template: 'feature/{title}-{number}'
```

#### Supported Variables

| Variable | Description | Example |
|----------|-------------|--------|
| `{number}` | Issue or PR number | `42` |
| `{timestamp}` | Epoch milliseconds | `1716543210000` |
| `{title}` | Slugified PR title | `fix-auth-bug` |

#### Examples

| Template | Result |
|----------|--------|
| *(empty — default)* | `pi/issue42-1716543210000` |
| `feature/{title}` | `feature/fix-auth-bug` |
| `fix/{number}` | `fix/42` |
| `{title}-{number}-{timestamp}` | `fix-auth-bug-42-1716543210000` |

### Injecting Environment Variables

Pi extensions often require environment variables for authentication or configuration. Use the native `env:` step key to pass variables from your workflow's secrets or configuration into the Pi session:

```yaml
- name: Run Pi agent with custom env vars
  uses: shaftoe/pi-coding-agent-action@v2
  env:
    MY_API_KEY: ${{ secrets.MY_API_KEY }}
    ANOTHER_SERVICE_TOKEN: ${{ secrets.ANOTHER_SERVICE_TOKEN }}
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}
```

Since the action runs as a single Node.js process, these environment variables are available in `process.env` and accessible to all Pi extensions.

#### Token input

The `token` input is optional and the action auth could also be specified as environment variable instead, e.g:

```yaml
- name: Run Pi agent with auth env var
  uses: shaftoe/pi-coding-agent-action@v2
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: openai
    model: gpt-5.4
```

Examples in this documentation tend to favour `input` because is more consistent with GitHub environment variables/secrets and lets configure the LLM completely via the web admin interface without the need for patching workflow yaml files.

### Using Outputs in Downstream Jobs

Use `outputs.<job-id>.outputs.<name>` to pass action outputs to another step or another job in the same workflow. For example, you can have Pi generate release notes in one job and then create a release in another:

```yaml
jobs:
  pi-agent:
      # shortened for brevity...
      - name: Run Pi agent
        id: pi          # Required to access outputs from this step
        uses: shaftoe/pi-coding-agent-action@v2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: openai
          model: gpt-5.4
          token: ${{ secrets.OPENAI_API_KEY }}
          prompt: 'Generate release notes for the latest commit'

  publish:
    needs: pi-agent
    if: ${{ needs.pi-agent.outputs.success == 'true' }}
    runs-on: ubuntu-latest
    steps:
      - name: Log results
        run: |
          echo "Response: ${{ needs.pi-agent.outputs.response }}"
          echo "Cost: ${{ needs.pi-agent.outputs.cost }} USD"
          echo "Tokens: ${{ needs.pi-agent.outputs.input_tokens }} in / ${{ needs.pi-agent.outputs.output_tokens }} out"
          echo "Duration: ${{ needs.pi-agent.outputs.duration_seconds }}s"

      - name: Create GitHub release
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          echo '${{ needs.pi-agent.outputs.response }}' > release-notes.md
          gh release create v1.0.0 --notes-file release-notes.md
```

### Session Exports (HTML & JSONL)

The action can export the Pi session in two formats:

- **`export_session_html`** — a self-contained HTML file for human review in any browser
- **`export_session_jsonl`** — a JSONL file (one JSON object per line) for programmatic consumption, data analysis pipelines, or long-term archival

Both are disabled by default. When enabled, their file paths are exposed via the `session_html_path` and `session_jsonl_path` outputs. They can be uploaded as workflow artifacts:

```yaml
- uses: shaftoe/pi-coding-agent-action@v2
  id: pi
  with:
    export_session_html: true
    export_session_jsonl: true
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}

- uses: actions/upload-artifact@v7
  if: ${{ steps.pi.outputs.session_html_path || steps.pi.outputs.session_jsonl_path }}
  with:
    name: pi-session-${{ github.event.issue.number || github.event.pull_request.number || github.run_number }}
    path: |
      ${{ steps.pi.outputs.session_html_path }}
      ${{ steps.pi.outputs.session_jsonl_path }}
```

### Session Sharing (`/share` equivalent)

`share_session` replicates pi's interactive `/share` command: it uploads the exported session HTML to a **secret GitHub Gist** and surfaces a `pi.dev/session` viewer link (`https://pi.dev/session/#<gistId>`). No `gh` CLI is required — the action calls the GitHub Gist REST API directly, so it also works from Forgejo/Gitea runners. Set the `PI_SHARE_VIEWER_URL` environment variable to point at a self-hosted viewer such as [`gistviewer.l3x.in`](https://gistviewer.l3x.in/) (same env var the interactive `/share` command reads) — see [Custom viewer](#custom-viewer).

The link is surfaced in two places: the job log footer and the **job summary** (`$GITHUB_STEP_SUMMARY`). It is also exposed as the `share_url`, `gist_url`, and `gist_id` outputs for downstream steps.

Enabling `share_session` **auto-enables `export_session_html`** (the gist carries the HTML export's bytes), so you don't need to set both.

> [!IMPORTANT]
> **A GitHub token with `gist` scope is required** for the default (`github`) provider. The default `secrets.GITHUB_TOKEN` **cannot** create gists. Set the `github_token` input to a classic PAT (with the `gist` scope), a fine-grained PAT (Account → **Gists: read/write**), or a GitHub App installation token — the same token is used for all GitHub API operations.
>
> Using a self-hosted [Opengist](https://github.com/thomiceli/opengist) instance instead? See [Opengist backend](#opengist-backend) below.

> [!WARNING]
> Secret gists are **URL-obscured, not access-controlled** — anyone with the link can read the rendered session, which may include code, file contents, or secrets the agent touched. Only enable `share_session` for runs where that exposure is acceptable, and prefer a dedicated bot account so shared gists are easy to audit and delete.

```yaml
- uses: shaftoe/pi-coding-agent-action@v2
  id: pi
  with:
    share_session: true
    github_token: ${{ secrets.GH_PAT }}   # PAT w/ gist scope — NOT secrets.GITHUB_TOKEN
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}

- name: Echo share link
  if: ${{ steps.pi.outputs.share_url }}
  run: echo "Session: ${{ steps.pi.outputs.share_url }}"
```

> [!NOTE]
> **Gist cleanup is your responsibility.** The action does not delete shared gists — they accumulate on the account that owns the `github_token`. This mirrors pi's own `/share` behaviour and is intentional (the links must stay valid for the viewer to work), but it means gists will pile up over time. To keep things tidy:
> - Use a dedicated bot account for sharing so personal gists don't get cluttered.
> - Each gist's description includes the repo, issue number, and run ID (`Pi session — owner/repo#123 (run 456)`) for easy identification in the gist list.
> - Periodically prune old gists via the [GitHub Gist API](https://docs.github.com/en/rest/gists/gists#delete-a-gist) or the web UI. The `gist_id` action output is available for automation — e.g. a scheduled workflow could list and delete gists older than a threshold.
> - The `gist_url` output points to each gist's page where it can be reviewed or deleted manually.

#### Opengist backend

By default `share_session` uploads to **GitHub Gists** and links to the `pi.dev/session` viewer. You can instead upload to a self-hosted [Opengist](https://github.com/thomiceli/opengist) instance (e.g. `gist.l3x.in`) by setting `share_gist_provider: opengist`.

The pi.dev viewer **cannot** read non-GitHub gists (it hardcodes `api.github.com`), so for the Opengist backend the `share_url` points directly at the gist's **raw HTML** route. The exported session HTML is self-contained (session data is embedded inline), and Opengist serves `.html` files with `Content-Type: text/html` and an inline disposition, so the raw link renders the full session in any browser with no viewer dependency.

> [!WARNING]
> **Same-origin XSS surface (Opengist only).** With the default (`github`) provider the rendered session is served from `pi.dev` — an isolated origin separate from where gists are stored. The Opengist `share_url`, by contrast, renders the session's HTML on the **same origin** as your Opengist instance (e.g. `gist.l3x.in`), which the viewer is typically logged into. The exported HTML carries the viewer JavaScript plus any rendered tool output and file contents; if any of that is not escaped by the session exporter, it executes with the Opengist origin's privileges (session cookies, authenticated `/api/...` calls) — a stored-XSS vector that does **not** exist for the GitHub backend. Mitigations: prefer a dedicated or isolated Opengist instance (or a separate viewer account) for shared sessions, and only enable `share_session` when you trust the session contents.

```yaml
- uses: shaftoe/pi-coding-agent-action@v2
  id: pi
  with:
    share_session: true
    share_gist_provider: opengist
    share_gist_api_url: https://gist.l3x.in/api/gists   # Opengist REST API lives under /api/, not /api/v1/
    share_gist_token: ${{ secrets.OPENGIST_TOKEN }}       # Opengist access token (og_…) with gist:write scope
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}

- name: Echo share link
  if: ${{ steps.pi.outputs.share_url }}
  run: echo "Session: ${{ steps.pi.outputs.share_url }}"
```

Notes:
- The Opengist REST API create endpoint is `POST <instance>/api/gists`. Create an access token in **Settings → Access Tokens** (it starts with `og_`) and grant it the `gist:write` scope. See the [Opengist API docs](https://opengist.io/docs).
- Gists are created as `unlisted` (not listed publicly, but readable via the unguessable URL) — the closest analogue of a GitHub "secret" gist.
- `share_gist_token` is optional: when unset, the action falls back to `github_token`, so you can reuse a single token if your Opengist setup accepts it.
- The `share_url` uses the gist's **raw route** (`<gist page>/raw/HEAD/session.html`), which Opengist serves as `text/html` so the self-contained session renders directly in a browser. The `HEAD` revision resolves to the latest commit (see the [Opengist docs](https://opengist.io/docs)). Because this raw-route behaviour is instance-specific, **verify it after upgrading Opengist** by creating a shared session and opening the link in a fresh browser — if your version doesn't accept `HEAD` on the raw route, share links will 404.
- Set `PI_SHARE_VIEWER_URL` to a custom (non-pi.dev) viewer to instead build a `<viewer>#<gistPageUrl>` link that a self-hosted viewer can render (see [Custom viewer](#custom-viewer)).

#### Custom viewer

The default (`github`) provider builds the `share_url` from the **pi.dev viewer** (`https://pi.dev/session/#<gistId>`). Point it at a custom viewer such as [`gistviewer.l3x.in`](https://gistviewer.l3x.in/) by setting the **`PI_SHARE_VIEWER_URL` environment variable** — no extra input is needed, and it's the same env var pi's interactive `/share` command reads. The resulting link is `<viewer>#<gistId>` (the viewer reads the gist ID from the URL fragment, just like pi.dev).

This env var is honoured by **both** providers, but in different ways:

- **`github`** provider — the link is `<viewer>#<gistId>` (always, even for the default pi.dev value).
- **`opengist`** provider — by default the `share_url` is a self-rendering raw-HTML link (the pi.dev viewer can't read non-GitHub gists). But when `PI_SHARE_VIEWER_URL` points at a **non-pi.dev** viewer, the link becomes `<viewer>#<gistPageUrl>` instead, so a self-hosted viewer that fetches a gist by URL can render Opengist sessions just like pi.dev renders GitHub ones. With the pi.dev default (or no env var) the raw self-rendering link is kept.

```yaml
- uses: shaftoe/pi-coding-agent-action@v2
  id: pi
  env:
    PI_SHARE_VIEWER_URL: https://gistviewer.l3x.in/   # custom viewer instead of pi.dev
  with:
    share_session: true
    github_token: ${{ secrets.GH_PAT }}               # PAT w/ gist scope — NOT secrets.GITHUB_TOKEN
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}

- name: Echo share link
  if: ${{ steps.pi.outputs.share_url }}
  run: echo "Session: ${{ steps.pi.outputs.share_url }}"
```

### Auto-Compaction

For complex, multi-step tasks that generate a lot of context (e.g. large code reviews, multi-file refactors), the conversation may grow too large for the model's context window. Enable `auto_compaction` to have Pi automatically summarize older messages when the context fills up:

```yaml
- uses: shaftoe/pi-coding-agent-action@v2
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: openai
    model: gpt-5.4
    token: ${{ secrets.OPENAI_API_KEY }}
    auto_compaction: true
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `auto_compaction` | Enable automatic context compaction when the conversation grows too large for the model's context window. Pi summarizes older messages to free up context space | No | `false` |
| `base_url` | Optional override for the provider base URL (e.g., to route traffic through a proxy or use an OpenAI-compatible gateway) | No | - |
| `branch_name_template` | Template for auto-generated branch names in `create_pull_request`. Supports variables: `{number}` (issue/PR number), `{timestamp}` (epoch ms), `{title}` (slugified PR title). Default: `pi/issue{number}-{timestamp}` | No | - |
| `diff_ignore_patterns` | Space-separated list of file patterns to exclude from PR diffs by default (e.g. `dist/ package-lock.json`). The agent can still provide additional patterns at call time | No | - |
| `diff_max_bytes` | Maximum diff size in bytes returned by the `get_pr_diff` tool | No | `102400` |
| `diff_max_lines` | Maximum number of diff lines returned by the `get_pr_diff` tool | No | `1000` |
| `export_session_html` | Export the session as a self-contained HTML file. Auto-enabled when `share_session` is true | No | `false` |
| `export_session_jsonl` | Export the session as a JSONL file (one JSON object per line) for programmatic consumption | No | `false` |
| `extensions` | Custom Pi extensions to load (one per line). Supports npm packages (npm:package-name), git repos (git:github.com/user/repo), or local file paths | No | - |
| `github_token` | GitHub token for API access. The default `GITHUB_TOKEN` works for all standard operations; to use `share_session`, provide a PAT/App token with gist scope instead | Yes | - |
| `load_builtin_extensions` | Whether to load built-in GitHub tools (see [Custom Tools](#custom-tools) for the full list) | No | `true` |
| `loaded_tools` | Controls which tools are available in the session. Defaults to `all`. Accepts a list of tool names (one per line) to load — unknown names cause the run to fail early | No | `all` |
| `model` | Model to use (e.g., gpt-5.4, gpt-4o, gemini-2.5-pro) | Yes | - |
| `platform` | Git hosting platform the action is running on: `github` (default), `codeberg`, `forgejo`, or `gitea` (alias for `forgejo`). Determines platform-specific behaviour such as the action-run URL format in the "View action run" footer. The platform is **no longer auto-detected** from the server URL — set it explicitly when running on Forgejo/Codeberg/Gitea (e.g. `platform: forgejo`) | No | `github` |
| `pr_number` | Pull request number to target. Use with `workflow_dispatch` to run the agent on a specific PR without a triggering event. When set, the action fetches PR context from the API and targets all operations at the specified PR | No | - |
| `prompt` | Optional prompt to send to the agent (skips comment extraction) | No | - |
| `provider` | LLM provider (openai, google, anthropic, etc.) | Yes | - |
| `share_session` | Share the session like pi's `/share` command: upload the exported HTML to a gist and surface a viewer link. Uses GitHub Gists by default (`share_gist_provider: github`) or a self-hosted Opengist instance. Auto-enables `export_session_html` | No | `false` |
| `share_gist_provider` | Storage backend for `share_session`: `github` (GitHub Gists + pi.dev viewer) or `opengist` (self-hosted instance; requires `share_gist_api_url`) | No | `github` |
| `share_gist_api_url` | API URL for the share gist provider. Required for `opengist` (e.g. `https://gist.l3x.in/api/gists`); optional override for `github` | No | - |
| `share_gist_token` | Token used to create the shared gist. Opengist access token (`og_…`, `gist:write` scope) for `opengist`; falls back to `github_token` | No | - |
| `server_url` | Override the forge server URL (e.g. `https://git.example.com`) when the runner-advertised `GITHUB_SERVER_URL` points at an internally-reachable host (e.g. `http://localhost:3000` on a Forgejo runner behind Docker). Affects user-facing links (commits, PRs, action runs) only — the API client keeps using the runner's `GITHUB_API_URL`, and platform selection is controlled by the `platform` input. | No | - |
| `thinking_level` | Model thinking level | No | off |
| `token` | Provider API token. Required for most providers, but can be omitted when using providers that support alternative auth mechanisms (e.g., `google-vertex` with Application Default Credentials) | No | - |
| `trigger` | Trigger phrase used to invoke the action | No | /pi  |

Refer to [Pi documentation](https://pi.dev/docs/latest) for the current list of supported providers / models / etc.

## Outputs

The action exposes the following outputs, which can be consumed by downstream steps or jobs:

| Output | Description | Example |
|--------|-------------|----------|
| `cost` | Cost of the invocation in USD (omitted if unavailable) | `0.042` |
| `duration_seconds` | Wall-clock duration of agent execution in seconds | `12.7` |
| `gist_id` | ID of the gist holding the shared session HTML — a GitHub Gist ID or Opengist UUID (when `share_session` succeeds) | `abc123def456` |
| `gist_url` | Gist page URL — GitHub Gist or Opengist (when `share_session` succeeds) | `https://gist.github.com/bot/abc123def456` |
| `input_tokens` | Number of input tokens consumed (omitted if unavailable) | `1500` |
| `output_tokens` | Number of output tokens generated (omitted if unavailable) | `800` |
| `response` | The main agent response text (or error message on failure) | `Here is the fix for the bug...` |
| `session_html_path` | Path to the exported session HTML file (when `export_session_html` is enabled, or when `share_session` is enabled) | `/tmp/pi-session-html/session.html` |
| `session_jsonl_path` | Path to the exported session JSONL file (when `export_session_jsonl` is enabled) | `/tmp/pi-session-jsonl/session.jsonl` |
| `share_url` | Shareable session link. GitHub provider: a viewer link (`https://pi.dev/session/#<gistId>`, or `<PI_SHARE_VIEWER_URL>#<gistId>` when the env var is set). Opengist provider: a self-rendering raw-HTML URL on the instance (or `<viewer>#<gistPageUrl>` when `PI_SHARE_VIEWER_URL` points at a custom viewer). When `share_session` succeeds | `https://pi.dev/session/#abc123def456` |
| `success` | Whether the agent completed successfully (`true` / `false`) | `true` |

> [!WARNING]
> Tokens and cost outputs are only set when the underlying provider returns session statistics. They will be absent for providers that don't report token usage.

## Custom Tools

The action extends Pi with the following built-in GitHub tools:

| Tool | Description |
|------|-------------|
| `create_pull_request_review` | Creates a pull request review with inline comments anchored to specific lines of the diff. Posts a GitHub Pull Request Review using the `pulls.createReview` API with comments positioned on specific file paths and line numbers. Supports multi-line comments, diff side selection (LEFT/RIGHT), and review events (COMMENT, APPROVE, REQUEST_CHANGES). |
| `create_pull_request` | Creates a new pull request by detecting file changes, creating a branch, committing changes via GitHub API, and opening the PR. Supports `dry_run` mode for testing without actual PR creation. |
| `get_ci_status` | Checks the CI/CD status for a pull request or commit ref. Returns both check runs and workflow runs with their statuses, conclusions, and URLs. Accepts optional `pull_number`, `ref`, `status`, and `conclusion` filters. For failed workflow runs, use the returned `run_id` with `get_workflow_run_logs` to fetch detailed job logs. |
| `get_issue_or_pr_thread` | Retrieves the full thread of an issue or pull request including title, body, state, labels, branch info (for PRs), all comments, and review comments (inline comments on specific lines of the diff) for PRs. Useful for understanding the full context before making changes. |
| `get_pr_diff` | Fetches the diff of a pull request on demand. Useful when the agent needs to understand what changed in a PR, e.g. for code reviews or addressing review feedback. Supports configurable `max_lines` truncation (default: 1000), max byte size cap (default: 100KB), and ignore patterns to filter out noisy paths. |
| `get_workflow_run_logs` | Fetches job logs for a specific GitHub Actions workflow run to diagnose CI failures. Lists all jobs for a run and downloads their logs, truncated to 50KB by default (configurable via `max_bytes`). |
| `update_pull_request` | Updates an existing pull request by pushing new commits to the PR branch and optionally updating the title and/or description. Supports `dry_run` mode for testing without actual modifications. |

> [!TIP]
> Set `load_builtin_extensions` input to `false` to disable custom tool auto loading.

## Goal

If all you want is running Pi inside a CI/CD environment technically you don't need any custom action, something like

```yaml
- uses: actions/setup-node@v6
- run: npm -g install @earendil-works/pi-coding-agent
- run: pi -p "do something useful for me"
```

might be just good enough and probably will always be the best fit for a pure "as minimalist as Pi" approach.

On the other hand that's true for almost everything which is offered by the Actions ecosystem, useful and popular Actions are mostly focused on providing **a pleasant UX around the raw core functionality** they provide.

This project goal is exactly that: to provide a short list of (opt-out) **opinionated default features** for interacting with and executing Pi agent sessions inside CI/CD environments compatible with GitHub API.

For all the rest you're free and encouraged to just configure the action environment as you would your *local* Pi instance, e.g. adding files to `~/.pi/agent/`, environment variables, etc., and more generally to compose workflow pipelines around this action's inputs and outputs to fullfill your specific needs.

Refer to [the official Pi documentation](https://pi.dev/docs/latest) to learn how to tweak Pi to best fit your needs.

## Disclaimer

> [!NOTE]
> Codeberg/Forgejo compatibility has been confirmed on self-hosted **Forgejo** instances, where the action runs the Pi agent as expected (at least in non-interactive mode). When running on Forgejo/Codeberg/Gitea, set the `platform` input (e.g. `platform: forgejo`) so platform-specific behaviour — such as the job-level action-run URL in the "View action run" footer — uses the correct format. Not every feature has been exercised yet on these platforms — PRs documenting additional coverage are welcome.

## Development

### Prerequisites

- Bun package manager
- Node.js 24+

### Validation

Before committing, run the following checks:

```bash
bun run validate
```

This runs:
- Code formatting (Prettier)
- Linting (ESLint)
- Type checking (TypeScript)
- Building

### Testing

The project uses `bun test` for testing:

```bash
# Run all tests
bun test

# Run tests with coverage
bun run test:coverage

# Watch mode for development
bun run test:watch

# Run end to end tests (requires LLM to be setup)
bun run test:e2e
```

### Project Guidelines

- Follow the existing code style and conventions
- Add tests for new functionality
- Update documentation as needed
- Use `bun` as the package manager (preferred over npm)
- Run `bun run validate` before committing

### Releasing

The project uses a `develop` → `v2` branching strategy with **fast-forward promotion only** (never a hard-reset).

#### Branches

- **`develop`** — default branch; all PRs target it. Every push runs [develop.yml](./.github/workflows/develop.yml): `validate` + unit tests + **e2e** + [Fallow](https://docs.fallow.tools/). Only when all of those are green does it rebuild `dist/` — committing a provenance message of the form `chore(dist): rebuild X.Y.Z-develop.<sha>` (recording the source SHA and bundled Pi SDK version) — and refresh README deps. Both auto-commits use `[skip ci]`.
- **`v2`** — release branch. It only ever advances via `git merge --ff-only` from `develop`. [release.yml](./.github/workflows/release.yml) runs the e2e gate, then `semantic-release` (version bump + clean `dist/` + tag + GitHub release), and finally fast-forwards the release commit **back into `develop`** so the two branches stay equal.

#### Cutting a release

The recommended path is the **Promote develop to v2** workflow (no PAT required, no double-runs):

1. **Actions → "Promote develop to v2" → Run workflow.** It fast-forwards `v2` to `develop@HEAD`, pushes `v2`, then calls `release.yml` as a reusable workflow to run the e2e gate + `semantic-release` + merge-back to `develop`. Needs to be run from the `v2` branch.
2. Optionally run it with **dry-run** first to confirm the fast-forward is clean (it fails loudly if `v2` has diverged from `develop`).

> [!NOTE]
> `semantic-release` is driven by [conventional commits](https://www.conventionalcommits.org/) (see [`.releaserc.json`](./.releaserc.json)). `feat:` → minor, `fix:`/`chore(deps):` → patch, `BREAKING CHANGE` → major. A `chore(dist)` promote/auto-commit is a non-releasable scope and will not itself trigger a release. If there are no new releasable commits since the last tag, `semantic-release` is a no-op.

### References

- Events that trigger workflows: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Webhook schema source: <https://github.com/octokit/webhooks/tree/main/payload-schemas/api.github.com>

## License

See [LICENSE](./LICENSE)

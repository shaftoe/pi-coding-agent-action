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

- **Issue assistance**: Prefix any new issue description and/or any issue comment with `/pi ` to have the agent analyze the issue, generate a report and/or create a new PR with the fix
- **PR assistance**: Prefix any PR comment, review comment or review message with `/pi ` to have the agent review the pull request and/or to apply further changes
- **Automated code reviews**: Have Pi review every new pull request automatically
- **Add Pi to your own pipelines**: (Optionally) generate prompt from upstream actions/workflows and have Pi do the work in background for you anywhere you like in your workflows
- **Minimal batteries included**: Tries to follow Pi minimalistic phylosophy while providing a comfortable UX out of the box, e.g. pretty print of logs, auto replies to comments, and tools to interact efficiently with git and GitHub-compatible APIs.

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
> Codeberg/Forgejo compatibility _should_ work but hasn't been tested yet.

## Securing your workflows

> [!WARNING]
> Depending on the permissions assigned to your workflow you should consider restricting who's allowed to trigger it e.g. filtering for GitHub user name or role (`if github.actor == '<my-user>'`).

> [!IMPORTANT]
> The `develop` and `v2` branches are in constant development so if you don't want the bleeding edge you should pin to the latest release, e.g.
> ```yaml
>    uses: shaftoe/pi-coding-agent-action@v2.19.3
> ```

> [!CAUTION]
> **GitHub `GITHUB_TOKEN` cannot push changes to files under `.github/workflows/`.** This is a [GitHub security restriction](https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication) — even when the workflow has `contents: write` permission, the automatic `GITHUB_TOKEN` is **never** allowed to create or modify workflow files. If you need Pi to create PRs that touch `.github/workflows/*.yml`, you must provide a [Personal Access Token (PAT)](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) with the `workflow` scope instead of the default `GITHUB_TOKEN`.

## Bundled Dependencies

The action is bundled into a single `dist/index.js` via [esbuild](https://esbuild.github.io/) so no `node_modules` are needed at runtime. Non-code Pi SDK assets (HTML templates, theme JSON) are copied to `dist/pi-sdk/` and resolved via the `PI_PACKAGE_DIR` environment variable.

Dependencies (including Pi itself) are [updated regularly](./.github/workflows/daily-deps-update.yml) to keep up with new releases.

<!-- DEPS_TABLE_START -->

| Dependency | Version | Description |
|---|---|---|
| `@actions/core` | `3.0.1` | GitHub Actions core I/O (inputs, outputs, logging) |
| `@actions/github` | `9.1.1` | GitHub API client (Octokit wrapper) |
| `@earendil-works/pi-agent-core` | `0.78.1` | Pi Agent Core — agent orchestration primitives |
| `@earendil-works/pi-ai` | `0.78.1` | Pi AI — AI model abstractions and providers |
| `@earendil-works/pi-coding-agent` | `0.78.1` | Pi SDK — AI coding agent runtime |
| `@js-temporal/polyfill` | `0.5.1` | Temporal API polyfill |
| `@octokit/plugin-rest-endpoint-methods` | `17.0.0` | Octokit REST API endpoint methods |
| `ignore` | `7.0.5` | `.gitignore`-style pattern matching |
| `typebox` | `1.2.1` | JSON Schema Type Builder |

<!-- DEPS_TABLE_END -->

> _This table is auto-updated by the [`package.yml`](./.github/workflows/package.yml) workflow whenever dependencies change._

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

### Selecting a Model per Trigger

A common need is to keep a **fallback model** handy — e.g. to re-trigger a job when the default model's quota is exhausted, or to reach for a stronger/cheaper model on demand. This can be achieved purely at the **workflow level**, with **no change to the action**, by exploiting two facts:

1. The action exposes a `trigger` input (default `/pi `) that defines the prefix stripped from the comment to obtain the prompt.
2. A workflow can run multiple jobs, each gated on a different comment prefix and each wiring a different provider/model/token.

The trick is to pair each trigger with a dedicated set of GitHub **Variables** (`PROVIDER`/`MODEL`) and **Secrets** (API key). The suffix mirrors the trigger so everything maps 1:1:

| Trigger  | Variables              | Secret        |
|----------|------------------------|---------------|
| `/pi `   | `PROVIDER`, `MODEL`    | `API_KEY`     |
| `/pi2 `  | `PROVIDER2`, `MODEL2`  | `API_KEY2`    |

Note that `/pi2 ` does **not** match `startsWith('/pi ')` (the 4th character is `2`, not a space), so the two triggers are mutually exclusive — exactly one job runs per comment.

```yaml
name: Pi Agent (multi-model)

on:
  issue_comment:
    types: [created]

permissions:
  contents: write
  pull-requests: write
  issues: write

jobs:
  # Default model — invoked with `/pi `
  pi-default:
    if: startsWith(github.event.comment.body, '/pi ')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - uses: shaftoe/pi-coding-agent-action@v2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: ${{ vars.PROVIDER }}
          model: ${{ vars.MODEL }}
          token: ${{ secrets.API_KEY }}
          trigger: '/pi '   # strips `/pi ` from the comment to get the prompt

  # Alternative model — invoked with `/pi2 `
  pi-alternative:
    # Skipped automatically when the alternative isn't configured
    if: startsWith(github.event.comment.body, '/pi2 ') && vars.PROVIDER2 != ''
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - uses: shaftoe/pi-coding-agent-action@v2
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: ${{ vars.PROVIDER2 }}
          model: ${{ vars.MODEL2 }}
          token: ${{ secrets.API_KEY2 }}
          trigger: '/pi2 '   # strips `/pi2 ` from the comment instead
```

Now a comment like `/pi2 retry with the fallback model` runs against the alternative provider, while `/pi ...` keeps using the default — no workflow edits required to switch.

> [!TIP]
> The same pattern scales to more variants (`/pi3 ` → `PROVIDER3`/`MODEL3`/`API_KEY3`, etc.). The examples in this repository's own [`pi.yml`](./.github/workflows/pi.yml) workflow use exactly this technique with a reusable workflow.

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

## Quick Start

Create a workflow file, e.g., `.github/workflows/pi-agent.yml`. See the [interactive](./.github/workflows/pi.yml) and [non-interactive](./.github/workflows/pr.yml) workflows in this repository to get started.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `base_url` | Optional override for the provider base URL (e.g., to route traffic through a proxy or use an OpenAI-compatible gateway) | No | - |
| `branch_name_template` | Template for auto-generated branch names in `create_pull_request`. Supports variables: `{number}` (issue/PR number), `{timestamp}` (epoch ms), `{title}` (slugified PR title). Default: `pi/issue{number}-{timestamp}` | No | - |
| `diff_ignore_patterns` | Space-separated list of file patterns to exclude from PR diffs by default (e.g. `dist/ package-lock.json`). The agent can still provide additional patterns at call time | No | - |
| `diff_max_bytes` | Maximum diff size in bytes returned by the `get_pr_diff` tool | No | `102400` |
| `diff_max_lines` | Maximum number of diff lines returned by the `get_pr_diff` tool | No | `1000` |
| `auto_compaction` | Enable automatic context compaction when the conversation grows too large for the model's context window. Pi summarizes older messages to free up context space | No | `false` |
| `export_session_html` | Export the session as a self-contained HTML file | No | `false` |
| `export_session_jsonl` | Export the session as a JSONL file (one JSON object per line) for programmatic consumption | No | `false` |
| `extensions` | Custom Pi extensions to load (one per line). Supports npm packages (npm:package-name), git repos (git:github.com/user/repo), or local file paths | No | - |
| `github_token` | GitHub token for API access | Yes | - |
| `load_builtin_extensions` | Whether to load built-in GitHub tools (see [Custom Tools](#custom-tools) for the full list) | No | `true` |
| `loaded_tools` | Controls which tools are available in the session. Defaults to `all`. Accepts a list of tool names (one per line) to load — unknown names cause the run to fail early | No | `all` |
| `model` | Model to use (e.g., gpt-5.4, gpt-4o, gemini-2.5-pro) | Yes | - |
| `prompt` | Optional prompt to send to the agent (skips comment extraction) | No | - |
| `provider` | LLM provider (openai, google, anthropic, etc.) | Yes | - |
| `thinking_level` | Model thinking level (off\|low\|medium\|high) | No | off |
| `token` | Provider API token. Required for most providers, but can be omitted when using providers that support alternative auth mechanisms (e.g., `google-vertex` with Application Default Credentials) | No | - |
| `trigger` | Trigger phrase used to invoke the action | No | /pi  |

Refer to [Pi documentation](https://pi.dev/docs/latest) for the current list of supported providers / models / etc.

## Outputs

The action exposes the following outputs, which can be consumed by downstream steps or jobs:

| Output | Description | Example |
|--------|-------------|----------|
| `cost` | Cost of the invocation in USD (omitted if unavailable) | `0.042` |
| `duration_seconds` | Wall-clock duration of agent execution in seconds | `12.7` |
| `input_tokens` | Number of input tokens consumed (omitted if unavailable) | `1500` |
| `output_tokens` | Number of output tokens generated (omitted if unavailable) | `800` |
| `response` | The main agent response text (or error message on failure) | `Here is the fix for the bug...` |
| `session_html_path` | Path to the exported session HTML file (when `export_session_html` is enabled) | `/tmp/pi-session-html/session.html` |
| `session_jsonl_path` | Path to the exported session JSONL file (when `export_session_jsonl` is enabled) | `/tmp/pi-session-jsonl/session.jsonl` |
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

The project uses a `develop` → `v2` branching strategy:

- **`develop`** is the default branch. All PRs target it. The `package.yml` workflow auto-commits `dist/` changes here.
- **`v2`** is the release branch. Merges into `v2` trigger [release.yml](./.github/workflows/release.yml), which runs tests and `semantic-release`.

To cut a release:

```bash
git switch v2
git merge develop
git push origin v2
```

### References

- Events that trigger workflows: <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows>
- Webhook schema source: <https://github.com/octokit/webhooks/tree/main/payload-schemas/api.github.com>

## License

See [LICENSE](./LICENSE)

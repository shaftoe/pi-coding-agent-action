# Pi Coding Agent GitHub Action

This is a GitHub action that uses the [pi coding agent](https://pi.dev) to integrate with GitHub usual workflows (issues, pull requests, etc.).

## Features

- **Issue assistance**: Type `/pi` in an issue comment to have the agent analyze the issue and create a fix
- **PR assistance**: Type `/pi` in a PR comment to have the agent review and improve the pull request
- **Customizable**: Configure LLM provider, model, trigger phrases, and custom prompts
- **Automated commits**: The agent can make changes, commit them, and create PRs automatically
- **Hybrid architecture**: Uses `isomorphic-git` for local git operations and `gh` CLI for GitHub API

## Usage

### Basic Setup

1. Create a workflow file in `.github/workflows/pi-agent.yml`:

```yaml
name: Pi Agent

on:
  issue_comment:
    types: [created]
  issues:
    types: [opened]
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  pi-agent:
    if: |
      github.event_name == 'issue_comment' &&
      contains(github.event.comment.body, '/pi')
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run pi agent
        uses: ./ # or your-org/pi-coding-agent-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: anthropic
          model: claude-sonnet-4-5
```

### Required Secrets

The action requires API keys for your chosen LLM provider. Set these in your repository secrets:

- `ANTHROPIC_API_KEY` (if using Anthropic)
- `OPENAI_API_KEY` (if using OpenAI)
- `GOOGLE_API_KEY` (if using Google)

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github_token` | GitHub token for API access | Yes | `${{ github.token }}` |
| `provider` | LLM provider (anthropic, openai, google) | No | `anthropic` |
| `model` | Model to use | No | `claude-sonnet-4-5` |
| `mentions` | Comma-separated trigger phrases | No | `/pi` |
| `prompt` | Custom system prompt | No | - |
| `extra_tools` | Extra pi tools to enable | No | - |
| `env_vars` | Custom environment variables (one KEY=VALUE per line) | No | - |

### Example Workflows

#### Issue Flow

```yaml
on:
  issue_comment:
    types: [created]

jobs:
  pi-agent:
    if: contains(github.event.comment.body, '/pi')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./your-org/pi-coding-agent-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

When you comment `/pi fix the login bug`, the agent:
1. Reads the issue context
2. Creates a new branch
3. Makes code changes
4. Creates a PR with the fix

#### Using Custom Environment Variables

Some LLM providers require specific environment variable names. Use the `env_vars` input to inject them:

```yaml
- name: Run pi agent
  uses: ./your-org/pi-coding-agent-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    provider: anthropic
    env_vars: |
      ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}
      ZAI_API_KEY=${{ secrets.ZAI_API_KEY }}
```

See [ENV_VARS_FEATURE.md](ENV_VARS_FEATURE.md) for more details and supported providers.

#### PR Flow

```yaml
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  pi-agent:
    if: contains(github.event.comment.body, '/pi')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: shaftoe/pi-coding-agent-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
```

When you comment `/pi review this PR`, the agent:
1. Reads the PR context including files, comments, reviews
2. Makes improvements to the code
3. Commits and pushes to the PR branch

## Architecture

The action uses a hybrid architecture:

| Operation | Tool |
|------------|-------|
| Fetch issue/PR data | `gh` CLI |
| Create comments | `gh` CLI |
| Create PR | `gh` CLI |
| Checkout branch | isomorphic-git |
| Stage files | isomorphic-git |
| Commit changes | isomorphic-git |
| Push to remote | isomorphic-git |

### Why Hybrid?

- **`gh` CLI**: Pre-installed, simple, official GitHub tool for API calls
- **`isomorphic-git`**: Pure JavaScript, async, type-safe for local git operations

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Development

### Prerequisites

- Bun

### Build

```bash
# Install dependencies
bun install

# Compile TypeScript
bun run build

# Bundle with esbuild
bun run package
```

### Project Structure

```
.
├── src/
│   ├── index.ts          # Main orchestration
│   ├── types.ts          # TypeScript interfaces
│   ├── utils.ts          # Utility functions
│   ├── gh.ts             # GitHub CLI operations
│   ├── git.ts            # isomorphic-git operations
│   ├── prompts.ts        # Prompt builders
│   └── pi.ts             # Pi agent operations
├── dist/
│   └── index.js          # Compiled and bundled action
├── action.yml            # Action metadata
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── README.md             # This file
```

## License

MIT

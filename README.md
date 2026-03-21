# Pi Coding Agent GitHub Action

This is a GitHub action that uses the [pi coding agent](https://pi.dev) to integrate with GitHub workflows (issues, pull requests, etc.).

## Features

- **Issue assistance**: Type `/pi` in an issue comment to have the agent analyze the issue and create a fix
- **PR assistance**: Type `/pi` in a PR comment to have the agent review and improve the pull request
- **Customizable**: Configure LLM provider, model, trigger phrases, custom prompts, and environment variables
- **Automated commits**: The agent can make changes, commit them, and create PRs automatically
- **Hybrid architecture**: Uses `isomorphic-git` for local git operations and `gh` CLI for GitHub API
- **Flexible LLM support**: Support for various providers via custom environment variable injection

## Usage

### Quick Start

Create a workflow file in `.github/workflows/pi-agent.yml`:

```yaml
name: Pi AI Agent

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
    # Only run when the comment contains /pi (or custom trigger)
    if: |
      github.event_name == 'issue_comment' &&
      contains(github.event.comment.body, '/pi')
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Fetch full history for better context

      - name: Run pi agent
        uses: ./your-org/pi-coding-agent-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: anthropic
          model: claude-sonnet-4-5
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github_token` | GitHub token for API access | Yes | `${{ github.token }}` |
| `provider` | LLM provider (anthropic, openai, google, etc.) | No | `anthropic` |
| `model` | Model to use (e.g., claude-sonnet-4-5, gpt-4o, gemini-2.5-pro) | No | `claude-sonnet-4-5` |
| `mentions` | Comma-separated trigger phrases (case-insensitive) | No | `/pi` |
| `prompt` | Custom system prompt for the AI | No | - |
| `extra_tools` | Extra pi tools to enable (on top of read,write,edit,bash) | No | - |
| `env_vars` | Custom environment variables (one KEY=VALUE per line) | No | - |

## Environment Variables

### Required Secrets

You must set API keys for your chosen LLM provider as repository secrets:

| Provider | Secret Name | Environment Variable |
|----------|---------------|---------------------|
| Anthropic | `ANTHROPIC_API_KEY` | Set automatically via `env_vars` |
| OpenAI | `OPENAI_API_KEY` | Set automatically via `env_vars` |
| Google AI | `GOOGLE_API_KEY` | Set automatically via `env_vars` |
| Z.ai | `ZAI_API_KEY` | Set automatically via `env_vars` |

### Custom Environment Variables

The `env_vars` input allows injecting custom environment variables into the `pi` agent. Format is one `KEY=VALUE` pair per line:

```yaml
env_vars: |
  ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}
  ZAI_API_KEY=${{ secrets.ZAI_API_KEY }}
  OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }}
```

**Common Pi Environment Variables:**
- `ZAI_API_KEY` - Z.ai
- `ANTHROPIC_API_KEY` / `ANTHROPIC_KEY` - Anthropic
- `OPENAI_API_KEY` - OpenAI
- `GOOGLE_API_KEY` - Google AI
- `DEEPSEEK_API_KEY` - DeepSeek
- `GROQ_API_KEY` - Groq
- `MISTRAL_API_KEY` - Mistral
- `OPENROUTER_API_KEY` - OpenRouter

See [ENV_VARS_FEATURE.md](ENV_VARS_FEATURE.md) for more details.

## Example Workflows

### Complete Production Workflow

```yaml
name: Pi AI Agent

on:
  issue_comment:
    types: [created]
  issues:
    types: [opened, edited]
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  pi-agent:
    # Only run when comment contains trigger
    if: |
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '/pi')) ||
      (github.event_name == 'issue_comment' && contains(github.event.comment.body, '@pi-bot'))
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run pi agent
        uses: shaftoe/pi-coding-agent-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: anthropic
          model: claude-sonnet-4-5
          env_vars: |
            ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}
```

### Workflow with Multiple Providers

```yaml
name: Pi AI Agent

on:
  issue_comment:
    types: [created]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  pi-agent:
    if: contains(github.event.comment.body, '/pi')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: your-org/pi-coding-agent-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: zai
          model: zai-pro-05b
          env_vars: |
            ZAI_API_KEY=${{ secrets.ZAI_API_KEY }}
```

### Workflow for PR Reviews

```yaml
name: PR Review Assistant

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  pi-review:
    if: contains(github.event.comment.body, '/pi review')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: your-org/pi-coding-agent-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: anthropic
          model: claude-sonnet-4-5
```

### Workflow with Custom Model and Tools

```yaml
name: Pi Agent with Custom Configuration

on:
  issue_comment:
    types: [created]

permissions:
  contents: write
  issues: write

jobs:
  pi-agent:
    if: contains(github.event.comment.body, '/pi')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: your-org/pi-coding-agent-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          provider: openai
          model: gpt-4-turbo
          extra_tools: "git,docker"
          prompt: |
            You are a helpful code reviewer. Focus on finding bugs and suggesting improvements.
```

## How It Works

### Issue Flow

1. User comments `/pi [instructions]` in an issue
2. Action fetches issue context via GitHub CLI
3. Creates a new branch: `pi/issue{number}-{timestamp}`
4. Runs `pi` agent with the issue context
5. If changes are made:
   - Stages all modified files
   - Commits with AI-generated summary
   - Pushes to remote
   - Creates a new PR
6. Posts result as a comment

### PR Flow

1. User comments `/pi [instructions]` in a PR
2. Action fetches PR context via GitHub CLI
3. Checks out the PR branch (or fork branch)
4. Runs `pi` agent with the PR context
5. If changes are made:
   - Stages all modified files
   - Commits with AI-generated summary
   - Pushes to the PR branch
6. Posts result as a comment

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
| Check dirty status | isomorphic-git |

### Why This Hybrid Approach?

- **`gh` CLI**: Pre-installed, simple, official GitHub tool for API calls
- **`isomorphic-git`**: Pure JavaScript, async, type-safe for local git operations

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Development

### Prerequisites

- Bun package manager

### Build

```bash
# Install dependencies
bun install

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

## Troubleshooting

### Action Not Running

- Ensure `github.event_name` matches your workflow triggers
- Verify the comment contains your trigger phrase (`/pi` by default)
- Check that the `permissions` section includes necessary scopes

### Pi Agent Errors

- Verify API keys are set as repository secrets
- Check the `provider` and `model` inputs are valid
- Ensure the `env_vars` input is formatted correctly

### Git Issues

- Ensure `contents: write` permission is granted
- Check that the repository is not empty
- Verify the default branch exists

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) - Detailed architecture documentation
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contributor guidelines
- [ENV_VARS_FEATURE.md](ENV_VARS_FEATURE.md) - Environment variables documentation
- [FILE_OVERVIEW.md](FILE_OVERVIEW.md) - Module overview and usage

## License

MIT

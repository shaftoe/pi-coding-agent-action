# Pi Coding Agent GitHub Action

This is a GitHub action that uses the [pi coding agent](https://pi.dev) to integrate with GitHub workflows (issues, pull requests, etc.).

## Features

- **Issue assistance**: Type `/pi` in an issue comment to have the agent analyze the issue and create a fix
- **PR assistance**: Type `/pi` in a PR comment to have the agent review and improve the pull request
- **Customizable**: Configure LLM provider, model, trigger phrases, custom prompts, and environment variables
- **Automated commits**: The agent can make changes, commit them, and create PRs automatically
- **Flexible LLM support**: Support for various providers via custom environment variable injection

## Usage

Example:

```yaml
    - uses: shaftoe/pi-coding-agent-action@v1
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        provider: my-provider
        model: some-model
        env_vars: |
          PROVIDER_API_KEY=${{ secrets.PROVIDER_API_KEY }}
```

### Quick Start

Create a workflow file in `.github/workflows/pi-agent.yml`. See the [example](./.github/workflows/pi.yml) file in this very repository to get started.

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

See Pi [supported providers](https://github.com/badlogic/pi-mono/tree/main/packages/ai#supported-providers) for the full list.

### Custom Environment Variables

The `env_vars` input allows injecting custom environment variables into the `pi` agent. Format is one `KEY=VALUE` pair per line:

```yaml
env_vars: |
  ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}
  ZAI_API_KEY=${{ secrets.ZAI_API_KEY }}
  OPENAI_API_KEY=${{ secrets.OPENAI_API_KEY }}
```

## Development

### Running Tests

This project uses Bun's built-in test runner. See [TESTING.md](./TESTING.md) for detailed testing documentation.

```bash
# Run all tests
bun test

# Run tests with coverage
bun test --coverage

# Run tests in watch mode
bun test --watch
```

### Validation

Before committing, the following checks run automatically (via Lefthook):
- Code formatting (Prettier)
- Linting (ESLint)
- Type checking (TypeScript)
- Tests
- Building

To run all validations manually:

```bash
bun run validate
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

## License

See [LICENSE](./LICENSE)

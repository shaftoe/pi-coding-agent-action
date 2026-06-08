# `@alexanderfortin/pi-cli`

> Terminal client for the [Pi orchestrator](../pi-orchestrator).

This package provides a local terminal frontend for the Pi agent, enabling a
**seamless mixed CLI/GitHub workflow**. The same agent + tool set used by the
[GitHub Action](https://github.com/shaftoe/pi-coding-agent-action) is available
from the command line, and GitHub issue/PR threads serve as persistent agent
memory across CLI and Action invocations.

**Status:** M2 — issue/PR-aware runs with thread context, git remote detection,
and interactive system prompt. See [`docs/rfc/cli-extension-constitution.md`](../../docs/rfc/cli-extension-constitution.md)
for the full roadmap.

---

## What it does

### `pi-cli run` — Free-form prompt (M1)

Runs the agent with a free-form prompt against any GitHub-compatible repo.
Output goes to stdout; thinking deltas go to stderr. No thread persistence.

```bash
pi-cli run "explain what packages/pi-orchestrator does" \
  --repo shaftoe/pi-coding-agent-action \
  --provider anthropic \
  --model claude-sonnet-4-5
```

### `pi-cli issue <number>` — Issue-aware run (M2)

Runs the agent against a specific GitHub issue with **full thread context**
(title, body, all comments). The agent reads all prior comments as its "memory"
and can post its response as a comment on the issue.

```bash
pi-cli issue 277 \
  --repo shaftoe/pi-coding-agent-action \
  --provider anthropic \
  --model claude-sonnet-4-5 \
  "implement the CLI constitution"
```

If `--repo` is omitted, it is auto-detected from the git remote in the current
directory. If no instruction is provided, the issue body is used.

### `pi-cli pr <number>` — PR-aware run (M2)

Runs the agent against a specific GitHub PR with full thread context **plus the
diff and CI status**. The agent can push commits, post reviews, and fix CI
failures — the same capabilities as when running in the GitHub Action.

```bash
pi-cli pr 280 \
  --repo shaftoe/pi-coding-agent-action \
  --provider anthropic \
  --model claude-sonnet-4-5 \
  --ci-aware \
  "fix the failing CI"
```

### Mixed workflow example

```
1. pi-cli issue 277 --repo org/repo "implement auth module"
   → Agent creates a branch, implements, opens PR #280

2. CI fails (lint error)

3. pi-cli pr 280 --repo org/repo "fix the lint errors"
   → Agent reads thread (its own prior comment), sees CI failure, fixes and pushes

4. Merge from GitHub web/mobile — or continue in CLI
```

---

## Flags

### `run <prompt>`

| Flag | Required | Description |
| --- | --- | --- |
| `<prompt>` (positional) | ✅ | The instruction to send to the agent. |
| `--repo <owner/repo>` | ✅ | Target repository. |
| `--provider <id>` | ✅ | LLM provider id. |
| `--model <id>` | ✅ | LLM model id. |
| `--cwd <path>` | no | Working directory. Default: `process.cwd()`. |
| `--server-url <url>` | no | Git host URL. Default: `https://github.com`. |
| `--verbose` | no | Debug-level logs. Mutually exclusive with `--quiet`. |
| `--quiet` | no | Errors only. Mutually exclusive with `--verbose`. |

### `issue <number>`

| Flag | Required | Description |
| --- | --- | --- |
| `<number>` (positional) | ✅ | Issue or PR number to target. |
| `[instruction]` (positional) | no | Instruction override (uses issue body if omitted). |
| `--repo <owner/repo>` | no | Target repo (auto-detected from git remote if omitted). |
| `--provider <id>` | ✅ | LLM provider id. |
| `--model <id>` | ✅ | LLM model id. |
| `--post-comment` / `--no-post-comment` | no | Post response as GitHub comment. Default: `--post-comment`. |
| `--max-comments <n>` | no | Max thread comments to fetch. Default: 100. |
| `--cwd <path>` | no | Working directory. Default: `process.cwd()`. |
| `--server-url <url>` | no | Git host URL. Default: `https://github.com`. |
| `--verbose` / `--quiet` | no | Log level control. |

### `pr <number>`

| Flag | Required | Description |
| --- | --- | --- |
| `<number>` (positional) | ✅ | PR number to target. |
| `[instruction]` (positional) | no | Instruction override. |
| `--repo <owner/repo>` | no | Target repo (auto-detected from git remote if omitted). |
| `--provider <id>` | ✅ | LLM provider id. |
| `--model <id>` | ✅ | LLM model id. |
| `--post-comment` / `--no-post-comment` | no | Post response as GitHub comment. Default: `--post-comment`. |
| `--include-diff` / `--no-include-diff` | no | Include PR diff in context. Default: `--include-diff`. |
| `--ci-aware` / `--no-ci-aware` | no | Include CI status in context. Default: `--ci-aware`. |
| `--max-comments <n>` | no | Max thread comments to fetch. Default: 100. |
| `--cwd <path>` | no | Working directory. Default: `process.cwd()`. |
| `--server-url <url>` | no | Git host URL. Default: `https://github.com`. |
| `--verbose` / `--quiet` | no | Log level control. |

---

### Authentication

Two env vars are required, no flags, no `gh auth token` fallback:

| Concern | Env vars (first match wins) |
| --- | --- |
| GitHub API | `GITHUB_TOKEN`, then `GH_TOKEN` |
| LLM provider | Provider-specific (see table below) |

#### Provider env table

| Provider id | Env var |
| --- | --- |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `google` | `GEMINI_API_KEY` |
| `deepseek` | `DEEPSEEK_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `zai` | `ZAI_API_KEY` |
| `mistral` | `MISTRAL_API_KEY` |
| `xai` | `XAI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `huggingface` | `HF_TOKEN` |
| `together` | `TOGETHER_API_KEY` |
| `fireworks` | `FIREWORKS_API_KEY` |
| `cerebras` | `CEREBRAS_API_KEY` |
| `nvidia` | `NVIDIA_API_KEY` |
| `azure-openai-responses` | `AZURE_OPENAI_API_KEY` |
| `cloudflare-ai-gateway` | `CLOUDFLARE_API_KEY` |
| `cloudflare-workers-ai` | `CLOUDFLARE_API_KEY` |
| `vercel-ai-gateway` | `AI_GATEWAY_API_KEY` |
| `opencode`, `opencode-go` | `OPENCODE_API_KEY` |
| `kimi-coding` | `KIMI_API_KEY` |
| `minimax` | `MINIMAX_API_KEY` |
| `minimax-cn` | `MINIMAX_CN_API_KEY` |
| `xiaomi` | `XIAOMI_API_KEY` |
| `xiaomi-token-plan-cn` | `XIAOMI_TOKEN_PLAN_CN_API_KEY` |
| `ant-ling` | `ANT_LING_API_KEY` |
| `zai-coding-cn` | `ZAI_CODING_CN_API_KEY` |

(Missing one? The full list with notes is in `src/auth.ts`.)

## Architecture

The CLI is a frontend to the same `pi-orchestrator` + `pi-platform-github` stack
that the GitHub Action uses. No separate business logic — only CLI-specific
adapters for logging, output, and context construction.

```
pi-cli (frontend)
  ├── pi-orchestrator (agent orchestration, PlatformProvider interface)
  └── pi-platform-github (GitHub/Codeberg/Forgejo implementation)
```

Key M2 additions:

- **`interactive/context-builder.ts`** — builds `PlatformContext` from issue/PR number
- **`interactive/prompt-builder.ts`** — enriches prompts with thread/diff/CI context
- **`interactive/git-detection.ts`** — auto-detects `--repo` from git remote
- **`interactive/interactive-system-prompt.ts`** — system prompt for mixed CLI/GitHub mode
- **`commands/issue.ts`** — `pi-cli issue <number>` command
- **`commands/pr.ts`** — `pi-cli pr <number>` command

## Tests

```bash
bun test packages/pi-cli/
```

## Roadmap

See [`docs/rfc/cli-extension-constitution.md`](../../docs/rfc/cli-extension-constitution.md) for the full milestone plan:

- **M1** ✅ — Free-form `run` command
- **M2** ✅ — Issue/PR-aware runs with thread context
- **M3** — Review, thread inspection, workflow dispatch, interactive chat
- **M4** — npm publishing, shell completions, config file

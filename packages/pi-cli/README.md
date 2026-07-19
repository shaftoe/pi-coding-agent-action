# `@alexanderfortin/pi-cli`

> **Proof-of-concept** terminal client for the [Pi orchestrator](../pi-orchestrator).

This package demonstrates that the core business logic in
`@alexanderfortin/pi-orchestrator` and `@alexanderfortin/pi-platform-github` is
truly frontend-agnostic by wiring it up from a second entry point (a local
terminal) alongside the primary GitHub Action frontend.

**Status:** Proof of concept — feature-complete for the validation goal, not
under active development. The learnings from this package will feed into a
dedicated Pi extension that lets Pi drive development via the GitHub Action
from within the agent itself.

---

## What it does

`pi-cli run "<prompt>"` runs the same agent + tool set as the
[GitHub Action](https://github.com/shaftoe/pi-coding-agent-action) against any
GitHub-compatible repo, from a local shell. Output goes to stdout; thinking
deltas go to stderr.

### Flags

| Flag | Required | Description |
| --- | --- | --- |
| `<prompt>` (positional) | ✅ | The instruction to send to the agent. |
| `--repo <owner/repo>` | ✅ | Target repository, e.g. `shaftoe/pi-coding-agent-action`. |
| `--provider <id>` | ✅ | LLM provider id — see the [provider env table](#provider-env-table) below. |
| `--model <id>` | ✅ | LLM model id (e.g. `claude-sonnet-4-5`). |
| `--cwd <path>` | no | Working directory for the agent. Default: `process.cwd()`. |
| `--server-url <url>` | no | Git host server URL. Default: `https://github.com`. |
| `--verbose` | no | Show debug-level logs on stderr. Mutually exclusive with `--quiet`. |
| `--quiet` | no | Suppress all logs except errors. Mutually exclusive with `--verbose`. |
| `-h, --help` | no | Show help. |

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

## Usage

```bash
export GITHUB_TOKEN=ghp_...
export ANTHROPIC_API_KEY=sk-ant-...

pnpm run pi-cli run "explain what packages/pi-orchestrator does" \
  --repo shaftoe/pi-coding-agent-action \
  --provider anthropic \
  --model claude-sonnet-4-5
```

## Tests

```bash
vitest run packages/pi-cli/
```

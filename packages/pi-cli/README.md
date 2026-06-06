# `@alexanderfortin/pi-cli`

> Terminal frontend for the Pi orchestrator. Runs the same agent + tools as the [GitHub Action](https://github.com/shaftoe/pi-coding-agent-action), from a local shell.

**Status:** M1 — internal-only, workspace package. Public npm release + bundling are tracked as milestone M4 in the [design RFC](../../docs/plans/cli-frontend.md).

---

## What M1 does

`pi-cli run "<prompt>"` against any GitHub-compatible repo, with the same toolset as the GitHub Action (`get_pr_diff`, `get_ci_status`, `create_pull_request`, etc.). Output goes to stdout. Thinking deltas go to stderr.

Nothing else. The full feature matrix (`--pr`, `--issue`, `--post-comment`, `--export-session-html`, `review`, `thread`, etc.) lands in M2 / M3.

## Install (workspace only, M1)

From a clone of this repo:

```bash
bun install
```

## Usage

```bash
export GITHUB_TOKEN=ghp_...
export ANTHROPIC_API_KEY=sk-ant-...

bun pi-cli run "explain what packages/pi-orchestrator does" \
  --repo shaftoe/pi-coding-agent-action \
  --provider anthropic \
  --model claude-sonnet-4-5
```

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

Sourced from [`pi/docs/providers.md`](https://docs.pi.dev/providers):

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

## Tests

```bash
bun test packages/pi-cli/
```

## Roadmap

- **M2** — full flag matrix: `--pr`, `--issue`, `--post-comment`, `--add-reaction`, `--system-prompt`, `--export-session-*`, all diff flags, `--out json|none`.
- **M3** — `review` and `thread` subcommands; remote URL auto-detection from `git remote get-url origin`; promote shared `GitAdapter` helper into `pi-orchestrator`.
- **M4** — esbuild bundle; `private: false`; first npm release.

See [`docs/plans/cli-frontend.md`](../../docs/plans/cli-frontend.md) for the full RFC.

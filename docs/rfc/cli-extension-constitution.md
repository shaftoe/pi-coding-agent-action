# RFC: Pi CLI Extension — Mixed CLI/GitHub Workflow

> **Status:** Draft  
> **Issue:** #277  
> **Package:** `packages/pi-cli`

---

## 1. Vision

Enable developers to drive feature development through a **seamless mixed workflow** that spans local terminal (`pi-cli`) and GitHub's web/mobile interface. A developer starts working on an issue locally, pushes a branch, hands off to CI, reviews results on GitHub, continues in the terminal — and the agent maintains full context across every handoff.

**GitHub threads and PR reviews act as persistent agent memory.** The CLI doesn't need to replicate session state management — it reads context from the same thread the agent already knows.

## 2. Guiding Principles

1. **Thread-as-memory**: GitHub issue/PR threads ARE the conversation history. The CLI never maintains its own hidden state — it reads from and writes to the same threads the GitHub Action uses. Every `pi-cli` invocation can pick up where the last Action run left off.

2. **Symmetric capabilities**: Every operation available in the GitHub Action is available from the CLI, and vice versa. The `PlatformProvider` abstraction already guarantees this at the tool level.

3. **CI/CD as continuation**: A `pi-cli` run that creates a PR triggers CI. When CI fails, the developer can invoke `pi-cli` again targeting the same PR — the agent reads the thread (including its own prior comments), fetches CI status and logs, and continues autonomously.

4. **Platform abstraction**: All platform-specific code goes through `PlatformProvider`. Adding Codeberg/Forgejo support means adding a new platform provider — not forking the CLI.

5. **No daemon**: `pi-cli` is a one-shot process. No background server, no socket, no state file. State lives in git (branches, commits) and GitHub (issues, PRs, comments, CI).

## 3. Architecture

### 3.1 Package Structure

```
packages/pi-cli/
├── src/
│   ├── index.ts                    # CLI entry (commander)
│   ├── commands/
│   │   ├── run.ts                  # Run agent with free-form prompt (M1 ✅)
│   │   ├── issue.ts                # Continue work on an issue (M2)
│   │   ├── pr.ts                   # Continue work on a PR (M2)
│   │   ├── review.ts              # Review a PR (M3)
│   │   ├── status.ts              # Show current work status (M2)
│   │   └── thread.ts              # Dump thread context for inspection (M3)
│   ├── adapters/
│   │   ├── logger.ts              # ✅ CliLogger
│   │   ├── git-adapter.ts         # ✅ CliGitAdapter
│   │   ├── output-sink.ts         # ✅ CliOutputSink
│   │   ├── pi-agent.ts            # ✅ createCliPiAgent
│   │   └── interactive-sink.ts    # Streaming output for interactive mode (M2)
│   ├── context.ts                  # ✅ CLI PlatformContext builder
│   ├── config.ts                   # ✅ CLI config gathering
│   ├── auth.ts                     # ✅ Token resolution
│   ├── octokit.ts                  # ✅ Octokit construction
│   ├── pi/
│   │   └── default-system-prompt.ts # ✅ CLI-tuned system prompt
│   └── interactive/
│       ├── prompt-builder.ts       # Build prompts from issue/PR context (M2)
│       ├── session-resume.ts       # Resume logic using thread history (M2)
│       └── ci-awareness.ts         # Auto-inject CI status into prompts (M2)
└── tests/
```

### 3.2 Dependency Graph

```
pi-cli
├── pi-orchestrator      (Agent orchestration, PlatformProvider interface)
├── pi-platform-github   (GitHub/Codeberg/Forgejo implementation)
├── commander            (CLI argument parsing)
└── @octokit/core        (API client — used only for Octokit construction)
```

No new packages are introduced. The CLI is a **frontend** to the same orchestrator + platform stack the GitHub Action uses.

### 3.3 How Context Flows

```
┌─────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│  Developer   │────▶│  pi-cli              │────▶│  GitHub API      │
│  (terminal)  │◀────│  (orchestrator+tools) │◀────│  (thread, PR,    │
└─────────────┘     └──────────────────────┘     │   CI, diff)      │
         │                    │                   └──────────────────┘
         │                    │                           │
         │                    ▼                           │
         │           ┌──────────────────┐                │
         │           │  Pi Agent        │                │
         │           │  (LLM + tools)   │────────────────┘
         │           └──────────────────┘
         │                    │
         ▼                    ▼
   ┌──────────┐       ┌──────────────┐
   │ Terminal  │       │ Git repo     │
   │ stdout    │       │ (local tree) │
   └──────────┘       └──────────────┘
```

## 4. Milestone Plan

### M1 — Free-form Run (✅ Shipped)

The current `pi-cli run` command. Proves the orchestrator is frontend-agnostic.

```bash
pi-cli run "explain the auth module" \
  --repo shaftoe/pi-coding-agent-action \
  --provider anthropic \
  --model claude-sonnet-4-5
```

**What it does**: Runs the full agent with all tools (PR create/update, thread, diff, review, CI) against a repo. Output to stdout. No thread persistence — a one-shot prompt/response.

**Key design decisions (already made)**:
- Sentinel `PlatformContext` with `eventName: 'cli'`, `issue.number: 0`, empty payload
- Platform provider methods no-op gracefully when no triggering comment exists
- System prompt tuned for terminal output (no footers, concise formatting)
- Streaming thinking deltas to stderr, response to stdout

### M2 — Issue/PR-Aware Runs (Next)

Enable the CLI to attach a run to an existing issue or PR, so the agent has full thread context and can post its response as a comment.

#### New Commands

##### `pi-cli issue <number> --repo <owner/repo> [instruction]`

```bash
# Continue work on an issue
pi-cli issue 277 --repo shaftoe/pi-coding-agent-action "implement the CLI constitution"

# Let the agent infer instruction from the issue body
pi-cli issue 277 --repo shaftoe/pi-coding-agent-action
```

**Behavior**:
1. Fetches the issue thread (title, body, all comments) via `getIssueOrPRThread`
2. Builds a prompt that includes the full thread context + the user's instruction (or uses the issue body as instruction)
3. Sets `PlatformContext.issue.number` to the actual issue number
4. Sets `PlatformContext.eventName` to `'cli-issue'` (a new first-class event)
5. Runs the agent with full tool access
6. Posts the response as a comment on the issue (if `--post-comment` is set, default: yes)
7. Outputs the response to stdout simultaneously

##### `pi-cli pr <number> --repo <owner/repo> [instruction]`

```bash
# Review and continue work on a PR
pi-cli pr 280 --repo shaftoe/pi-coding-agent-action "fix the failing CI"

# Just review the PR
pi-cli pr 280 --repo shaftoe/pi-coding-agent-action --review
```

**Behavior**:
1. Fetches the PR thread (title, body, comments, review comments) via `getIssueOrPRThread`
2. Fetches the PR diff via `getPRDiff`
3. Optionally fetches CI status via `getCIStatus` and workflow logs
4. Builds a prompt with full PR context
5. Sets `PlatformContext.issue.number` to the PR number
6. Sets `PlatformContext.payload.pull_request = { number }` so `isPR()` returns true
7. Runs the agent
8. Posts the response as a comment on the PR

##### `pi-cli status --repo <owner/repo>`

```bash
pi-cli status --repo shaftoe/pi-coding-agent-action
```

**Behavior**: Shows open PRs with their CI status, recent issue activity, and any threads where the agent has participated. A quick overview for "what needs attention."

#### Key Implementation: Context Builder

The core addition is an `InteractiveContextBuilder` that constructs a rich `PlatformContext` from a GitHub issue/PR number:

```typescript
// packages/pi-cli/src/interactive/context-builder.ts

interface InteractiveContextArgs {
  repo: RepoRef;
  issueOrPRNumber: number;
  isPR: boolean;
  workspace: string;
  serverUrl: string;
  actor?: string;
  sha?: string;
}

async function buildInteractiveContext(
  octokit: OctokitInstance,
  args: InteractiveContextArgs
): Promise<PlatformContext> {
  // Build a context that mirrors the GitHub Action's context shape
  // but is constructed from API calls rather than environment variables.
  return {
    repo: args.repo,
    issue: { number: args.issueOrPRNumber },
    eventName: args.isPR ? 'pull_request' : 'issues',
    payload: args.isPR
      ? { pull_request: { number: args.issueOrPRNumber } }
      : { issue: { number: args.issueOrPRNumber } },
    serverUrl: args.serverUrl,
    workspace: args.workspace,
    actor: args.actor,
    sha: args.sha,
  };
}
```

#### Key Implementation: Prompt Builder

The prompt builder enriches the user's instruction with thread context:

```typescript
// packages/pi-cli/src/interactive/prompt-builder.ts

async function buildIssuePrompt(
  provider: PlatformProvider,
  issueNumber: number,
  userInstruction?: string
): Promise<string> {
  const thread = await provider.getIssueOrPRThread({ issue_number: issueNumber });
  if (!thread) throw new Error(`Issue #${issueNumber} not found`);

  const parts: string[] = [];
  parts.push(`Issue/PR #${thread.number}: ${thread.title}`);
  if (thread.body) parts.push(`\nDescription:\n${thread.body}`);

  // Include thread comments as context (the agent's memory)
  if (thread.comments.length > 0) {
    parts.push('\nThread comments:');
    for (const comment of thread.comments) {
      const author = comment.author_type === 'bot' ? '[Agent]' : comment.author;
      parts.push(`  @${author}: ${comment.body}`);
    }
  }

  // Include review comments for PRs
  if (thread.review_comments?.length > 0) {
    parts.push('\nReview comments:');
    for (const rc of thread.review_comments) {
      parts.push(`  @${rc.author} (${rc.path}:${rc.line}): ${rc.body}`);
    }
  }

  if (userInstruction) {
    parts.push(`\nInstruction:\n${userInstruction}`);
  } else {
    // Use the issue body as the instruction
    parts.push('\nInstruction: Continue working on this issue based on the thread context above.');
  }

  return parts.join('\n');
}
```

#### Key Implementation: CI-Aware Resume

When targeting a PR, auto-inject CI status so the agent can act on failures:

```typescript
// packages/pi-cli/src/interactive/ci-awareness.ts

async function enrichWithCIContext(
  provider: PlatformProvider,
  prNumber: number,
  prompt: string
): Promise<string> {
  const ciStatus = await provider.getCIStatus({ pull_number: prNumber });
  const failed = ciStatus.details.workflow_runs.filter(
    r => r.conclusion === 'failure'
  );

  if (failed.length === 0) return prompt;

  const parts = [prompt];
  parts.push('\nCI Status: ❌ Failing');
  for (const run of failed) {
    parts.push(`  - ${run.name}: ${run.conclusion} (${run.html_url})`);
  }
  parts.push('\nThe CI is failing. Please check the failing checks and fix the issues.');
  return parts.join('\n');
}
```

#### Flags for M2

| Flag | Commands | Description |
| --- | --- | --- |
| `--post-comment` | `issue`, `pr` | Post response as comment (default: true) |
| `--no-post-comment` | `issue`, `pr` | Don't post comment, only output to stdout |
| `--review` | `pr` | Run in review mode (APPROVE/REQUEST_CHANGES) |
| `--ci-aware` | `pr` | Auto-inject CI status into prompt (default: true) |
| `--include-diff` | `pr` | Include PR diff in prompt context (default: true) |
| `--max-comments` | `issue`, `pr` | Limit thread comments fetched (default: 100) |

### M3 — Full Interactive Loop

Enable multi-turn interaction where the CLI acts as a gateway to the agent running in GitHub Actions CI.

#### New Commands

##### `pi-cli review <pr-number> --repo <owner/repo>`

```bash
# Full PR review with inline comments
pi-cli review 280 --repo shaftoe/pi-coding-agent-action
```

**Behavior**: Fetches the diff, thread, and CI status, then runs the agent in review mode. The agent posts a GitHub PR review with inline comments (using `createReview`).

##### `pi-cli thread <number> --repo <owner/repo>`

```bash
# Inspect the full thread context (debugging tool)
pi-cli thread 277 --repo shaftoe/pi-coding-agent-action --format json
```

**Behavior**: Fetches and prints the full thread (issue/PR body, all comments, review comments, CI status) without running the agent. Useful for understanding what context the agent will see. Supports `--format text|json`.

##### `pi-cli dispatch <number> --repo <owner/repo>`

```bash
# Trigger a GitHub Actions workflow_dispatch to run the agent in CI
pi-cli dispatch 277 --repo shaftoe/pi-coding-agent-action
```

**Behavior**: Triggers a `workflow_dispatch` event targeting the specified issue/PR. This lets a developer kick off a CI run from the terminal, then monitor it via `pi-cli status` or the GitHub UI.

#### Interactive Mode (Terminal Chat)

```bash
pi-cli chat --repo shaftoe/pi-coding-agent-action --issue 277
```

**Behavior**: Opens an interactive terminal session where each user message triggers a new agent run with full thread context. The agent's responses are streamed to the terminal AND posted as comments on the issue/PR. This creates a "chat with the agent" experience where:

1. The user types a message
2. The CLI sends it as a prompt to the agent
3. The agent's response streams to the terminal
4. The response is also posted as a comment on the issue/PR
5. Next user message includes all prior thread context

**This is the key unlock**: the developer can chat with the agent locally, and every exchange is persisted in the GitHub thread. The developer can switch to the GitHub mobile app, read the same thread, and the agent (when triggered again) will have the full conversation history.

### M4 — Publishing & Distribution

Package `pi-cli` for npm distribution:

```bash
# Install globally
npm install -g @alexanderfortin/pi-cli

# Or use with npx
npx @alexanderfortin/pi-cli issue 277 --repo shaftoe/pi-coding-agent-action
```

**Tasks**:
- esbuild bundle for the `pi-cli` binary (switch shebang to `node`)
- Add `.npmignore` / `files` field to exclude tests
- CI pipeline for npm publishing (via semantic-release)
- Shell completions (bash, zsh, fish)
- Man page generation from `--help` output

## 5. Platform Abstraction Strategy

The current architecture already provides clean separation:

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────────┐
│  pi-cli      │────▶│  pi-orchestrator │────▶│  PlatformProvider    │
│  (frontend)  │     │  (business logic)│     │  (interface)         │
└──────────────┘     └─────────────────┘     └──────────────────────┘
                                                       │
                                              ┌────────┴────────┐
                                              │                  │
                                    ┌─────────▼──────┐  ┌───────▼────────┐
                                    │  pi-platform-   │  │  pi-platform-  │
                                    │  github         │  │  codeberg      │
                                    │  (GitHub, GHE,  │  │  (Codeberg,    │
                                    │   Forgejo)      │  │   Gitea)       │
                                    └────────────────┘  └────────────────┘
```

For M2+, the CLI only needs to:

1. **Detect the platform** (already done via `detectPlatform(serverUrl)`)
2. **Construct the right Octokit** (already done via `apiBaseUrlFromServerUrl`)
3. **Build the right context** (already done via `buildPlatformContext`)

Adding Codeberg support requires:
- A `pi-platform-codeberg` package (or extending `pi-platform-github` since Codeberg's API is GitHub-compatible)
- Registering it as a workspace package
- The CLI picks it up automatically via `detectPlatform()`

**No CLI code changes needed for new platforms.**

## 6. Mixed Workflow Scenarios

### Scenario A: Start Locally, Continue in CI

```
1. Developer: pi-cli issue 277 --repo org/repo "implement auth module"
   → Agent creates a branch, implements, opens PR #280
   → Agent posts summary comment on PR #280
   → CI triggers

2. CI fails (lint error)

3. Developer (on phone): Opens PR #280 on GitHub mobile
   → Reads agent's comment
   → Adds a comment: "/pi fix the lint errors"

4. GitHub Action picks up the comment
   → Agent reads full thread (its own prior comment + the user's new instruction)
   → Fixes the lint errors, pushes to PR branch
   → CI passes

5. Developer: pi-cli pr 280 --repo org/repo
   → Reads full thread context, sees CI is green
   → "LGTM, merging"
```

### Scenario B: Start in CI, Continue Locally

```
1. Developer adds /pi comment on GitHub issue #42
   → GitHub Action runs, agent creates PR #50

2. Developer: pi-cli pr 50 --repo org/repo "add missing tests"
   → CLI reads PR thread (agent's prior comment is in the thread)
   → Agent understands what was already done, adds tests
   → Pushes new commit to PR #50
   → Posts update comment

3. Developer merges from GitHub web UI
```

### Scenario C: Local-Only Development

```
1. Developer: pi-cli run "analyze the auth module" --repo org/repo
   → One-shot analysis, output to stdout, no thread interaction

2. Developer: pi-cli issue 277 --repo org/repo --no-post-comment "draft a plan"
   → Runs agent with issue context but only outputs to stdout
   → Developer reviews plan locally, then posts it manually or via --post-comment
```

## 7. System Prompt Strategy

The CLI uses a different system prompt than the GitHub Action. The prompt must be aware of the execution mode:

### For `run` (M1, current):
- Terminal output, no footers, concise

### For `issue` / `pr` (M2):
- Same as GitHub Action prompt but with awareness that the agent is running from CLI
- Must mention that its response will be posted as a comment
- Should reference the thread history as its "memory"

### For `review` (M3):
- Review-specific prompt focusing on code quality
- Same as the GitHub Action's review mode

```typescript
// M2 system prompt (draft)
const CLI_INTERACTIVE_SYSTEM_PROMPT =
  "You are an AI coding assistant. You are operating in mixed CLI/GitHub mode: " +
  "the developer invoked you from a terminal, but your response will be posted " +
  "as a comment on a GitHub issue/PR. You have full access to the thread history " +
  "(all prior comments, reviews, CI results) which serves as your conversation memory. " +
  "You can create/update PRs, post reviews, and check CI status. " +
  "Be concise but thorough — the developer may be reading on a mobile device. " +
  "IMPORTANT: Do NOT add any footer, signature, metadata, or closing text.";
```

## 8. Configuration

### Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` or `GH_TOKEN` | ✅ | GitHub API token (needs `repo` scope for PR operations) |
| `ANTHROPIC_API_KEY` (etc.) | ✅ | LLM provider API key |

### Configuration File (M3+)

Optional `~/.config/pi/config.toml` or `.pi.toml` in the repo root:

```toml
[defaults]
provider = "anthropic"
model = "claude-sonnet-4-5"
server_url = "https://github.com"

[github]
# Default repo when --repo is omitted (detected from git remote)
auto_detect_repo = true
```

### Git Remote Detection (M2)

When `--repo` is omitted, auto-detect from the git remote:

```typescript
function detectRepoFromGitRemote(cwd: string): RepoRef | undefined {
  // Run: git remote get-url origin
  // Parse: https://github.com/owner/repo.git → owner/repo
  // Parse: git@github.com:owner/repo.git → owner/repo
}
```

## 9. Token Scope Requirements

| Operation | Required GitHub Token Scope |
| --- | --- |
| Read issue/PR threads | `repo` |
| Post comments | `repo` |
| Create PRs | `repo` |
| Push commits | `repo` |
| Read CI status | `repo` (or `actions:read` for public repos) |
| Fetch workflow logs | `repo` |
| Add/delete reactions | `repo` |
| Trigger workflow_dispatch | `repo` |

A single `GITHUB_TOKEN` with `repo` scope covers all operations. For public repos, a fine-grained PAT with appropriate permissions also works.

## 10. Testing Strategy

### Unit Tests (per-package)

Each command has unit tests covering:

- **Context building**: `buildInteractiveContext` produces correct `PlatformContext`
- **Prompt building**: `buildIssuePrompt` / `buildPRPrompt` include expected context
- **CI awareness**: `enrichWithCIContext` handles passing/failing CI
- **Flag parsing**: Commander program shape and defaults

### Integration Tests

Tests that wire together the CLI → orchestrator → platform provider with mocked API responses:

```typescript
describe('pi-cli issue command', () => {
  it('fetches issue thread and builds enriched prompt', async () => {
    // Mock Octokit to return issue data
    // Run the issue command
    // Assert the prompt includes issue title, body, and comments
  });
});
```

### E2E Tests

The existing E2E test infrastructure (`tests/e2e/`) can be extended to cover CLI commands against a real test repository.

## 11. Implementation Order

### Phase 1: M2 Core (Issue/PR-aware runs)

1. **`buildInteractiveContext()`** — construct `PlatformContext` from issue/PR number
2. **`buildIssuePrompt()`** — enrich prompt with thread context
3. **`buildPRPrompt()`** — enrich with diff + thread + CI status
4. **`issue` command** — wire it all together
5. **`pr` command** — wire it all together
6. **`--post-comment` flag** — control comment posting
7. **Git remote detection** — auto-detect `--repo`

### Phase 2: M2 Polish

8. **`status` command** — quick overview
9. **`--ci-aware` auto-injection** — CI status in PR prompts
10. **Interactive system prompt** — tuned for mixed mode
11. **Streaming output to terminal** — real-time display while agent works

### Phase 3: M3 (Review + Thread + Dispatch)

12. **`review` command** — full PR review with inline comments
13. **`thread` command** — context inspection tool
14. **`dispatch` command** — trigger workflow_dispatch
15. **`chat` command** — interactive multi-turn mode

### Phase 4: M4 (Distribution)

16. **esbuild bundle** — standalone binary
17. **npm publish** — `@alexanderfortin/pi-cli`
18. **Shell completions** — bash/zsh/fish
19. **Config file** — `.pi.toml`

## 12. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Token stored in env var | Document security best practices; future: keychain integration |
| Large threads exceed context window | `--max-comments` flag; summarize old comments |
| Rate limiting on GitHub API | Exponential backoff in provider; `--no-post-comment` fallback |
| Agent modifies wrong repo | `--repo` is required; git remote detection validates ownership |
| Concurrent CLI + Action runs | Thread comments are idempotent; PR updates handle race conditions |
| Platform drift (Codeberg API differences) | `detectPlatform()` gates behavior; per-platform adapter pattern |

## 13. Success Metrics

- **M1** ✅: `pi-cli run` produces identical agent behavior to the GitHub Action
- **M2**: Developer can start from CLI, continue in CI, and resume in CLI without context loss
- **M3**: Full review workflow from CLI with inline comments posted to GitHub
- **M4**: `npx @alexanderfortin/pi-cli` works out of the box for any public repo

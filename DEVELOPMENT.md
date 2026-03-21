# Development Summary

## Architecture

The GitHub Action uses a hybrid architecture combining the best tools for each task:

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Action Runtime                    │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
   ┌─────────┐        ┌─────────┐        ┌─────────┐
   │   gh    │        │isomorphic│        │    pi   │
   │   CLI   │        │   -git   │        │  agent  │
   └─────────┘        └─────────┘        └─────────┘
        │                   │                   │
        │ GitHub API          │ Local git          │ AI
        │ operations          │ operations         │ analysis
        ▼                   ▼                   ▼
   Fetch issues     Checkout, add,       Code review,
   Create PRs      commit, push        generate changes
   Comments
```

### Key Design Decisions

#### 1. Hybrid Approach: gh CLI + isomorphic-git

**Why not just gh CLI?**
- Shell git commands are platform-dependent
- Harder to test and mock
- No TypeScript types
- Blocking/synchronous operations

**Why not just isomorphic-git?**
- No simple way to create PRs via GitHub API
- Complex authentication for API calls
- More code for same functionality

**Best of both worlds:**
- `gh` CLI for GitHub API (simple, pre-installed, JSON output)
- `isomorphic-git` for local git (async, type-safe, pure JS)

#### 2. esbuild for Bundling
- **Fast**: Build times < 100ms
- **Small**: ~854KB bundle
- **Modern**: Supports latest npm packages

### Tool Responsibilities

| Operation | Tool | Reason |
|------------|-------|--------|
| Fetch issue data | `gh issue view --json` | Pre-installed, JSON output |
| Fetch PR data | `gh pr view --json` | Pre-installed, JSON output |
| Create comment | `gh issue comment` | Simple, no auth setup |
| Create PR | `gh pr create` | Official GitHub tool |
| Checkout branch | isomorphic-git | Async, type-safe |
| Stage files | isomorphic-git | Status matrix API |
| Commit changes | isomorphic-git | Type-safe, async |
| Push to remote | isomorphic-git | Built-in auth |
| Check dirty status | isomorphic-git | Rich status info |

### Project Structure

```
pi-coding-agent-action/
├── src/
│   ├── index.ts               # Main orchestration
│   ├── types.ts               # TypeScript interfaces
│   ├── utils.ts               # Utility functions
│   ├── gh.ts                  # GitHub CLI operations
│   ├── git.ts                 # isomorphic-git operations
│   ├── prompts.ts             # Prompt builders
│   └── pi.ts                  # Pi agent operations
├── dist/
│   └── index.js              # Bundled action (~854KB)
├── .github/
│   └── workflows/
│       └── build.yml          # CI/CD workflow
├── .example-workflow.yml      # Example for users
├── action.yml                # Action metadata
├── package.json              # Dependencies
├── tsconfig.json             # TypeScript config
└── README.md                # Documentation
```

### Helper Functions

#### Shell Command Helper
```typescript
function runCommand(cmd: string[], options?: { input?: string }): string
```
Executes a shell command, returns stdout, throws on error.

#### gh CLI Helpers
```typescript
function gh(command: string[], options?: { input?: string }): string
function getIssueData(issueNumber: number): IssueNode
function getPRData(prNumber: number): PRNode
function createComment(issueNumber: number, body: string): void
function createPR(base: string, branch: string, title: string, body: string): number
```

#### isomorphic-git Helpers
```typescript
async function configureGit(): Promise<void>
async function getHeadCommit(): Promise<string | null>
async function branchIsDirty(): Promise<boolean>
async function fetchBranch(remoteUrl: string, remote: string, branch: string, depth?: number): Promise<void>
async function checkoutBranch(branch: string, createNew?: boolean): Promise<void>
async function stageAll(): Promise<void>
async function commitChanges(message: string): Promise<string>
async function pushBranch(remote: string, branch: string, setUpstream?: boolean, force?: boolean): Promise<void>
```

### Workflow

#### Issue Flow
```
1. User comments "/pi <prompt>" in issue
2. Fetch issue data via `gh issue view --json`
3. Configure git (isomorphic-git)
4. Create new branch via isomorphic-git
5. Run pi agent with issue context
6. If changes made:
   - Stage all files (isomorphic-git)
   - Commit with summary (isomorphic-git)
   - Push branch (isomorphic-git)
   - Create PR via `gh pr create`
7. Post result as comment (gh CLI)
```

#### PR Flow
```
1. User comments "/pi <prompt>" in PR
2. Fetch PR data via `gh pr view --json`
3. Configure git (isomorphic-git)
4. Checkout PR branch (isomorphic-git)
5. Run pi agent with PR context
6. If changes made:
   - Stage all files (isomorphic-git)
   - Commit with summary (isomorphic-git)
   - Push to PR branch (isomorphic-git)
7. Post result as comment (gh CLI)
```

### How to Build

```bash
# Install dependencies
bun install

# Compile TypeScript
bun run build

# Package (creates dist/index.js)
bun run package
```

The `dist/` folder is committed to the repository because the action runs directly from these bundled files.

### Dependencies

- **Runtime**:
  - `@actions/core` - GitHub Actions core functions
  - `@actions/github` - GitHub context utilities
  - `isomorphic-git` - Pure JavaScript git library
- **Build**:
  - `esbuild` - Fast bundler
  - `typescript` - TypeScript compiler
  - `@types/node` - Node.js type definitions
- **External**:
  - `gh` CLI (pre-installed)
  - `pi` agent (installed at runtime)

### Bundle Size

Current bundle size: **~854KB**

This includes:
- @actions/core (~30KB)
- @actions/github (~150KB)
- isomorphic-git (~400KB)
- pi agent code (~274KB)
- Built-in Node.js polyfills (~0KB, external)

## Files to Commit

Make sure to commit the `dist/` folder when deploying:

```bash
bun run package
git add dist/ src/ action.yml package.json tsconfig.json
git commit -m "Build action"
```

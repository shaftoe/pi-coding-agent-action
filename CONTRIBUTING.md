# Contributing to Pi Coding Agent Action

Thank you for your interest in contributing!

## Development Workflow

### 1. Fork and Clone

```bash
git clone https://github.com/your-username/pi-coding-agent-action.git
cd pi-coding-agent-action
```

### 2. Install Dependencies

```bash
bun install
```

### 3. Make Changes

Edit files in the `src/` directory. The main source file is `src/index.ts`.

### 4. Build and Test

```bash
# Type-check TypeScript code
bun run type-check

# Run linter
bun run lint

# Check code formatting
bun run format

# Auto-fix linting issues
bun run lint:fix

# Auto-fix formatting issues
bun run format:fix

# Run all validations (type-check, lint, format)
bun run validate

# Bundle with esbuild (creates single file distribution)
bun run package
```

**Important**: Before committing, always run `bun run validate` and `bun run package` to ensure the `dist/` folder is up-to-date and the code passes all checks. The action runs from the bundled files in `dist/`, not from the `src/` directory.

**Note**: Lefthook is configured to automatically run type-check, lint, and format checks on pre-commit. If you prefer to skip them temporarily, use `git commit --no-verify`.

### 5. Commit and Push

```bash
git add .
git commit -m "Your commit message"
git push origin your-branch
```

### 6. Create Pull Request

Open a pull request from your fork to the main repository.

## Architecture

The action uses a hybrid architecture:

- **GitHub CLI (`gh`)**: For GitHub API interactions (fetching issues/PRs, creating comments and PRs)
- **isomorphic-git**: For local git operations (checkout, add, commit, push)
- **Pi agent**: For AI-powered code analysis and modification

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Project Structure

```
.
├── src/                    # Source TypeScript files
│   └── index.ts           # Main action implementation
├── dist/                  # Compiled and bundled output (committed)
│   └── index.js          # Bundled action (this is what runs)
├── .github/
│   └── workflows/        # CI/CD workflows
│       └── build.yml     # Build and test workflow
├── action.yml            # Action definition
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript config
└── README.md             # Documentation
```

## Code Style

This project uses ESLint, Prettier, and TypeScript for code quality and consistency:

- **ESLint**: Enforces code quality and catches potential bugs
- **Prettier**: Ensures consistent code formatting
- **TypeScript**: Provides type safety with strict mode enabled

### Linting Rules

- Use TypeScript for all new code
- Follow existing code patterns
- Keep functions focused and modular
- Add JSDoc comments for complex functions
- Use `runCommand()` helper for shell operations
- Use `gh()` helper for GitHub CLI calls
- Use isomorphic-git for local git operations

### Type Safety

- TypeScript strict mode is enabled
- All code must pass `bun run type-check` before committing
- Explicit type annotations are encouraged over `any`
- Use `??` instead of `||` for nullish coalescing when appropriate

## Testing

### Testing the Action in a Real Repository

1. Create a test repository
2. Create a workflow that references your fork/branch:
   ```yaml
   - uses: your-username/pi-coding-agent-action@your-branch
   ```
3. Trigger the action by commenting `/pi` in an issue or PR

### Local Development Tips

#### Test gh CLI commands
```bash
# Set GH_TOKEN first
export GH_TOKEN=your_token

# Test gh commands
gh issue view 123 --json title,body,comments
gh pr view 123 --json title,body,headRefName
```

#### Test isomorphic-git operations
```typescript
// You can test isomorphic-git in a separate script
import * as git from "isomorphic-git";
import fs from "fs";

const status = await git.statusMatrix({
  fs,
  dir: process.cwd(),
  ref: "HEAD"
});
console.log(status);
```

#### Debug logging
```typescript
core.info("Processing PR...");
core.debug(`Response: ${response}`);
core.error("Something went wrong");
```

## Common Tasks

### Adding a New Input

1. Add to `action.yml`:
   ```yaml
   inputs:
     my_input:
       description: "My input"
       required: false
   ```

2. Use in `src/index.ts`:
   ```typescript
   const myInput = core.getInput("my_input") || "default";
   ```

### Adding a New gh CLI Operation

1. Use the `gh()` helper:
   ```typescript
   const output = gh(["repo", "view", "--json", "name,owner"]);
   const data = JSON.parse(output);
   ```

2. Add error handling as needed

### Adding a New isomorphic-git Operation

1. Import and use isomorphic-git:
   ```typescript
   import * as git from "isomorphic-git";

   // Example: Get current branch
   const HEAD = await git.resolveRef({
     fs,
     dir: process.cwd(),
     ref: "HEAD"
   });
   ```

2. See [isomorphic-git documentation](https://isomorphic-git.org/) for API reference

## Release Process

Releases are created by tagging commits:

```bash
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

Users can then reference specific versions: `uses: owner/repo@v1.0.0`

## Resources

- [GitHub CLI Documentation](https://cli.github.com/manual/)
- [isomorphic-git Documentation](https://isomorphic-git.org/)
- [GitHub Actions Toolkit](https://github.com/actions/toolkit)
- [Pi Documentation](https://pi.dev)
- [esbuild Documentation](https://esbuild.github.io/)

## Questions?

Feel free to open an issue or discussion for questions or suggestions!

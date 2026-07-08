/**
 * @file Tests for the git-CLI helpers in `git-cli.ts`.
 *
 * These tests use real git operations in temporary directories to verify
 * the `simple-git` based helpers behave correctly end-to-end.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  appendCoAuthoredBy,
  ensureGitIdentity,
  hasLocalChanges,
  workspaceHasChanges,
  getWorkspaceChangePaths,
  commitAndPushBranch,
} from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';
import type { SimpleGit } from 'simple-git';
import { simpleGit } from 'simple-git';
import { setupGitRepo, cleanupGitRepo } from '../helpers/git-repo';

/** Create a logger that captures messages for assertions. */
function captureLogger() {
  const messages: string[] = [];
  return {
    log: {
      debug: (msg: string) => messages.push(`debug: ${msg}`),
      info: (msg: string) => messages.push(`info: ${msg}`),
      warning: (msg: string) => messages.push(`warning: ${msg}`),
      notice: (msg: string) => messages.push(`notice: ${msg}`),
      error: (msg: string) => messages.push(`error: ${msg}`),
    },
    messages,
  };
}

/** Create a minimal GitHubModuleDeps with a captured logger. */
function createDeps(actor?: string): { deps: GitHubModuleDeps; messages: string[] } {
  const { log, messages } = captureLogger();
  return {
    deps: {
      context: {
        repo: { owner: 'test-owner', repo: 'test-repo' },
        issue: { number: 42 },
        eventName: 'issue_comment',
        payload: {},
        serverUrl: 'https://github.com',
        workspace: '/tmp',
        ...(actor !== undefined ? { actor } : {}),
      },
      logger: log,
    } as unknown as GitHubModuleDeps,
    messages,
  };
}

// ---------------------------------------------------------------------------
// appendCoAuthoredBy
// ---------------------------------------------------------------------------

describe('appendCoAuthoredBy', () => {
  test('appends trailer when actor is present', () => {
    const { deps } = createDeps('octocat');
    expect(appendCoAuthoredBy(deps, 'Fix bug')).toBe(
      'Fix bug\n\nCo-authored-by: octocat <octocat@users.noreply.github.com>'
    );
  });

  test('returns message unchanged when actor is empty', () => {
    const { deps } = createDeps('');
    expect(appendCoAuthoredBy(deps, 'Fix bug')).toBe('Fix bug');
  });

  test('returns message unchanged when actor is undefined', () => {
    const { deps } = createDeps(undefined);
    expect(appendCoAuthoredBy(deps, 'Fix bug')).toBe('Fix bug');
  });
});

// ---------------------------------------------------------------------------
// ensureGitIdentity
// ---------------------------------------------------------------------------

describe('ensureGitIdentity', () => {
  let tmpDir: string;
  let git: SimpleGit;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-git-identity-'));
    execSync('git init', { cwd: tmpDir });
    git = simpleGit(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('sets local identity when none is configured', async () => {
    const { log, messages } = captureLogger();
    await ensureGitIdentity(git, 'myactor', log);

    const name = await git.getConfig('user.name', 'local');
    const email = await git.getConfig('user.email', 'local');
    expect(name.value).toBe('myactor');
    expect(email.value).toBe('myactor@users.noreply.github.com');
    expect(messages.some(m => m.includes('user.name'))).toBe(true);
  });

  test('does not override existing identity', async () => {
    await git.addConfig('user.name', 'existing', false, 'local');
    await git.addConfig('user.email', 'existing@test', false, 'local');

    const { log } = captureLogger();
    await ensureGitIdentity(git, 'myactor', log);

    const name = await git.getConfig('user.name', 'local');
    expect(name.value).toBe('existing');
  });

  test('uses default when actor is undefined', async () => {
    const { log } = captureLogger();
    await ensureGitIdentity(git, undefined, log);

    const name = await git.getConfig('user.name', 'local');
    expect(name.value).toBe('pi-coding-agent');
  });
});

// ---------------------------------------------------------------------------
// hasLocalChanges / workspaceHasChanges
// ---------------------------------------------------------------------------

describe('hasLocalChanges', () => {
  let tmpDir: string;
  let git: SimpleGit;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-git-status-'));
    execSync('git init', { cwd: tmpDir });
    execSync('git -c user.name=t -c user.email=t@t commit --allow-empty -m init', {
      cwd: tmpDir,
    });
    git = simpleGit(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns false for clean working tree', async () => {
    expect(await hasLocalChanges(git)).toBe(false);
  });

  test('returns true when there are untracked files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'content');
    expect(await hasLocalChanges(git)).toBe(true);
  });

  test('returns true when there are modified files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'tracked.txt'), 'v1');
    execSync('git add -A && git -c user.name=t -c user.email=t@t commit -m add', {
      cwd: tmpDir,
    });
    fs.writeFileSync(path.join(tmpDir, 'tracked.txt'), 'v2');
    expect(await hasLocalChanges(git)).toBe(true);
  });
});

describe('workspaceHasChanges', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-git-ws-status-'));
    execSync('git init', { cwd: tmpDir });
    execSync('git -c user.name=t -c user.email=t@t commit --allow-empty -m init', {
      cwd: tmpDir,
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns false for clean working tree', async () => {
    expect(await workspaceHasChanges(tmpDir)).toBe(false);
  });

  test('returns true when there are untracked files', async () => {
    fs.writeFileSync(path.join(tmpDir, 'new.txt'), 'content');
    expect(await workspaceHasChanges(tmpDir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getWorkspaceChangePaths
// ---------------------------------------------------------------------------

describe('getWorkspaceChangePaths', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-git-ws-paths-'));
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name t', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email t@t', { cwd: tmpDir, stdio: 'pipe' });
    // Initial commit with a tracked file
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# test');
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m init', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns empty arrays for a clean working tree', async () => {
    const result = await getWorkspaceChangePaths(tmpDir);
    expect(result.changed).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  test('detects new and modified files in changed[]', async () => {
    fs.writeFileSync(path.join(tmpDir, 'new.ts'), 'export {};');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# modified');
    const result = await getWorkspaceChangePaths(tmpDir);
    expect(result.changed).toContain('new.ts');
    expect(result.changed).toContain('README.md');
    expect(result.deleted).toEqual([]);
  });

  test('detects deleted files in deleted[]', async () => {
    fs.rmSync(path.join(tmpDir, 'README.md'));
    const result = await getWorkspaceChangePaths(tmpDir);
    expect(result.deleted).toContain('README.md');
    expect(result.changed).toEqual([]);
  });

  test('filters out GITHUB_IGNORE_PATTERNS (pi workflow file)', async () => {
    fs.mkdirSync(path.join(tmpDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.github', 'workflows', 'pi.yml'), 'changed');
    fs.writeFileSync(path.join(tmpDir, 'feature.ts'), 'export {};');
    const result = await getWorkspaceChangePaths(tmpDir);
    // pi.yml must be excluded
    expect(result.changed).not.toContain('.github/workflows/pi.yml');
    // but feature.ts should be included
    expect(result.changed).toContain('feature.ts');
  });
});

// ---------------------------------------------------------------------------
// commitAndPushBranch (integration with real git)
// ---------------------------------------------------------------------------

describe('commitAndPushBranch', () => {
  let repo: ReturnType<typeof setupGitRepo>;

  beforeEach(() => {
    repo = setupGitRepo();
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test('creates new branch, commits, and pushes', async () => {
    if (!repo) {
      return; // skip if git not available
    }
    const { workspace } = repo;

    // Make a change
    fs.writeFileSync(path.join(workspace, 'feature.txt'), 'new feature');

    const { log, messages } = captureLogger();
    const sha = await commitAndPushBranch({
      cwd: workspace,
      branchName: 'feature-branch',
      message: 'Add feature',
      isNewBranch: true,
      paths: ['feature.txt'],
      log,
    });

    // Should return a commit SHA
    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);
    // Should have pushed
    expect(messages.some(m => m.includes('Pushing'))).toBe(true);

    // Verify the branch exists on the remote
    const remoteBranches = execSync('git branch', {
      cwd: repo.remoteDir,
      encoding: 'utf-8',
    });
    expect(remoteBranches).toContain('feature-branch');
  });

  test('throws when paths is empty', async () => {
    if (!repo) {
      return;
    }
    const { workspace } = repo;

    const { log } = captureLogger();
    await expect(
      commitAndPushBranch({
        cwd: workspace,
        branchName: 'empty-paths',
        message: 'No paths',
        isNewBranch: true,
        paths: [],
        log,
      })
    ).rejects.toThrow(/requires at least one path/);
  });

  test('configures git identity when none is set', async () => {
    if (!repo) {
      return;
    }
    const { workspace } = repo;

    // Remove any identity config
    const git = simpleGit(workspace);
    await git.raw(['config', '--unset', 'user.name']);
    await git.raw(['config', '--unset', 'user.email']);

    fs.writeFileSync(path.join(workspace, 'file.txt'), 'content');

    const { log } = captureLogger();
    await commitAndPushBranch({
      cwd: workspace,
      branchName: 'auto-identity',
      message: 'Test',
      isNewBranch: true,
      paths: ['file.txt'],
      actor: 'ci-bot',
      log,
    });

    // Identity should have been set locally
    const name = await git.getConfig('user.name', 'local');
    expect(name.value).toBe('ci-bot');
  });

  test('pushes to existing branch for updates', async () => {
    if (!repo) {
      return;
    }
    const { workspace, remoteDir } = repo;

    // First, create a branch with a commit and push
    fs.writeFileSync(path.join(workspace, 'v1.txt'), 'v1');
    await commitAndPushBranch({
      cwd: workspace,
      branchName: 'update-branch',
      message: 'Initial',
      isNewBranch: true,
      paths: ['v1.txt'],
      log: captureLogger().log,
    });

    // Now go back to main and make another change
    const git = simpleGit(workspace);
    await git.checkout('main');

    // Make a new change
    fs.writeFileSync(path.join(workspace, 'v2.txt'), 'v2');

    // Push update to existing branch
    const { log } = captureLogger();
    const sha = await commitAndPushBranch({
      cwd: workspace,
      branchName: 'update-branch',
      message: 'Update',
      isNewBranch: false,
      paths: ['v2.txt'],
      log,
    });

    expect(sha).toMatch(/^[0-9a-f]{7,40}$/);

    // Verify the remote branch now has 2 commits
    const logOutput = execSync(`git log --oneline update-branch`, {
      cwd: remoteDir,
      encoding: 'utf-8',
    });
    const lines = logOutput.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  test('stages only the specified paths', async () => {
    if (!repo) {
      return;
    }
    const { workspace } = repo;

    // Make two changes
    fs.writeFileSync(path.join(workspace, 'included.ts'), 'export {};');
    fs.writeFileSync(path.join(workspace, 'excluded.ts'), 'export {};');

    const { log } = captureLogger();
    await commitAndPushBranch({
      cwd: workspace,
      branchName: 'paths-test',
      message: 'Selective staging',
      isNewBranch: true,
      paths: ['included.ts'],
      log,
    });

    // Verify the committed tree only contains included.ts (plus README.md from init)
    const treeOutput = execSync('git ls-tree -r --name-only paths-test', {
      cwd: repo.remoteDir,
      encoding: 'utf-8',
    });
    expect(treeOutput).toContain('included.ts');
    expect(treeOutput).not.toContain('excluded.ts');
  });
});

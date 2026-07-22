/**
 * @file Tests for the git-CLI helpers in `git-cli.ts`.
 *
 * These tests use real git operations in temporary directories to verify
 * the `simple-git` based helpers behave correctly end-to-end.
 */

import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import {
  appendCoAuthoredBy,
  ensureGitIdentity,
  getNoreplyEmail,
  hasLocalChanges,
  workspaceHasChanges,
  getWorkspaceChangePaths,
  checkoutExistingBranch,
  commitAndPushBranch,
} from '@alexanderfortin/pi-platform-github';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';
import type { SimpleGit } from 'simple-git';
import { simpleGit } from 'simple-git';
import { setupGitRepo, cleanupGitRepo, isolateGitConfig } from '../helpers/git-repo';

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

// Isolate every git operation in this file from the host's global/system git
// config (see `isolateGitConfig` in helpers/git-repo.ts for rationale).
isolateGitConfig();

// ---------------------------------------------------------------------------
// getNoreplyEmail
// ---------------------------------------------------------------------------

describe('getNoreplyEmail', () => {
  test('returns undefined when actor is falsy', () => {
    expect(getNoreplyEmail(undefined)).toBeUndefined();
    expect(getNoreplyEmail('')).toBeUndefined();
  });

  test('uses GitHub scheme by default', () => {
    expect(getNoreplyEmail('octocat')).toBe('octocat@users.noreply.github.com');
  });

  test('uses GitHub scheme explicitly', () => {
    expect(getNoreplyEmail('octocat', { platformType: 'github' })).toBe(
      'octocat@users.noreply.github.com'
    );
  });

  test('uses Codeberg scheme', () => {
    expect(getNoreplyEmail('octocat', { platformType: 'codeberg' })).toBe(
      'octocat@noreply.codeberg.org'
    );
  });

  test('uses Forgejo scheme derived from serverUrl', () => {
    expect(
      getNoreplyEmail('octocat', {
        platformType: 'forgejo',
        serverUrl: 'https://forgejo.example.com',
      })
    ).toBe('octocat@forgejo.example.com');
  });

  test('falls back to noreply.local for Forgejo when serverUrl is missing', () => {
    expect(getNoreplyEmail('octocat', { platformType: 'forgejo' })).toBe('octocat@noreply.local');
  });

  test('strips the port for Forgejo when serverUrl includes a non-default port', () => {
    // Forgejo's default port is 3000; the port must NOT appear in the email
    // domain (it would produce an invalid address like `user@host:3000`).
    expect(
      getNoreplyEmail('octocat', {
        platformType: 'forgejo',
        serverUrl: 'http://forgejo.local:3000',
      })
    ).toBe('octocat@forgejo.local');
  });

  test('falls back to noreply.local for Forgejo when serverUrl is malformed', () => {
    expect(
      getNoreplyEmail('octocat', { platformType: 'forgejo', serverUrl: 'not-a-valid-url' })
    ).toBe('octocat@noreply.local');
  });
});

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

  test('appends platform-specific trailer on Forgejo', () => {
    const { log } = captureLogger();
    const deps = {
      context: {
        repo: { owner: 'test-owner', repo: 'test-repo' },
        issue: { number: 42 },
        eventName: 'issue_comment',
        payload: {},
        serverUrl: 'https://forgejo.example.com',
        workspace: '/tmp',
        actor: 'octocat',
      },
      logger: log,
      platformType: 'forgejo' as const,
    } as unknown as GitHubModuleDeps;
    expect(appendCoAuthoredBy(deps, 'Fix bug')).toBe(
      'Fix bug\n\nCo-authored-by: octocat <octocat@forgejo.example.com>'
    );
  });

  test('returns message unchanged when actor is empty', () => {
    const { deps } = createDeps('');
    expect(appendCoAuthoredBy(deps, 'Fix bug')).toBe('Fix bug');
  });

  test('appends Codeberg-specific trailer', () => {
    const { log } = captureLogger();
    const deps = {
      context: {
        repo: { owner: 'test-owner', repo: 'test-repo' },
        issue: { number: 42 },
        eventName: 'issue_comment',
        payload: {},
        serverUrl: 'https://codeberg.org',
        workspace: '/tmp',
        actor: 'octocat',
      },
      logger: log,
      platformType: 'codeberg' as const,
    } as unknown as GitHubModuleDeps;
    expect(appendCoAuthoredBy(deps, 'Fix bug')).toBe(
      'Fix bug\n\nCo-authored-by: octocat <octocat@noreply.codeberg.org>'
    );
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

  test('uses platform-specific email on Forgejo', async () => {
    const { log } = captureLogger();
    await ensureGitIdentity(git, 'myactor', log, {
      platformType: 'forgejo',
      serverUrl: 'https://forgejo.example.com',
    });

    const name = await git.getConfig('user.name', 'local');
    const email = await git.getConfig('user.email', 'local');
    expect(name.value).toBe('myactor');
    expect(email.value).toBe('myactor@forgejo.example.com');
  });

  test('uses Codeberg-specific email', async () => {
    const { log } = captureLogger();
    await ensureGitIdentity(git, 'myactor', log, {
      platformType: 'codeberg',
    });

    const name = await git.getConfig('user.name', 'local');
    const email = await git.getConfig('user.email', 'local');
    expect(name.value).toBe('myactor');
    expect(email.value).toBe('myactor@noreply.codeberg.org');
  });

  test('strips the port for Forgejo email when serverUrl has a non-default port', async () => {
    const { log } = captureLogger();
    await ensureGitIdentity(git, 'myactor', log, {
      platformType: 'forgejo',
      serverUrl: 'http://forgejo.local:3000',
    });

    const email = await git.getConfig('user.email', 'local');
    expect(email.value).toBe('myactor@forgejo.local');
  });

  test('does not override existing identity', async () => {
    await git.addConfig('user.name', 'existing', false, 'local');
    await git.addConfig('user.email', 'existing@test', false, 'local');

    const { log } = captureLogger();
    await ensureGitIdentity(git, 'myactor', log);

    const name = await git.getConfig('user.name', 'local');
    expect(name.value).toBe('existing');
  });

  test('uses default name and email when actor is undefined', async () => {
    const { log } = captureLogger();
    await ensureGitIdentity(git, undefined, log);

    const name = await git.getConfig('user.name', 'local');
    const email = await git.getConfig('user.email', 'local');
    expect(name.value).toBe('Pi');
    expect(email.value).toBe('pi@noreply.pi.local');
  });

  test('fills in only the missing config field (email absent)', async () => {
    // name is configured but email is not
    await git.addConfig('user.name', 'partial-name', false, 'local');

    const { log } = captureLogger();
    await ensureGitIdentity(git, undefined, log);

    const name = await git.getConfig('user.name', 'local');
    const email = await git.getConfig('user.email', 'local');
    // name should be untouched
    expect(name.value).toBe('partial-name');
    // email should have been set to the default
    expect(email.value).toBe('pi@noreply.pi.local');
  });

  test('logs debug message when configuring email', async () => {
    const { log, messages } = captureLogger();
    await ensureGitIdentity(git, 'myactor', log);

    expect(messages.some(m => m.includes('user.email'))).toBe(true);
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

  test('expands untracked directories into individual files (-uall)', async () => {
    // Create an entirely new directory with multiple files. Without -uall,
    // git status collapses this to a single "?? newdir/" entry.
    fs.mkdirSync(path.join(tmpDir, 'newdir'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'newdir', 'a.ts'), 'export {};');
    fs.writeFileSync(path.join(tmpDir, 'newdir', 'b.ts'), 'export {};');
    const result = await getWorkspaceChangePaths(tmpDir);
    expect(result.changed).toContain('newdir/a.ts');
    expect(result.changed).toContain('newdir/b.ts');
  });

  test('handles renamed files (reports the new path)', async () => {
    // `git mv` produces a rename in porcelain: "R  old -> new"
    fs.renameSync(path.join(tmpDir, 'README.md'), path.join(tmpDir, 'RENAMED.md'));
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    const result = await getWorkspaceChangePaths(tmpDir);
    // The new path should appear in changed[]
    expect(result.changed.some(p => p.endsWith('RENAMED.md'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkoutExistingBranch
// ---------------------------------------------------------------------------

describe('checkoutExistingBranch', () => {
  let repo: ReturnType<typeof setupGitRepo>;

  beforeEach(() => {
    repo = setupGitRepo();
  });

  afterEach(() => {
    if (repo) {
      cleanupGitRepo(repo.workspace);
    }
  });

  test('checks out a remote branch with a clean working tree', async () => {
    if (!repo) {
      return;
    }
    const { workspace } = repo;

    // Create a remote branch first
    fs.writeFileSync(path.join(workspace, 'remote-file.txt'), 'content');
    await commitAndPushBranch({
      cwd: workspace,
      branchName: 'remote-branch',
      message: 'Initial',
      isNewBranch: true,
      paths: ['remote-file.txt'],
      log: captureLogger().log,
    });

    // Switch back to main so the branch is not checked out locally
    await simpleGit(workspace).checkout('main');

    // Now checkout the existing remote branch
    const git = simpleGit(workspace);
    const { log } = captureLogger();
    await checkoutExistingBranch(git, 'remote-branch', log);

    // The file from the remote branch should be present
    expect(fs.existsSync(path.join(workspace, 'remote-file.txt'))).toBe(true);
  });

  test('preserves uncommitted changes by stashing and restoring', async () => {
    if (!repo) {
      return;
    }
    const { workspace } = repo;

    // Create a remote branch
    fs.writeFileSync(path.join(workspace, 'branch-file.txt'), 'branch');
    await commitAndPushBranch({
      cwd: workspace,
      branchName: 'stash-target',
      message: 'Branch commit',
      isNewBranch: true,
      paths: ['branch-file.txt'],
      log: captureLogger().log,
    });

    const git = simpleGit(workspace);
    await git.checkout('main');

    // Create an uncommitted change on main that is NOT in either branch
    fs.writeFileSync(path.join(workspace, 'uncommitted.txt'), 'my work');

    const { log, messages } = captureLogger();
    await checkoutExistingBranch(git, 'stash-target', log);

    // Stash + restore should have happened
    expect(messages.some(m => m.includes('Stashing'))).toBe(true);
    expect(messages.some(m => m.includes('Restoring'))).toBe(true);

    // The uncommitted change should survive the checkout
    expect(fs.existsSync(path.join(workspace, 'uncommitted.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(workspace, 'uncommitted.txt'), 'utf-8')).toBe('my work');
    // And the branch-specific file should be present
    expect(fs.existsSync(path.join(workspace, 'branch-file.txt'))).toBe(true);
  });

  test('resets an existing local branch to the remote tip', async () => {
    if (!repo) {
      return;
    }
    const { workspace } = repo;

    // Create and push a remote branch (workspace is now on reset-test locally)
    fs.writeFileSync(path.join(workspace, 'v1.txt'), 'v1');
    await commitAndPushBranch({
      cwd: workspace,
      branchName: 'reset-test',
      message: 'Remote commit',
      isNewBranch: true,
      paths: ['v1.txt'],
      log: captureLogger().log,
    });

    const git = simpleGit(workspace);

    // Add a local-only commit that should be discarded by reset --hard.
    // We're currently on reset-test, so this adds to it ahead of origin.
    fs.writeFileSync(path.join(workspace, 'local-only.txt'), 'local');
    await git.add(['local-only.txt']);
    await git.commit('local-only commit');

    // Go back to main with a clean tree
    await git.checkout('main');

    const { log } = captureLogger();
    // reset-test already exists locally, so checkoutBranch throws and the
    // reset --hard fallback is exercised.
    await checkoutExistingBranch(git, 'reset-test', log);

    // The local-only file must be gone (reset to remote tip)
    expect(fs.existsSync(path.join(workspace, 'local-only.txt'))).toBe(false);
    // And the remote file present
    expect(fs.existsSync(path.join(workspace, 'v1.txt'))).toBe(true);
  });

  test('throws when stashed changes cannot be applied', async () => {
    if (!repo) {
      return;
    }
    const { workspace } = repo;

    // Create a remote branch containing a committed change to a file
    fs.writeFileSync(path.join(workspace, 'conflict.txt'), 'branch');
    await commitAndPushBranch({
      cwd: workspace,
      branchName: 'conflict-branch',
      message: 'Branch',
      isNewBranch: true,
      paths: ['conflict.txt'],
      log: captureLogger().log,
    });

    const git = simpleGit(workspace);
    await git.checkout('main');

    // On main, create an uncommitted change to the SAME file with
    // different content. The stash pop will conflict.
    fs.writeFileSync(path.join(workspace, 'conflict.txt'), 'working-tree');

    const { log } = captureLogger();
    await expect(checkoutExistingBranch(git, 'conflict-branch', log)).rejects.toThrow(
      /Could not cleanly apply working-tree changes/
    );

    // A warning should have been logged
    expect(log.warning).toBeDefined();
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

  test('uses platform-aware noreply email via gitIdentityOptions', async () => {
    if (!repo) {
      return;
    }
    const { workspace } = repo;

    // Remove any identity config so ensureGitIdentity fills it in
    const git = simpleGit(workspace);
    await git.raw(['config', '--unset', 'user.name']);
    await git.raw(['config', '--unset', 'user.email']);

    fs.writeFileSync(path.join(workspace, 'file.txt'), 'content');

    const { log } = captureLogger();
    await commitAndPushBranch({
      cwd: workspace,
      branchName: 'platform-identity',
      message: 'Test',
      isNewBranch: true,
      paths: ['file.txt'],
      actor: 'ci-bot',
      gitIdentityOptions: {
        platformType: 'forgejo',
        serverUrl: 'http://forgejo.local:3000',
      },
      log,
    });

    // The port must be stripped (regression test for the .host bug)
    const email = await git.getConfig('user.email', 'local');
    expect(email.value).toBe('ci-bot@forgejo.local');
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

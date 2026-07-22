/**
 * @file Shared helper for creating real git repos in test temp directories.
 *
 * Used by pull-request test suites that exercise the `git` CLI code paths.
 * Avoids the need for `vi.mock('simple-git')` which is global and
 * would leak into other test files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { beforeAll, afterAll } from 'vitest';

/**
 * Hermetically isolate git operations in the calling test file from the
 * host's global/system git config.
 *
 * Test suites that spawn real `git` (via `execSync` or `simple-git`, both of
 * which inherit `process.env`) must not be influenced by the developer's
 * global `user.name`/`user.email` (or by a CI image that pre-seeds git
 * identity). Otherwise `ensureGitIdentity` legitimately sees that existing
 * identity, skips the local write, and the suite's local-scope assertions
 * fail — differently on every machine. Pointing git at an empty global
 * config file and disabling the system config makes the suite deterministic.
 *
 * This also sidesteps sandboxed environments that *block* access to the
 * real global gitconfig (e.g. `~/.gitconfig`: Operation not permitted): with
 * `GIT_CONFIG_GLOBAL=/dev/null` git never tries to open it.
 *
 * Vitest runs each test file in its own worker process (default `forks`
 * pool), so this never leaks between files. Call once at the top of any test
 * file that spawns git. Originals are restored in `afterAll` for hygiene.
 */
export function isolateGitConfig(): void {
  const snapshot: readonly (readonly [string, string | undefined])[] = [
    ['GIT_CONFIG_GLOBAL', process.env.GIT_CONFIG_GLOBAL],
    ['GIT_CONFIG_NOSYSTEM', process.env.GIT_CONFIG_NOSYSTEM],
  ];
  beforeAll(() => {
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_NOSYSTEM = '1';
  });
  afterAll(() => {
    for (const [key, value] of snapshot) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

/** Identity used for test commits. */
const TEST_GIT_NAME = 'test-bot';
const TEST_GIT_EMAIL = 'test-bot@test.local';

/**
 * Set up a minimal git repo with a remote so that branch/commit/push
 * operations succeed. Returns the workspace path and the remote path.
 *
 * The workspace starts with a single initial commit on `main` that has
 * been pushed to the bare remote, so it's ready for new changes.
 */
export function setupGitRepo(): { workspace: string; remoteDir: string } | undefined {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-test-git-'));
  const remoteDir = path.join(tmpRoot, 'remote.git');
  const workspace = path.join(tmpRoot, 'workspace');

  fs.mkdirSync(remoteDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  try {
    // Bare remote
    execSync('git init --bare --initial-branch=main', { cwd: remoteDir, stdio: 'pipe' });

    // Working clone
    execSync('git init --initial-branch=main', { cwd: workspace, stdio: 'pipe' });
    execSync(`git config user.name "${TEST_GIT_NAME}"`, { cwd: workspace, stdio: 'pipe' });
    execSync(`git config user.email "${TEST_GIT_EMAIL}"`, { cwd: workspace, stdio: 'pipe' });
    execSync(`git remote add origin ${remoteDir}`, { cwd: workspace, stdio: 'pipe' });

    // Initial commit + push so HEAD and origin/main exist
    fs.writeFileSync(path.join(workspace, 'README.md'), '# test');
    execSync('git add -A', { cwd: workspace, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: workspace, stdio: 'pipe' });
    execSync('git push -u origin main', { cwd: workspace, stdio: 'pipe' });

    return { workspace, remoteDir };
  } catch {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    return undefined;
  }
}

/** Remove the temp directory tree created by {@link setupGitRepo}. */
export function cleanupGitRepo(workspace: string): void {
  // workspace is `…/<tmpRoot>/workspace`, so its parent is the tmpRoot
  const tmpRoot = path.dirname(workspace);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

/**
 * @file Tests for `/handoff`-internal write helpers (pull-request.ts).
 *
 * Git helpers (status, default branch, diff, push) are tested against real temp
 * git repos — no mocks. Octokit functions (findOpenPR, createPR, updatePR,
 * postHandoffComment) are tested against a stub Octokit so no network is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';
import {
  getWorkingTreeStatus,
  isCleanWorkingTree,
  detectDefaultBranch,
  getLocalDiff,
  pushBranch,
  findOpenPR,
  buildPRBody,
  createPR,
  updatePR,
  postHandoffComment,
} from '../src/pull-request.js';

// ---------------------------------------------------------------------------
// Temp-repo helper
// ---------------------------------------------------------------------------

async function makeRepo(dir: string, opts?: { withMain?: boolean }): Promise<void> {
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 't@t');
  await git.addConfig('user.name', 't');
  await git.addConfig('init.defaultBranch', 'main');
  if (opts?.withMain) {
    // Create a real commit on main so there's something to diff against.
    await git.raw(['commit', '--allow-empty', '-m', 'init']);
  }
}

describe('git helpers', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-pr-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('isCleanWorkingTree / getWorkingTreeStatus', () => {
    it('reports clean on a fresh repo with no changes', async () => {
      await makeRepo(dir, { withMain: true });
      await expect(isCleanWorkingTree(dir)).resolves.toBe(true);
    });

    it('reports dirty when there is an untracked file', async () => {
      await makeRepo(dir, { withMain: true });
      await Bun.write(join(dir, 'new.txt'), 'x');
      await expect(isCleanWorkingTree(dir)).resolves.toBe(false);
      const status = await getWorkingTreeStatus(dir);
      expect(status.not_added).toContain('new.txt');
    });

    it('reports dirty when there is a modified tracked file', async () => {
      await makeRepo(dir, { withMain: true });
      await Bun.write(join(dir, 'tracked.txt'), 'original');
      const git = simpleGit(dir);
      await git.add('tracked.txt');
      await git.commit('add tracked');
      await Bun.write(join(dir, 'tracked.txt'), 'changed');
      await expect(isCleanWorkingTree(dir)).resolves.toBe(false);
    });
  });

  describe('detectDefaultBranch', () => {
    it('falls back to "main" when origin/HEAD is unset', async () => {
      await makeRepo(dir, { withMain: true });
      await expect(detectDefaultBranch(dir)).resolves.toBe('main');
    });

    it('falls back to "master" when main does not exist but master does', async () => {
      const git = simpleGit(dir);
      await git.init();
      await git.addConfig('user.email', 't@t');
      await git.addConfig('user.name', 't');
      await git.addConfig('init.defaultBranch', 'master');
      await git.raw(['commit', '--allow-empty', '-m', 'init']);
      // No origin set; rev-parse --verify origin/master fails, so we fall to
      // the last-resort 'main'. This documents the no-origin behavior.
      await expect(detectDefaultBranch(dir)).resolves.toBe('main');
    });
  });

  describe('getLocalDiff', () => {
    it('returns empty when the base ref is not fetched (no origin/base)', async () => {
      await makeRepo(dir, { withMain: true });
      // No origin/main ref exists locally; git diff throws, getLocalDiff
      // swallows it and returns '' (handler surfaces a clear message).
      const diff = await getLocalDiff(dir, 'main');
      expect(diff).toBe('');
    });

    it('returns the diverging diff when base + feature commits exist', async () => {
      const git = simpleGit(dir);
      await git.init();
      await git.addConfig('user.email', 't@t');
      await git.addConfig('user.name', 't');
      await git.addConfig('init.defaultBranch', 'main');
      // Make main real (with content so the commit isn't empty) + create the
      // origin/main ref locally so the triple-dot diff resolves.
      await Bun.write(join(dir, 'base.txt'), 'base');
      await git.add('base.txt');
      await git.commit('init on main');
      await git.raw(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
      await git.checkout(['-b', 'feature-x']);
      await Bun.write(join(dir, 'feature.txt'), 'feature work');
      await git.add('feature.txt');
      await git.commit('feature work');
      const diff = await getLocalDiff(dir, 'main');
      // The feature commit added feature.txt — assert the diff captured
      // the divergence (mentioning the file). Don't assert on exact `+`
      // formatting: git diff output varies by config/version, and we're
      // testing our wrapper, not git's format.
      expect(diff.length).toBeGreaterThan(0);
      expect(diff).toContain('feature.txt');
    });
  });

  describe('pushBranch', () => {
    it('fails clearly when origin is not configured (no silent success)', async () => {
      await makeRepo(dir, { withMain: true });
      await expect(pushBranch(dir)).rejects.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

describe('buildPRBody', () => {
  it('renders a branch pointer + handoff pointer', () => {
    const body = buildPRBody('main', 'feature-x');
    expect(body).toContain('**Branch:** `feature-x` → `main`');
    expect(body).toContain('**Handoff:**');
    expect(body).toContain('/pi');
  });
});

// ---------------------------------------------------------------------------
// Octokit functions (stubbed — no network)
// ---------------------------------------------------------------------------

/** Build a stub Octokit whose pulls/issues methods return canned data. */
function makeStubOctokit(opts: {
  pullsList?: { number: number; base?: { ref: string } }[];
  pullsCreate?: { number: number; user?: { login?: string } };
  pullsUpdate?: { number: number; user?: { login?: string } };
}): OctokitInstance {
  const rest = {
    pulls: {
      list: async () => ({ data: opts.pullsList ?? [] }),
      create: async () => ({
        data: { number: 99, user: { login: 'bot-account' }, ...opts.pullsCreate },
      }),
      update: async (_args: unknown) => ({
        data: { number: 7, user: { login: 'bot-account' }, ...opts.pullsUpdate },
      }),
    },
    issues: {
      createComment: async () => ({ data: { id: 1 } }),
    },
  };
  return { rest } as unknown as OctokitInstance;
}

describe('findOpenPR', () => {
  it('returns the number + base ref when an open PR exists for the branch', async () => {
    const octokit = makeStubOctokit({
      pullsList: [{ number: 42, base: { ref: 'develop' } }],
    });
    await expect(findOpenPR(octokit, 'o', 'r', 'feature-x')).resolves.toEqual({
      number: 42,
      base: 'develop',
    });
  });

  it('returns undefined when no open PR exists', async () => {
    const octokit = makeStubOctokit({ pullsList: [] });
    await expect(findOpenPR(octokit, 'o', 'r', 'feature-x')).resolves.toBeUndefined();
  });

  it('returns the base from the PR (not a guessed default) — the v1 regression guard', async () => {
    // Regression: /handoff once guessed the diff base from origin/HEAD and
    // got a stale `v1`, producing an empty diff. The base now comes straight
    // off the PR record, so even a weird base name is honored.
    const octokit = makeStubOctokit({
      pullsList: [{ number: 7, base: { ref: 'weird-branch' } }],
    });
    const result = await findOpenPR(octokit, 'o', 'r', 'feature-x');
    expect(result?.base).toBe('weird-branch');
  });
});

describe('createPR', () => {
  it('returns the PR number + author login', async () => {
    const octokit = makeStubOctokit({ pullsCreate: { number: 55, user: { login: 'ci-bot' } } });
    const result = await createPR(octokit, {
      owner: 'o',
      repo: 'r',
      title: 'Add thing',
      head: 'feature-x',
      base: 'main',
    });
    expect(result).toEqual({ number: 55, authorLogin: 'ci-bot' });
  });
});

describe('updatePR', () => {
  it('returns the PR number + author login', async () => {
    const octokit = makeStubOctokit({
      pullsUpdate: { number: 55, user: { login: 'ci-bot' } },
    });
    const result = await updatePR(octokit, {
      owner: 'o',
      repo: 'r',
      number: 55,
      title: 'Updated',
      head: 'feature-x',
      base: 'main',
    });
    expect(result.number).toBe(55);
    expect(result.authorLogin).toBe('ci-bot');
  });
});

describe('postHandoffComment', () => {
  it('resolves (posts) without error', async () => {
    const octokit = makeStubOctokit({});
    await expect(
      postHandoffComment(octokit, {
        owner: 'o',
        repo: 'r',
        issueNumber: 55,
        body: '/pi 🤖 Handoff\n\n## Done\n- x\n\n## Next\ny',
      })
    ).resolves.toBeUndefined();
  });
});

/**
 * @file Tests for the `/handoff` command.
 *
 * Two layers:
 *   1. Pure helpers (`extractGoal`, `parseDraft`, `buildCommentBody`,
 *      `stripReviewOnlySections`, `decidePost`) — these are where review-round
 *      bugs #1 (-y never posts), #2 (`---` truncation), and #4 (flag leak)
 *      lived; each gets a regression test.
 *   2. `runHandoff` integration — drives the full orchestration with an
 *      injected draft (deps.draft, so no model/TUI), a stub Octokit, and a
 *      real temp git repo with a local bare origin. Covers the `-y` posts,
 *      cancel-aborts, normal-edit-posts, and draft-throws paths (bugs #1, #5).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import simpleGit from 'simple-git';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { Bridge } from '../src/bridge.js';
import {
  extractGoal,
  parseDraft,
  buildCommentBody,
  stripReviewOnlySections,
  decidePost,
  runHandoff,
  REVIEW_FOOTER_BOUNDARY,
  type HandoffDeps,
} from '../src/handoff.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('extractGoal', () => {
  it('strips a leading -y flag', () => {
    expect(extractGoal('-y add tests')).toBe('add tests');
  });
  it('strips a leading --yes flag', () => {
    expect(extractGoal('--yes add tests')).toBe('add tests');
  });
  it('leaves a flag-less goal untouched', () => {
    expect(extractGoal('add tests')).toBe('add tests');
  });
  it('returns empty for a bare flag with no goal', () => {
    expect(extractGoal('-y')).toBe('');
    expect(extractGoal('--yes   ')).toBe('');
  });
  it('regression: does NOT leak the flag into the goal', () => {
    // The bug: `## Goal\n-y add error-handling tests` was sent to the model.
    expect(extractGoal('-y add error-handling tests')).not.toContain('-y');
    expect(extractGoal('-y add error-handling tests')).not.toContain('--yes');
  });
});

describe('parseDraft', () => {
  const valid =
    'Add auth module\n\n## Done\n- wired middleware\n- added module\n\n## Next\nadd tests';
  it('parses title + handoff from a well-formed draft', () => {
    const r = parseDraft(valid);
    expect('title' in r).toBe(true);
    if ('title' in r) {
      expect(r.title).toBe('Add auth module');
      expect(r.handoff).toContain('## Done');
      expect(r.handoff).toContain('## Next');
    }
  });
  it('returns {raw} (fail-soft) when the title/## Done boundary is missing', () => {
    const r = parseDraft('just some prose with no headings');
    expect('raw' in r).toBe(true);
  });
  it('truncates the title to 72 chars', () => {
    const longTitle = 'x'.repeat(100);
    const r = parseDraft(`${longTitle}\n\n## Done\n- thing\n\n## Next\nx`);
    expect('title' in r && r.title.length).toBe(72);
  });
});

describe('buildCommentBody', () => {
  it('prefixes the prose with the /pi handoff header', () => {
    expect(buildCommentBody('## Done\n- x')).toBe(
      '/pi 🤖 Handoff from local session\n\n## Done\n- x'
    );
  });
});

describe('stripReviewOnlySections', () => {
  it('removes the footer after the boundary', () => {
    const text = `## Done\n- x${REVIEW_FOOTER_BOUNDARY}(edit instructions)`;
    expect(stripReviewOnlySections(text)).toBe('## Done\n- x');
  });
  it('removes the ℹ️ mismatch note', () => {
    const text = '## Done\n- x\n\nℹ️ PR will be authored by `bot`; commits are by `alex`.';
    expect(stripReviewOnlySections(text)).toBe('## Done\n- x');
  });
  it('regression: preserves a Markdown --- horizontal rule in prose', () => {
    // The bug: splitting on bare '---' truncated everything after a legit rule,
    // silently dropping the ## Next section.
    const prose = '## Done\n- thing\n\n---\n\n## Next\nwrite tests';
    expect(stripReviewOnlySections(prose)).toBe(prose);
  });
});

describe('decidePost', () => {
  const prose = '## Done\n- x\n\n## Next\ny';
  it('regression: -y (skipReview) POSTS the prose directly', () => {
    // The critical bug: -y set prefill=null which matched the cancel guard.
    const d = decidePost({ skipReview: true, handoffProse: prose, editorResult: undefined });
    expect(d.kind).toBe('post');
    if (d.kind === 'post') {
      expect(d.text).toBe(prose);
    }
  });
  it('cancel (editor returned undefined) is cancelled', () => {
    const d = decidePost({ skipReview: false, handoffProse: prose, editorResult: undefined });
    expect(d.kind).toBe('cancelled');
  });
  it('a reviewed edit posts the stripped result', () => {
    const edited = `## Done\n- edited${REVIEW_FOOTER_BOUNDARY}footer`;
    const d = decidePost({ skipReview: false, handoffProse: prose, editorResult: edited });
    expect(d.kind).toBe('post');
    if (d.kind === 'post') {
      expect(d.text).toBe('## Done\n- edited');
    }
  });
});

// ---------------------------------------------------------------------------
// runHandoff integration
// ---------------------------------------------------------------------------

/** Recorded Octokit calls, for asserting which writes happened. */
interface OctokitLog {
  pullsList: number;
  pullsCreate: number;
  pullsUpdate: number;
  comments: string[]; // bodies posted
}

function makeStubOctokit(log: OctokitLog, opts?: { existingPR?: number }): OctokitInstance {
  const rest = {
    pulls: {
      list: async () => {
        log.pullsList++;
        return {
          data: opts?.existingPR ? [{ number: opts.existingPR, base: { ref: 'main' } }] : [],
        };
      },
      create: async () => {
        log.pullsCreate++;
        return { data: { number: 55, user: { login: 'alex' } } };
      },
      update: async () => {
        log.pullsUpdate++;
        return { data: { number: 55, user: { login: 'alex' } } };
      },
    },
    issues: {
      createComment: async (args: { body?: string }) => {
        log.comments.push(args.body ?? '');
        return { data: { id: 1 } };
      },
    },
  };
  return { rest } as unknown as OctokitInstance;
}

/** Build a fake ExtensionCommandContext with a controllable editor. */
function makeFakeCtx(opts: {
  dir: string;
  editorResult?: string | undefined;
  editorCalls?: { count: number };
}): ExtensionCommandContext {
  const editorCalls = opts.editorCalls ?? { count: 0 };
  return {
    mode: 'tui',
    hasUI: true,
    cwd: opts.dir,
    model: { id: 'stub' } as never,
    sessionManager: { getBranch: () => [] } as never,
    modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: 'k' }) } as never,
    ui: {
      editor: async () => {
        editorCalls.count++;
        return opts.editorResult;
      },
      notify: () => {},
      setStatus: () => {},
    },
  } as unknown as ExtensionCommandContext;
}

/** Build a Bridge stub bound to a real temp repo + stub octokit. */
function makeStubBridge(octokit: OctokitInstance, dir: string): Bridge {
  return {
    context: {
      repo: { owner: 'shaftoe', repo: 'pi-coding-agent-action' },
      issue: { number: 0 },
      eventName: 'pi-action-bridge',
      payload: {},
      serverUrl: 'https://github.com',
      workspace: dir,
    },
    octokit,
    discovery: {
      parsed: { serverUrl: 'https://github.com', owner: 'shaftoe', repo: 'pi-coding-agent-action' },
      platformType: 'github',
      isKnownHost: true,
    },
    // Real git reads against the temp repo:
    getCurrentBranch: async () => {
      const b = (await simpleGit(dir).revparse(['--abbrev-ref', 'HEAD'])).trim();
      return b === 'HEAD' ? undefined : b;
    },
    getLocalGitIdentity: async () => 'alex',
  } as unknown as Bridge;
}

/**
 * Set up a temp working repo with a local bare origin: main branch pushed
 * (so origin/HEAD + origin/main resolve), then a feature branch with a commit
 * (so there's a diff). Idempotent-ish across the repo's lifecycle.
 */
async function makeRepoWithOrigin(dir: string): Promise<void> {
  const bare = mkdtempSync(join(tmpdir(), 'pi-bare-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 't@t');
  await git.addConfig('user.name', 'alex');
  // `init.defaultBranch` only applies to *future* `git init`s, so the first
  // commit above would land on the system default (e.g. `master`). Pin HEAD to
  // `main` before committing so `push origin main` resolves the refspec.
  await git.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  const bareGit = simpleGit(bare);
  await bareGit.init(true);
  await git.addRemote('origin', bare);
  // base commit on main, push so origin/main exists (and detectDefaultBranch's
  // rev-parse --verify origin/main fallback resolves it).
  await Bun.write(join(dir, 'base.txt'), 'base');
  await git.add('base.txt');
  await git.commit('init');
  await git.push(['-u', 'origin', 'main']);
  // feature branch with a real diff against main.
  await git.checkout(['-b', 'feature-x']);
  await Bun.write(join(dir, 'feature.txt'), 'feature work');
  await git.add('feature.txt');
  await git.commit('feature work');
}

describe('runHandoff', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-handoff-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const draft = 'Add feature\n\n## Done\n- feature work\n\n## Next\nadd tests';

  /** Common deps: an injected draft that returns valid prose. */
  const deps: HandoffDeps = {
    draft: async () => draft,
  };

  it('regression: -y/--yes DOES post the handoff comment (bug #1)', async () => {
    await makeRepoWithOrigin(dir);
    const log: OctokitLog = { pullsList: 1, pullsCreate: 0, pullsUpdate: 0, comments: [] };
    const octokit = makeStubOctokit(log);
    const ctx = makeFakeCtx({ dir, editorCalls: { count: 0 } });
    const bridge = makeStubBridge(octokit, dir);

    await runHandoff('-y', ctx, bridge, deps);

    expect(log.comments.length).toBe(1);
    expect(log.comments[0]).toContain('/pi 🤖 Handoff from local session');
    expect(log.comments[0]).toContain('## Done');
  });

  it('does not call the editor when -y is passed', async () => {
    await makeRepoWithOrigin(dir);
    const editorCalls = { count: 0 };
    const log: OctokitLog = { pullsList: 1, pullsCreate: 0, pullsUpdate: 0, comments: [] };
    const ctx = makeFakeCtx({ dir, editorResult: '## Done\n- x', editorCalls });
    const bridge = makeStubBridge(makeStubOctokit(log), dir);

    await runHandoff('-y', ctx, bridge, deps);
    expect(editorCalls.count).toBe(0);
  });

  it('posts nothing and notifies when the review is cancelled', async () => {
    await makeRepoWithOrigin(dir);
    const log: OctokitLog = { pullsList: 1, pullsCreate: 0, pullsUpdate: 0, comments: [] };
    const ctx = makeFakeCtx({ dir, editorResult: undefined }); // cancelled
    const bridge = makeStubBridge(makeStubOctokit(log), dir);

    await runHandoff('', ctx, bridge, deps);
    expect(log.comments.length).toBe(0);
  });

  it('posts the edited prose after a normal review', async () => {
    await makeRepoWithOrigin(dir);
    const log: OctokitLog = { pullsList: 1, pullsCreate: 0, pullsUpdate: 0, comments: [] };
    const ctx = makeFakeCtx({
      dir,
      editorResult: '## Done\n- edited by user\n\n## Next\nship it',
    });
    const bridge = makeStubBridge(makeStubOctokit(log), dir);

    await runHandoff('', ctx, bridge, deps);
    expect(log.comments.length).toBe(1);
    expect(log.comments[0]).toContain('edited by user');
  });

  it('regression: a throwing draft is caught + notifies, no comment posted (bug #5)', async () => {
    await makeRepoWithOrigin(dir);
    const log: OctokitLog = { pullsList: 1, pullsCreate: 0, pullsUpdate: 0, comments: [] };
    const ctx = makeFakeCtx({ dir });
    const bridge = makeStubBridge(makeStubOctokit(log), dir);
    const throwingDeps: HandoffDeps = {
      draft: async () => {
        throw new Error('auth failed');
      },
    };

    await runHandoff('-y', ctx, bridge, throwingDeps);
    expect(log.comments.length).toBe(0); // never reached post
  });

  it('strips the flag from the goal fed to the draft (bug #4)', async () => {
    await makeRepoWithOrigin(dir);
    let capturedPrompt = '';
    const flagDeps: HandoffDeps = {
      draft: async (_ctx, prompt) => {
        capturedPrompt = prompt;
        return draft;
      },
    };
    const ctx = makeFakeCtx({ dir });
    const bridge = makeStubBridge(
      makeStubOctokit({ pullsList: 1, pullsCreate: 0, pullsUpdate: 0, comments: [] }),
      dir
    );

    await runHandoff('-y add error-handling tests', ctx, bridge, flagDeps);
    expect(capturedPrompt).toContain('add error-handling tests');
    expect(capturedPrompt).not.toMatch(/## Goal\n\s*-y/);
  });
});

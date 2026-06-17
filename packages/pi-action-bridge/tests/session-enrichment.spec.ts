/**
 * @file Tests for session enrichment (Phase 4 / §6).
 *
 * The load-bearing assertion: with more comments than the slice window, the
 * injected message contains the **most recent** N (GitHub returns oldest-first,
 * so this proves the fetch-then-slice-last-N dodge from §6 works — it would
 * silently inject the *oldest* N otherwise).
 *
 * Uses a mock {@link Bridge} (same pattern as `tools.spec.ts`) and a minimal
 * fake `ExtensionAPI` to drive the one-shot `before_agent_start` hook.
 */

import { describe, it, expect } from 'bun:test';
import type {
  IssueOrPRThread,
  ThreadComment,
  GetIssueOrPRThreadParams,
} from '@alexanderfortin/pi-platform-github';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';
import type { PlatformContext, PlatformProvider } from '@alexanderfortin/pi-orchestrator';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Bridge } from '../src/bridge.js';
import {
  buildEnrichmentMessage,
  enrichThread,
  registerSessionEnrichment,
  ENRICHMENT_CUSTOM_TYPE,
} from '../src/hooks/session-enrichment.js';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const baseContext: PlatformContext = {
  repo: { owner: 'shaftoe', repo: 'pi-coding-agent-action' },
  issue: { number: 0 },
  eventName: 'pi-action-bridge',
  payload: {},
  serverUrl: 'https://github.com',
  workspace: '/cwd',
};

function makeBridge(opts: {
  thread?: IssueOrPRThread | undefined;
  currentPR?: number | undefined;
}): Bridge {
  const provider: Partial<PlatformProvider> = {
    getContext: () => baseContext,
    getIssueOrPRThread: async (_params?: GetIssueOrPRThreadParams) => opts.thread,
  };
  return {
    provider: provider as PlatformProvider,
    context: baseContext,
    octokit: {} as OctokitInstance,
    discovery: {
      parsed: { serverUrl: 'https://github.com', owner: 'shaftoe', repo: 'pi-coding-agent-action' },
      platformType: 'github',
      isKnownHost: true,
    },
    getCurrentBranch: async () => 'feature-x',
    resolveCurrentPR: async () => opts.currentPR,
  } as unknown as Bridge;
}

/** Build a thread with `n` issue comments, oldest-first (as the API returns). */
function threadWithComments(n: number, isPR = true): IssueOrPRThread {
  const comments: ThreadComment[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    author: i % 2 === 0 ? 'reviewer' : 'ci-bot',
    author_type: i % 2 === 0 ? 'user' : 'bot',
    created_at: `2026-06-1${i}T00:00:00Z`,
    body: `comment body #${i + 1}`,
  }));
  return {
    number: 42,
    title: 'Add bridge enrichment',
    body: 'Inject PR context on first turn',
    state: 'open',
    author: 'alex',
    author_type: 'user',
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
    closed_at: undefined,
    merged_at: undefined,
    labels: ['enhancement'],
    is_pull_request: isPR,
    head_branch: 'feature-x',
    base_branch: 'main',
    head_sha: 'abc123',
    comments,
    review_comments: [],
  };
}

/** Minimal fake ExtensionAPI that captures the before_agent_start handler. */
function fakePi(): ExtensionAPI & { fire(): Promise<unknown> } {
  let handler: ((event: unknown) => Promise<unknown>) | undefined;
  return {
    on: (event: string, h: (event: unknown) => Promise<unknown>) => {
      if (event === 'before_agent_start') {
        handler = h;
      }
    },
    fire: () => (handler ? handler({}) : Promise.resolve(undefined)),
  } as unknown as ExtensionAPI & { fire(): Promise<unknown> };
}

// ---------------------------------------------------------------------------
// buildEnrichmentMessage — the slice-last-N target
// ---------------------------------------------------------------------------

describe('buildEnrichmentMessage', () => {
  it('injects the MOST RECENT N comments, not the oldest (the §6 gotcha)', () => {
    // 5 comments, window 3 → expect #3, #4, #5 (newest), NOT #1, #2 (oldest).
    const thread = threadWithComments(5);
    const text = buildEnrichmentMessage(thread, 3);

    expect(text).toContain('comment body #3');
    expect(text).toContain('comment body #4');
    expect(text).toContain('comment body #5');
    expect(text).not.toContain('comment body #1');
    expect(text).not.toContain('comment body #2');
  });

  it('labels the slice as "last N of M"', () => {
    const text = buildEnrichmentMessage(threadWithComments(5), 3);
    expect(text).toContain('Recent comments (last 3 of 5):');
  });

  it('injects all comments when fewer than the window', () => {
    const text = buildEnrichmentMessage(threadWithComments(2), 3);
    expect(text).toContain('Recent comments (last 2 of 2):');
    expect(text).toContain('comment body #1');
    expect(text).toContain('comment body #2');
  });

  it('handles a thread with zero comments', () => {
    const text = buildEnrichmentMessage(threadWithComments(0), 3);
    expect(text).toContain('Recent comments: none yet.');
  });

  it('renders PR metadata (title, state, branches, labels)', () => {
    const text = buildEnrichmentMessage(threadWithComments(1), 3);
    expect(text).toContain('Pull Request #42: Add bridge enrichment');
    expect(text).toContain('State: OPEN');
    expect(text).toContain('Head Branch: feature-x');
    expect(text).toContain('Base Branch: main');
    expect(text).toContain('Labels: "enhancement"');
  });

  it('points the agent at get_thread for the full thread', () => {
    const text = buildEnrichmentMessage(threadWithComments(1), 3);
    expect(text).toContain('`get_thread`');
  });
});

// ---------------------------------------------------------------------------
// enrichThread
// ---------------------------------------------------------------------------

describe('enrichThread', () => {
  it('returns undefined when no PR is linked to the branch (silent, §6)', async () => {
    const result = await enrichThread(
      makeBridge({ thread: threadWithComments(3), currentPR: undefined })
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when the provider has no thread', async () => {
    const result = await enrichThread(makeBridge({ thread: undefined, currentPR: 42 }));
    expect(result).toBeUndefined();
  });

  it('returns the message + typed details for a linked PR', async () => {
    const result = await enrichThread(makeBridge({ thread: threadWithComments(5), currentPR: 42 }));
    expect(result).toBeDefined();
    expect(result?.message.customType).toBe(ENRICHMENT_CUSTOM_TYPE);
    expect(result?.message.display).toBe(true);
    expect(result?.details).toEqual({
      pr_number: 42,
      injected_comments: 3,
      total_comments: 5,
    });
    // And the content really did slice the last 3:
    expect(result?.message.content).toContain('comment body #5');
    expect(result?.message.content).not.toContain('comment body #1');
  });

  it('defaults the window to RECENT_COMMENT_COUNT (3)', async () => {
    const result = await enrichThread(
      makeBridge({ thread: threadWithComments(10), currentPR: 42 })
    );
    expect(result?.details.injected_comments).toBe(3);
    expect(result?.details.total_comments).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// registerSessionEnrichment — one-shot guard + auto_sync gate
// ---------------------------------------------------------------------------

describe('registerSessionEnrichment', () => {
  it('injects exactly once per session (one-shot guard)', async () => {
    const pi = fakePi();
    const bridge = makeBridge({ thread: threadWithComments(3), currentPR: 42 });
    registerSessionEnrichment(pi, bridge);

    const first = await pi.fire();
    const second = await pi.fire();

    expect(first).toBeDefined();
    expect((first as { message?: unknown }).message).toBeDefined();
    // Second fire is a no-op (guard set, even though it succeeded).
    expect(second).toBeUndefined();
  });

  it('does not retry after a failed attempt (guard set before fetch)', async () => {
    const pi = fakePi();
    // resolveCurrentPR throws → enrichThread throws → caught, no message.
    const bridge = {
      ...makeBridge({ currentPR: 42 }),
      resolveCurrentPR: async () => {
        throw new Error('network down');
      },
    } as unknown as Bridge;
    registerSessionEnrichment(pi, bridge);

    const first = await pi.fire();
    const second = await pi.fire();
    expect(first).toBeUndefined();
    expect(second).toBeUndefined(); // not retried — would otherwise fail every turn
  });

  it('reset() re-arms the guard', async () => {
    const pi = fakePi();
    const bridge = makeBridge({ thread: threadWithComments(3), currentPR: 42 });
    const handle = registerSessionEnrichment(pi, bridge);

    await pi.fire();
    expect(await pi.fire()).toBeUndefined(); // armed-off
    handle.reset();
    expect(await pi.fire()).toBeDefined(); // armed-on again
  });

  it('never injects when autoSync is false', async () => {
    const pi = fakePi();
    const bridge = makeBridge({ thread: threadWithComments(3), currentPR: 42 });
    registerSessionEnrichment(pi, bridge, { autoSync: false });

    const first = await pi.fire();
    const second = await pi.fire();
    expect(first).toBeUndefined();
    expect(second).toBeUndefined();
  });
});

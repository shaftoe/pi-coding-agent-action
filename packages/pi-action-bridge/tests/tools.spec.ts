/**
 * @file Tests for the `get_thread` and `get_pr_diff` tools.
 *
 * Uses a mock {@link Bridge} that closes over a stub provider + stub Octokit +
 * a controllable `resolveCurrentPR`. No network. Covers:
 *   - shape (name, label, description, parameter schema)
 *   - explicit-number happy path
 *   - auto-resolve from git branch (the bridge's value-add)
 *   - not-found / no-PR-linked error returns
 *   - diff truncation via the shared `truncateDiff` helper
 */

import { describe, it, expect } from 'bun:test';
import type {
  IssueOrPRThread,
  GetIssueOrPRThreadParams,
} from '@alexanderfortin/pi-platform-github';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';
import type { PlatformContext, PlatformProvider } from '@alexanderfortin/pi-orchestrator';
import { getThreadToolFactory } from '../src/tools/get-thread.js';
import type { GetThreadDetails } from '../src/tools/get-thread.js';
import { getPRDiffToolFactory } from '../src/tools/get-pr-diff.js';
import type { GetPRDiffDetails } from '../src/tools/get-pr-diff.js';
import type { Bridge } from '../src/bridge.js';

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

/** Minimal Bridge stub: controllable resolveCurrentPR + a fake provider. */
function makeBridge(opts: {
  thread?: IssueOrPRThread | undefined;
  diff?: string | undefined;
  currentPR?: number | undefined;
}): Bridge {
  const provider: Partial<PlatformProvider> = {
    getContext: () => baseContext,
    getIssueOrPRThread: async (_params?: GetIssueOrPRThreadParams) => opts.thread,
    // Provider types getPRDiff as Promise<string> (never undefined); the tool
    // handles the empty string as "no diff", so map undefined -> '' here.
    getPRDiff: async () => opts.diff ?? '',
  };
  const octokit = {} as OctokitInstance;
  // Cast: Bridge's constructor is private and we only need the public surface
  // the tools touch (provider, context, resolveCurrentPR).
  return {
    provider: provider as PlatformProvider,
    context: baseContext,
    octokit,
    discovery: {
      parsed: {
        serverUrl: 'https://github.com',
        owner: 'shaftoe',
        repo: 'pi-coding-agent-action',
      },
      platformType: 'github',
      isKnownHost: true,
    },
    getCurrentBranch: async () => 'feature-x',
    resolveCurrentPR: async () => opts.currentPR,
  } as unknown as Bridge;
}

const fakeThread: IssueOrPRThread = {
  number: 42,
  title: 'Add bridge tools',
  body: 'Implements get_thread + get_pr_diff',
  state: 'open',
  author: 'alex',
  author_type: 'user',
  created_at: '2026-06-15T00:00:00Z',
  updated_at: '2026-06-15T00:00:00Z',
  closed_at: undefined,
  merged_at: undefined,
  labels: ['enhancement'],
  is_pull_request: true,
  head_branch: 'feature-x',
  base_branch: 'main',
  head_sha: 'abc123',
  comments: [
    {
      id: 1,
      author: 'reviewer',
      author_type: 'user',
      created_at: '2026-06-15T01:00:00Z',
      body: 'LGTM',
      is_triggering_comment: false,
    },
  ],
  review_comments: [],
};

// ---------------------------------------------------------------------------
// get_thread
// ---------------------------------------------------------------------------

describe('get_thread tool', () => {
  it('has the expected name, label, and read-only description', () => {
    const tool = getThreadToolFactory(makeBridge({}));
    expect(tool.name).toBe('get_thread');
    expect(tool.label).toBe('Get Issue/PR Thread');
    expect(tool.description).toContain('Read-only');
  });

  it('exposes owner/repo/issue_number/max_comments params', () => {
    const tool = getThreadToolFactory(makeBridge({}));
    const schema = tool.parameters as { properties?: Record<string, unknown> };
    expect(schema.properties).toBeDefined();
    for (const p of ['owner', 'repo', 'issue_number', 'max_comments']) {
      expect(schema.properties?.[p]).toBeDefined();
    }
  });

  it('returns a formatted thread when an explicit issue_number is given', async () => {
    const tool = getThreadToolFactory(makeBridge({ thread: fakeThread }));
    const result = await tool.execute(
      'call-1',
      { issue_number: 42 },
      undefined,
      undefined,
      undefined as never
    );
    expect(result.details).toEqual({
      issue_number: 42,
      found: true,
      is_pull_request: true,
      state: 'open',
      comment_count: 1,
    } satisfies GetThreadDetails);
    // formatThreadAsText output is the shared format; just assert the header
    // survives (proves the helper was wired and the thread reached it).
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Pull Request #42: Add bridge tools');
  });

  it('auto-resolves the current PR from the branch when issue_number is omitted', async () => {
    const tool = getThreadToolFactory(makeBridge({ thread: fakeThread, currentPR: 42 }));
    const result = await tool.execute('call-2', {}, undefined, undefined, undefined as never);
    expect((result.details as GetThreadDetails).issue_number).toBe(42);
    expect((result.details as GetThreadDetails).found).toBe(true);
  });

  it('returns a clear message when no number is given and no PR is linked', async () => {
    const tool = getThreadToolFactory(makeBridge({ thread: fakeThread, currentPR: undefined }));
    const result = await tool.execute('call-3', {}, undefined, undefined, undefined as never);
    expect((result.details as GetThreadDetails).found).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain(
      'no open PR is linked to the current branch'
    );
  });

  it('returns not-found when the provider returns undefined', async () => {
    const tool = getThreadToolFactory(makeBridge({ thread: undefined, currentPR: undefined }));
    const result = await tool.execute(
      'call-4',
      { issue_number: 999 },
      undefined,
      undefined,
      undefined as never
    );
    expect((result.details as GetThreadDetails).found).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('#999 not found');
  });
});

// ---------------------------------------------------------------------------
// get_pr_diff
// ---------------------------------------------------------------------------

describe('get_pr_diff tool', () => {
  it('has the expected name and read-only description', () => {
    const tool = getPRDiffToolFactory(makeBridge({}));
    expect(tool.name).toBe('get_pr_diff');
    expect(tool.description).toContain('Read-only');
  });

  it('exposes owner/repo/pull_number/max_lines/ignore_files params', () => {
    const tool = getPRDiffToolFactory(makeBridge({}));
    const schema = tool.parameters as { properties?: Record<string, unknown> };
    for (const p of ['owner', 'repo', 'pull_number', 'max_lines', 'ignore_files']) {
      expect(schema.properties?.[p]).toBeDefined();
    }
  });

  it('returns the diff wrapped in a code fence when pull_number is given', async () => {
    const diff = 'diff --git a/x b/x\n+hello\n';
    const tool = getPRDiffToolFactory(makeBridge({ diff }));
    const result = await tool.execute(
      'call-1',
      { pull_number: 7 },
      undefined,
      undefined,
      undefined as never
    );
    expect(result.details).toMatchObject({
      pull_number: 7,
      truncated: false,
    } satisfies Partial<GetPRDiffDetails>);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('PR #7 Diff:');
    expect(text).toContain('```diff');
    expect(text).toContain('+hello');
  });

  it('auto-resolves the current PR from the branch when pull_number is omitted', async () => {
    const tool = getPRDiffToolFactory(makeBridge({ diff: '+x\n', currentPR: 7 }));
    const result = await tool.execute('call-2', {}, undefined, undefined, undefined as never);
    expect((result.details as GetPRDiffDetails).pull_number).toBe(7);
  });

  it('returns a clear message when no number is given and no PR is linked', async () => {
    const tool = getPRDiffToolFactory(makeBridge({ diff: '+x\n', currentPR: undefined }));
    const result = await tool.execute('call-3', {}, undefined, undefined, undefined as never);
    expect((result.details as GetPRDiffDetails).pull_number).toBe(0);
    expect((result.content[0] as { text: string }).text).toContain(
      'no open PR is linked to the current branch'
    );
  });

  it('returns not-found when the provider returns undefined/empty', async () => {
    const tool = getPRDiffToolFactory(makeBridge({ diff: undefined }));
    const result = await tool.execute(
      'call-4',
      { pull_number: 5 },
      undefined,
      undefined,
      undefined as never
    );
    expect((result.details as GetPRDiffDetails).lines).toBe(0);
    expect((result.content[0] as { text: string }).text).toContain('No diff available');
  });

  it('truncates a large diff and flags it in details', async () => {
    // 2000 lines — exceeds the default 1000-line budget.
    const big = Array.from({ length: 2000 }, (_, i) => `+line ${i}`).join('\n');
    const tool = getPRDiffToolFactory(makeBridge({ diff: big }));
    const result = await tool.execute(
      'call-5',
      { pull_number: 9 },
      undefined,
      undefined,
      undefined as never
    );
    const details = result.details as GetPRDiffDetails;
    expect(details.truncated).toBe(true);
    expect(details.truncated_reason).toBe('lines');
    expect((result.content[0] as { text: string }).text).toContain('truncated at 1000 lines');
  });
});

/**
 * @file Tests for {@link packages/pi-action-bridge/src/octokit.ts}.
 *
 * Covers the I/O layer the orchestration tests stub out via a fake `FindPrFn`:
 *   - `createOctokit` — conditional `baseUrl` wiring per forge + auth wiring.
 *   - `findPullRequestForBranch` — raw Octokit → `NormalizedPR` projection,
 *     the `head`/`state`/`per_page` request shape, abort-signal threading,
 *     and the empty-list → `null` path.
 *   - `createOctokitFindPr` — deferred token resolution + missing-token throw.
 *
 * `apiBaseUrlFromServerUrl` itself is tested in `pi-platform-github` (its
 * home since the co-location move); these tests cover only the bridge-side
 * wiring. No network: `findPullRequestForBranch` is driven by a structurally-
 * typed fake Octokit whose `rest.pulls.list` is stubbed.
 */
import { describe, it, expect } from 'vitest';
import {
  createOctokit,
  findPullRequestForBranch,
  createOctokitFindPr,
  postIssueComment,
  readIssueThread,
  normalizeComment,
  createOctokitPostComment,
  createOctokitReadThread,
  DEFAULT_MAX_THREAD_COMMENTS,
} from '../src/octokit.js';
import type { OctokitInstance } from '@alexanderfortin/pi-platform-github/types';

// ---------------------------------------------------------------------------
// createOctokit — baseUrl + auth wiring
// ---------------------------------------------------------------------------

describe('createOctokit', () => {
  it('uses Octokit default baseUrl for github.com (no baseUrl option set)', () => {
    const octokit = createOctokit('fake-token', 'https://github.com');
    // apiBaseUrlFromServerUrl returns undefined for github.com, so baseUrl is
    // not passed and Octokit falls back to its built-in api.github.com default.
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe('https://api.github.com');
  });

  it('sets baseUrl to /api/v1 for codeberg', () => {
    const octokit = createOctokit('fake-token', 'https://codeberg.org');
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe('https://codeberg.org/api/v1');
  });

  it('sets baseUrl to /api/v1 for forgejo', () => {
    const octokit = createOctokit('fake-token', 'https://git.forgejo.example');
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe('https://git.forgejo.example/api/v1');
  });

  it('sets baseUrl to /api/v3 for self-hosted GHE', () => {
    const octokit = createOctokit('fake-token', 'https://github.company.internal');
    expect(octokit.request.endpoint.DEFAULTS.baseUrl).toBe(
      'https://github.company.internal/api/v3'
    );
  });

  it('passes the token as auth', () => {
    const octokit = createOctokit('my-token', 'https://github.com');
    expect(octokit.auth).toBeTypeOf('function');
  });
});

// ---------------------------------------------------------------------------
// resolveGitHubToken — now lives in @alexanderfortin/pi-platform-github and is
// covered by packages/pi-platform-github/tests/auth.spec.ts (not duplicated
// here). The bridge imports it for its octokit factories only.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// findPullRequestForBranch — projection + request shape + signal
// ---------------------------------------------------------------------------

/** A raw `pulls.list` item, loosely shaped like Octokit's response. */
type RawPR = Record<string, unknown>;

function makeOctokit(listData: RawPR[] = []): {
  octokit: OctokitInstance;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const octokit = {
    rest: {
      pulls: {
        list: async (params: unknown) => {
          calls.push(params);
          return { data: listData };
        },
      },
    },
  } as unknown as OctokitInstance;
  return { octokit, calls };
}

const params = { owner: 'owner', repo: 'repo', branch: 'feature-x' };

describe('findPullRequestForBranch', () => {
  it('projects the first matching PR into a NormalizedPR', async () => {
    const { octokit } = makeOctokit([
      {
        number: 42,
        title: 'Add foo',
        state: 'open',
        draft: false,
        html_url: 'https://github.com/owner/repo/pull/42',
        head: { ref: 'feature-x', sha: 'abc123' },
        base: { ref: 'main' },
        user: { login: 'octocat' },
        updated_at: '2024-01-01T00:00:00Z',
      },
    ]);
    const pr = await findPullRequestForBranch(octokit, params);
    expect(pr).toEqual({
      number: 42,
      title: 'Add foo',
      state: 'open',
      draft: false,
      html_url: 'https://github.com/owner/repo/pull/42',
      head: { ref: 'feature-x', sha: 'abc123' },
      base: { ref: 'main' },
      author: 'octocat',
      updated_at: '2024-01-01T00:00:00Z',
    });
  });

  it('returns null when the list is empty', async () => {
    const { octokit } = makeOctokit([]);
    const pr = await findPullRequestForBranch(octokit, params);
    expect(pr).toBeNull();
  });

  it('requests only open PRs for owner:branch with per_page 1', async () => {
    const { octokit, calls } = makeOctokit([]);
    await findPullRequestForBranch(octokit, params);
    expect(calls[0]).toEqual({
      owner: 'owner',
      repo: 'repo',
      head: 'owner:feature-x',
      state: 'open',
      per_page: 1,
    });
  });

  it('normalises a closed state to "closed" and anything else to "open"', async () => {
    const { octokit: o1 } = makeOctokit([
      { number: 1, title: 't', state: 'closed', html_url: 'u', head: {}, base: {} },
    ]);
    expect((await findPullRequestForBranch(o1, params))?.state).toBe('closed');

    const { octokit: o2 } = makeOctokit([
      { number: 2, title: 't', state: 'open', html_url: 'u', head: {}, base: {} },
    ]);
    expect((await findPullRequestForBranch(o2, params))?.state).toBe('open');
  });

  it('defaults draft to false when the field is absent', async () => {
    const { octokit } = makeOctokit([
      { number: 1, title: 't', state: 'open', html_url: 'u', head: {}, base: {} },
    ]);
    expect((await findPullRequestForBranch(octokit, params))?.draft).toBe(false);
  });

  it('falls back author to "unknown" when pr.user is absent', async () => {
    const { octokit } = makeOctokit([
      { number: 1, title: 't', state: 'open', html_url: 'u', head: {}, base: {} },
    ]);
    expect((await findPullRequestForBranch(octokit, params))?.author).toBe('unknown');
  });

  it('falls back updated_at to "" when the field is absent', async () => {
    const { octokit } = makeOctokit([
      { number: 1, title: 't', state: 'open', html_url: 'u', head: {}, base: {}, user: {} },
    ]);
    expect((await findPullRequestForBranch(octokit, params))?.updated_at).toBe('');
  });

  it('threads an abort signal through the request options', async () => {
    const { octokit, calls } = makeOctokit([]);
    const controller = new AbortController();
    await findPullRequestForBranch(octokit, params, controller.signal);
    expect(calls[0]).toMatchObject({ request: { signal: controller.signal } });
  });

  it('omits the request option when no signal is passed', async () => {
    const { octokit, calls } = makeOctokit([]);
    await findPullRequestForBranch(octokit, params);
    expect(calls[0]).not.toHaveProperty('request');
  });
});

// ---------------------------------------------------------------------------
// createOctokitFindPr — deferred resolution + missing-token throw
// ---------------------------------------------------------------------------

describe('createOctokitFindPr', () => {
  it('does not resolve the token until the lookup is invoked (deferred)', () => {
    // No token in env: building the factory must not throw.
    const findPR = createOctokitFindPr({});
    expect(findPR).toBeTypeOf('function');
  });

  it('throws when invoked without any token in the passed environment', async () => {
    // Passing `{}` (and not process.env) proves the deferred factory wires the
    // given env through to token resolution: CI's process.env normally carries
    // a GITHUB_TOKEN, so resolving to "Missing GitHub token" here means the
    // factory read the injected `{}`, not the ambient environment.
    const findPR = createOctokitFindPr({});
    await expect(
      findPR({ owner: 'owner', repo: 'repo', branch: 'b', serverUrl: 'https://github.com' })
    ).rejects.toThrow(/Missing GitHub token/);
  });
});

// ---------------------------------------------------------------------------
// normalizeComment — projection
// ---------------------------------------------------------------------------

describe('normalizeComment', () => {
  it('maps a User author to author_type "user"', () => {
    expect(
      normalizeComment({
        id: 1,
        user: { login: 'octocat', type: 'User' },
        created_at: '2024-01-01T00:00:00Z',
        body: 'hi',
      }).author_type
    ).toBe('user');
  });

  it('maps a Bot author to author_type "bot"', () => {
    expect(
      normalizeComment({
        id: 1,
        user: { login: 'renovate', type: 'Bot' },
        created_at: '2024-01-01T00:00:00Z',
        body: 'bump',
      }).author_type
    ).toBe('bot');
  });

  it('falls back author to "unknown" when user is absent', () => {
    expect(normalizeComment({ id: 1, user: null, created_at: '', body: '' }).author).toBe(
      'unknown'
    );
  });

  it('falls back body to "" when null', () => {
    expect(normalizeComment({ id: 1, user: null, created_at: '', body: null }).body).toBe('');
  });
});

// ---------------------------------------------------------------------------
// postIssueComment — request shape + projection + signal
// ---------------------------------------------------------------------------

describe('postIssueComment', () => {
  function makeCreateCommentOctokit(data: Record<string, unknown> = {}): {
    octokit: OctokitInstance;
    calls: unknown[];
  } {
    const calls: unknown[] = [];
    const octokit = {
      rest: {
        issues: {
          createComment: async (params: unknown) => {
            calls.push(params);
            return { data };
          },
        },
      },
    } as unknown as OctokitInstance;
    return { octokit, calls };
  }

  it('posts to the issues comment endpoint with issue_number and returns details', async () => {
    const { octokit, calls } = makeCreateCommentOctokit({
      id: 99,
      html_url: 'https://github.com/owner/repo/issues/42#issuecomment-99',
      created_at: '2024-05-01T00:00:00Z',
    });
    const details = await postIssueComment(octokit, {
      owner: 'owner',
      repo: 'repo',
      number: 42,
      body: 'hello',
    });
    expect(calls[0]).toEqual({
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      body: 'hello',
    });
    expect(details).toEqual({
      id: 99,
      owner: 'owner',
      repo: 'repo',
      number: 42,
      html_url: 'https://github.com/owner/repo/issues/42#issuecomment-99',
      created_at: '2024-05-01T00:00:00Z',
    });
  });

  it('falls back created_at to "" when absent', async () => {
    const { octokit } = makeCreateCommentOctokit({ id: 1, html_url: 'u' });
    expect(
      (await postIssueComment(octokit, { owner: 'o', repo: 'r', number: 1, body: 'b' })).created_at
    ).toBe('');
  });

  it('threads an abort signal through the request options', async () => {
    const { octokit, calls } = makeCreateCommentOctokit({ id: 1, html_url: 'u', created_at: '' });
    const controller = new AbortController();
    await postIssueComment(
      octokit,
      { owner: 'o', repo: 'r', number: 1, body: 'b' },
      controller.signal
    );
    expect(calls[0]).toMatchObject({ request: { signal: controller.signal } });
  });

  it('omits the request option when no signal is passed', async () => {
    const { octokit, calls } = makeCreateCommentOctokit({ id: 1, html_url: 'u', created_at: '' });
    await postIssueComment(octokit, { owner: 'o', repo: 'r', number: 1, body: 'b' });
    expect(calls[0]).not.toHaveProperty('request');
  });
});

// ---------------------------------------------------------------------------
// readIssueThread — projection + request shape + pagination + caps + signal
// ---------------------------------------------------------------------------

describe('readIssueThread', () => {
  /** Fake Octokit whose `issues.get` / `pulls.get` / `issues.listComments` are stubbed. */
  function makeThreadOctokit(opts: {
    issue?: Record<string, unknown>;
    pr?: Record<string, unknown> | null;
    /** Comment payload the fake returns (honours per_page, like GitHub). */
    comments?: Record<string, unknown>[];
  }): { octokit: OctokitInstance; calls: Record<string, unknown>[] } {
    const calls: Record<string, unknown>[] = [];
    const log = (method: string, params: Record<string, unknown>) =>
      calls.push({ method, ...params });
    const all = opts.comments ?? [];
    const octokit = {
      rest: {
        issues: {
          get: async (params: Record<string, unknown>) => {
            log('issues.get', params);
            return { data: opts.issue ?? {} };
          },
          listComments: async (params: Record<string, unknown>) => {
            log('issues.listComments', params);
            const perPage = (params.per_page as number) ?? 100;
            // Faithful to GitHub: cap the response at per_page.
            return { data: all.slice(0, perPage) };
          },
        },
        pulls: {
          get: async (params: Record<string, unknown>) => {
            log('pulls.get', params);
            return { data: opts.pr ?? {} };
          },
        },
      },
    } as unknown as OctokitInstance;
    return { octokit, calls };
  }

  const prIssue = {
    number: 42,
    title: 'Add foo',
    state: 'open',
    body: 'PR body',
    user: { login: 'octocat' },
    updated_at: '2024-01-02T00:00:00Z',
    pull_request: {},
  };
  const prData = {
    draft: true,
    head: { ref: 'feature-x' },
    base: { ref: 'main' },
  };

  it('projects a PR thread: draft + head/base + normalized comments', async () => {
    const { octokit, calls } = makeThreadOctokit({
      issue: prIssue,
      pr: prData,
      comments: [
        { id: 1, user: { login: 'octocat', type: 'User' }, created_at: 't1', body: 'first' },
        { id: 2, user: { login: 'bot', type: 'Bot' }, created_at: 't2', body: null },
      ],
    });
    const thread = await readIssueThread(octokit, { owner: 'o', repo: 'r', number: 42 });
    expect(thread).toEqual({
      number: 42,
      title: 'Add foo',
      state: 'open',
      draft: true,
      body: 'PR body',
      author: 'octocat',
      head_branch: 'feature-x',
      base_branch: 'main',
      updated_at: '2024-01-02T00:00:00Z',
      comments: [
        { id: 1, author: 'octocat', author_type: 'user', created_at: 't1', body: 'first' },
        { id: 2, author: 'bot', author_type: 'bot', created_at: 't2', body: '' },
      ],
    });
    // PR path fetches issues.get first, then pulls.get and issues.listComments
    // concurrently (order of the latter two is not guaranteed).
    const methods = calls.map(c => c.method);
    expect(methods[0]).toBe('issues.get');
    expect(methods).toContain('pulls.get');
    expect(methods).toContain('issues.listComments');
    expect(methods).toHaveLength(3);
  });

  it('does not call pulls.get for an issue (no head/base)', async () => {
    const { octokit, calls } = makeThreadOctokit({
      issue: {
        number: 7,
        title: 'bug',
        state: 'open',
        body: 'b',
        user: { login: 'u' },
        updated_at: 't',
      },
      comments: [],
    });
    const thread = await readIssueThread(octokit, { owner: 'o', repo: 'r', number: 7 });
    expect(thread.head_branch).toBeNull();
    expect(thread.base_branch).toBeNull();
    expect(thread.draft).toBe(false);
    expect(calls.map(c => c.method)).toEqual(['issues.get', 'issues.listComments']);
  });

  it('respects maxComments cap (requests per_page and GitHub truncates)', async () => {
    const { octokit, calls } = makeThreadOctokit({
      issue: { number: 1, title: 't', state: 'open', body: '', user: {}, updated_at: '' },
      comments: [
        { id: 1, user: {}, created_at: '', body: 'a' },
        { id: 2, user: {}, created_at: '', body: 'b' },
        { id: 3, user: {}, created_at: '', body: 'c' },
      ],
    });
    const thread = await readIssueThread(octokit, {
      owner: 'o',
      repo: 'r',
      number: 1,
      maxComments: 1,
    });
    // Fake honours per_page (like GitHub), so the response is truncated to 1.
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0]?.id).toBe(1);
    expect(calls.find(c => c.method === 'issues.listComments')).toMatchObject({ per_page: 1 });
  });

  it('skips the comments fetch entirely when maxComments is 0', async () => {
    const { octokit, calls } = makeThreadOctokit({
      issue: { number: 1, title: 't', state: 'open', body: '', user: {}, updated_at: '' },
      comments: [{ id: 1, user: {}, created_at: '', body: 'a' }],
    });
    const thread = await readIssueThread(octokit, {
      owner: 'o',
      repo: 'r',
      number: 1,
      maxComments: 0,
    });
    expect(thread.comments).toEqual([]);
    expect(calls.some(c => c.method === 'issues.listComments')).toBe(false);
  });

  it('defaults maxComments to DEFAULT_MAX_THREAD_COMMENTS when omitted', async () => {
    const { octokit, calls } = makeThreadOctokit({
      issue: { number: 1, title: 't', state: 'open', body: '', user: {}, updated_at: '' },
      comments: [],
    });
    await readIssueThread(octokit, { owner: 'o', repo: 'r', number: 1 });
    const listCall = calls.find(c => c.method === 'issues.listComments');
    expect(listCall).toMatchObject({ per_page: DEFAULT_MAX_THREAD_COMMENTS });
  });

  it('threads an abort signal through every request', async () => {
    const { octokit, calls } = makeThreadOctokit({
      issue: prIssue,
      pr: prData,
      comments: [],
    });
    const controller = new AbortController();
    await readIssueThread(octokit, { owner: 'o', repo: 'r', number: 42 }, controller.signal);
    for (const c of calls) {
      expect(c).toMatchObject({ request: { signal: controller.signal } });
    }
  });

  it('caps per_page at 100 when maxComments exceeds 100', async () => {
    const { octokit, calls } = makeThreadOctokit({
      issue: { number: 1, title: 't', state: 'open', body: '', user: {}, updated_at: '' },
      comments: [],
    });
    await readIssueThread(octokit, { owner: 'o', repo: 'r', number: 1, maxComments: 9999 });
    const listCall = calls.find(c => c.method === 'issues.listComments');
    expect(listCall).toMatchObject({ per_page: 100 });
  });

  it('propagates a 404 from issues.get (surfaces to the caller)', async () => {
    const calls: unknown[] = [];
    const octokit = {
      rest: {
        issues: {
          get: async () => {
            const err = Object.assign(new Error('not found'), { status: 404 });
            calls.push(err);
            throw err;
          },
          listComments: async () => ({ data: [] }),
        },
        pulls: { get: async () => ({ data: {} }) },
      },
    } as unknown as OctokitInstance;
    await expect(readIssueThread(octokit, { owner: 'o', repo: 'r', number: 999 })).rejects.toThrow(
      'not found'
    );
  });
});

// ---------------------------------------------------------------------------
// createOctokitPostComment / createOctokitReadThread — deferred + throw
// ---------------------------------------------------------------------------

describe('createOctokitPostComment', () => {
  it('does not resolve the token until invoked (deferred)', () => {
    const post = createOctokitPostComment({});
    expect(post).toBeTypeOf('function');
  });

  it('throws when invoked without any token in the passed environment', async () => {
    const post = createOctokitPostComment({});
    await expect(
      post({ serverUrl: 'https://github.com', owner: 'o', repo: 'r', number: 1, body: 'b' })
    ).rejects.toThrow(/Missing GitHub token/);
  });
});

describe('createOctokitReadThread', () => {
  it('does not resolve the token until invoked (deferred)', () => {
    const read = createOctokitReadThread({});
    expect(read).toBeTypeOf('function');
  });

  it('throws when invoked without any token in the passed environment', async () => {
    const read = createOctokitReadThread({});
    await expect(
      read({ serverUrl: 'https://github.com', owner: 'o', repo: 'r', number: 1 })
    ).rejects.toThrow(/Missing GitHub token/);
  });
});

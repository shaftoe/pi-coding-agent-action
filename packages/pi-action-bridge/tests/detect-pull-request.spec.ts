/**
 * @file Tests for the `detect_pull_request` tool.
 *
 * Two layers:
 *   - `parseRemoteUrl` (pure, exhaustive).
 *   - `detectPullRequest` orchestration, driven by injected fakes
 *     (no `simple-git` / Octokit in the test path).
 *
 * Mirrors the repo's `*.spec.ts` + `vitest` convention.
 */
import { describe, it, expect } from 'vitest';
import type { RemoteWithRefs, StatusResult } from 'simple-git';
import { parseRemoteUrl } from '../src/remote.js';
import { detectPullRequest, summarize } from '../src/tools/detect-pull-request.js';
import type {
  DetectPullRequestDetails,
  FindPrFn,
  FindPrParams,
  GitInspector,
  NormalizedPR,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Pure: parseRemoteUrl
// ---------------------------------------------------------------------------

describe('parseRemoteUrl', () => {
  const cases: [string, { serverUrl: string; owner: string; repo: string }][] = [
    [
      'git@github.com:owner/repo.git',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'git@github.com:owner/repo',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'https://github.com/owner/repo.git',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'https://github.com/owner/repo',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'https://github.com/owner/repo/',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'https://token@github.com/owner/repo.git',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'ssh://git@github.com/owner/repo.git',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'ssh://git@github.com:22/owner/repo.git',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'git://github.com/owner/repo.git',
      { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'git@codeberg.org:owner/repo.git',
      { serverUrl: 'https://codeberg.org', owner: 'owner', repo: 'repo' },
    ],
    [
      'https://gh.example.com/owner/repo.git',
      { serverUrl: 'https://gh.example.com', owner: 'owner', repo: 'repo' },
    ],
    [
      'git@forge.my.corp:org/project.git',
      { serverUrl: 'https://forge.my.corp', owner: 'org', repo: 'project' },
    ],
  ];

  for (const [input, expected] of cases) {
    it(`parses ${input}`, () => {
      expect(parseRemoteUrl(input)).toEqual(expected);
    });
  }

  const invalid = [
    '',
    '   ',
    'not a url',
    '/local/path/to/repo',
    'file:///home/user/repo',
    'https://github.com/',
    'https://github.com/only-one-segment',
    'git@github.com:owner', // missing repo segment
  ];

  for (const input of invalid) {
    it(`rejects ${JSON.stringify(input)}`, () => {
      expect(parseRemoteUrl(input)).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// Orchestration: detectPullRequest (injected fakes)
// ---------------------------------------------------------------------------

function makeStatus(over: Partial<StatusResult> = {}): StatusResult {
  return {
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    modified: [],
    renamed: [],
    staged: [],
    files: [],
    ahead: 0,
    behind: 0,
    current: 'feature-x',
    tracking: 'origin/feature-x',
    detached: false,
    isClean: () => true,
    ...over,
  } as StatusResult;
}

function makeRemote(name: string, url: string): RemoteWithRefs {
  return { name, refs: { fetch: url, push: url } };
}

function makeGit(
  opts: { isRepo?: boolean; status?: StatusResult; remotes?: RemoteWithRefs[] } = {}
): GitInspector {
  return {
    isRepo: async () => opts.isRepo ?? true,
    status: async () => opts.status ?? makeStatus(),
    getRemotes: async () => opts.remotes ?? [],
  };
}

function makePR(over: Partial<NormalizedPR> = {}): NormalizedPR {
  return {
    number: 42,
    title: 'Add foo',
    state: 'open',
    draft: false,
    html_url: 'https://github.com/owner/repo/pull/42',
    head: { ref: 'feature-x', sha: 'abc123' },
    base: { ref: 'main' },
    author: 'octocat',
    updated_at: '2024-01-01T00:00:00Z',
    ...over,
  };
}

/** findPR that records its args and returns a fixed PR (or null). */
function spyFindPr(pr: NormalizedPR | null): { fn: FindPrFn; calls: FindPrParams[] } {
  const calls: FindPrParams[] = [];
  const fn: FindPrFn = async params => {
    calls.push(params);
    return pr;
  };
  return { fn, calls };
}

const originRemote = makeRemote('origin', 'git@github.com:owner/repo.git');

describe('detectPullRequest', () => {
  it('returns not_a_git_repo when isRepo is false', async () => {
    const git = makeGit({ isRepo: false });
    const { fn } = spyFindPr(makePR());
    const details = await detectPullRequest({ git, findPR: fn });
    expect(details).toEqual<DetectPullRequestDetails>({
      repo: null,
      branch: null,
      remote: null,
      dirty: false,
      ahead: 0,
      behind: 0,
      tracking: null,
      pr: null,
      reason: 'not_a_git_repo',
    });
  });

  it('returns detached_head when HEAD is detached', async () => {
    const git = makeGit({
      status: makeStatus({ current: null, detached: true, tracking: null }),
    });
    const { fn, calls } = spyFindPr(makePR());
    const details = await detectPullRequest({ git, findPR: fn });
    expect(details.reason).toBe('detached_head');
    expect(details.branch).toBeNull();
    expect(details.pr).toBeNull();
    expect(calls).toEqual([]); // no API call
  });

  it('returns no_remote when there are no remotes', async () => {
    const git = makeGit({ remotes: [] });
    const { fn, calls } = spyFindPr(makePR());
    const details = await detectPullRequest({ git, findPR: fn });
    expect(details.reason).toBe('no_remote');
    expect(details.remote).toBeNull();
    expect(calls).toEqual([]);
  });

  it('returns unrecognized_remote when origin URL cannot be parsed', async () => {
    const git = makeGit({ remotes: [makeRemote('origin', '/local/path/to/repo')] });
    const { fn, calls } = spyFindPr(makePR());
    const details = await detectPullRequest({ git, findPR: fn });
    expect(details.reason).toBe('unrecognized_remote');
    expect(details.remote).toBe('origin');
    expect(calls).toEqual([]);
  });

  it('resolves the PR and calls findPR with origin owner/repo/branch', async () => {
    const git = makeGit({ remotes: [originRemote] });
    const { fn, calls } = spyFindPr(makePR());
    const details = await detectPullRequest({ git, findPR: fn });

    expect(details.pr).not.toBeNull();
    expect(details.reason).toBeUndefined();
    expect(details.repo).toEqual({
      serverUrl: 'https://github.com',
      owner: 'owner',
      repo: 'repo',
    });
    expect(details.remote).toBe('origin');
    expect(calls).toEqual([
      {
        owner: 'owner',
        repo: 'repo',
        branch: 'feature-x',
        serverUrl: 'https://github.com',
      },
    ]);
  });

  it('surfaces draft flag on an open draft PR', async () => {
    const git = makeGit({ remotes: [originRemote] });
    const { fn } = spyFindPr(makePR({ draft: true }));
    const details = await detectPullRequest({ git, findPR: fn });
    expect(details.pr?.draft).toBe(true);
    expect(details.reason).toBeUndefined();
  });

  it('returns no_pr_for_branch when findPR resolves nothing', async () => {
    const git = makeGit({ remotes: [originRemote] });
    const { fn } = spyFindPr(null);
    const details = await detectPullRequest({ git, findPR: fn });
    expect(details.pr).toBeNull();
    expect(details.reason).toBe('no_pr_for_branch');
    expect(details.repo?.owner).toBe('owner');
  });

  it('propagates errors from findPR (e.g. missing token) as thrown', async () => {
    const git = makeGit({ remotes: [originRemote] });
    const fn: FindPrFn = async () => {
      throw new Error('Missing GitHub token. Set GITHUB_TOKEN (or GH_TOKEN)');
    };
    await expect(detectPullRequest({ git, findPR: fn })).rejects.toThrow(/Missing GitHub token/);
  });

  it('returns aborted when the signal is already aborted', async () => {
    const git = makeGit({ remotes: [originRemote] });
    const { fn, calls } = spyFindPr(makePR());
    const controller = new AbortController();
    controller.abort();
    const details = await detectPullRequest({ git, findPR: fn }, controller.signal);
    expect(details.reason).toBe('aborted');
    expect(details.pr).toBeNull();
    expect(calls).toEqual([]);
  });

  it('prefers origin over a non-origin remote', async () => {
    const git = makeGit({
      remotes: [makeRemote('upstream', 'git@github.com:canonical/repo.git'), originRemote],
    });
    const { fn, calls } = spyFindPr(makePR());
    await detectPullRequest({ git, findPR: fn });
    expect(calls[0]).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'feature-x',
      serverUrl: 'https://github.com',
    });
  });

  it('reflects dirty/ahead/behind from status', async () => {
    const git = makeGit({
      status: makeStatus({ isClean: () => false, ahead: 3, behind: 1 }),
      remotes: [originRemote],
    });
    const { fn } = spyFindPr(makePR());
    const details = await detectPullRequest({ git, findPR: fn });
    expect(details.dirty).toBe(true);
    expect(details.ahead).toBe(3);
    expect(details.behind).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

describe('summarize', () => {
  it('renders a found PR line', () => {
    const details: DetectPullRequestDetails = {
      repo: { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
      branch: 'feature-x',
      remote: 'origin',
      dirty: false,
      ahead: 0,
      behind: 1,
      tracking: 'origin/feature-x',
      pr: makePR(),
    };
    const text = summarize(details);
    expect(text).toContain('github.com repo `owner/repo`');
    expect(text).toContain('branch `feature-x`');
    expect(text).toContain('PR #42 "Add foo" [open]');
    expect(text).toContain('https://github.com/owner/repo/pull/42');
  });

  it('renders no_pr_for_branch when no PR matches', () => {
    const details: DetectPullRequestDetails = {
      repo: { serverUrl: 'https://github.com', owner: 'owner', repo: 'repo' },
      branch: 'feature-x',
      remote: 'origin',
      dirty: false,
      ahead: 0,
      behind: 0,
      tracking: 'origin/feature-x',
      pr: null,
      reason: 'no_pr_for_branch',
    };
    expect(summarize(details)).toContain('no open pull request found for this branch');
  });
});

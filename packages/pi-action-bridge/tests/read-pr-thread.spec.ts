/**
 * @file Tests for the `read_pr_thread` tool (DI layer + summarizer).
 *
 * The octokit I/O is covered in `octokit.spec.ts`; here we drive the thin
 * orchestration `readPrThread` with an injected fake {@link ReadThreadFn}
 * (no network) and assert the text rendering (incl. handoff-marker + body
 * truncation behaviour that `/pickup` relies on).
 */
import { describe, it, expect } from 'bun:test';
import { readPrThread, summarizeThread } from '../src/tools/read-pr-thread.js';
import type { NormalizedThread, ReadPrThreadDetails, ReadThreadFn } from '../src/types.js';

const baseParams = {
  serverUrl: 'https://github.com',
  owner: 'owner',
  repo: 'repo',
  number: 42,
};

function thread(overrides: Partial<NormalizedThread> = {}): NormalizedThread {
  return {
    number: 42,
    title: 'Add foo',
    state: 'open',
    draft: false,
    body: 'PR body',
    author: 'octocat',
    head_branch: 'feature-x',
    base_branch: 'main',
    updated_at: '2024-01-02T00:00:00Z',
    comments: [],
    ...overrides,
  };
}

describe('readPrThread', () => {
  it('calls the injected readThread fn and wraps the thread in details', async () => {
    let received: typeof baseParams | undefined;
    const fake: ReadThreadFn = async params => {
      received = params;
      return thread();
    };
    const details = await readPrThread({ readThread: fake }, baseParams);
    expect(received).toEqual(baseParams);
    expect(details.thread.title).toBe('Add foo');
    expect(details.cancelled).toBeUndefined();
  });

  it('returns a cancelled sentinel without calling the fn when already aborted', async () => {
    let called = false;
    const fake: ReadThreadFn = async () => {
      called = true;
      return thread();
    };
    const controller = new AbortController();
    controller.abort();
    const details = await readPrThread({ readThread: fake }, baseParams, controller.signal);
    expect(called).toBe(false);
    expect(details.cancelled).toBe(true);
    expect(details.thread.comments).toEqual([]);
  });

  it('propagates errors from the fn (e.g. 404 / API failure)', async () => {
    const fake: ReadThreadFn = async () => {
      throw new Error('not found');
    };
    await expect(readPrThread({ readThread: fake }, baseParams)).rejects.toThrow('not found');
  });
});

describe('summarizeThread', () => {
  const details = (
    thread: NormalizedThread,
    overrides: Partial<ReadPrThreadDetails> = {}
  ): ReadPrThreadDetails => ({
    owner: 'owner',
    repo: 'repo',
    thread,
    ...overrides,
  });

  it('renders header, body, and numbered comments', () => {
    const text = summarizeThread(
      details(
        thread({
          comments: [
            { id: 1, author: 'octocat', author_type: 'user', created_at: 't1', body: 'first' },
            {
              id: 2,
              author: 'pi-agent',
              author_type: 'bot',
              created_at: 't2',
              body: '/pi 🤖 Handoff\n\n## Done\n- x',
            },
          ],
        })
      )
    );
    expect(text).toContain('#42 "Add foo" [open] in owner/repo (head: feature-x → main)');
    expect(text).toContain('by @octocat, updated 2024-01-02T00:00:00Z');
    expect(text).toContain('Body:\nPR body');
    expect(text).toContain('Comments (2, oldest first):');
    expect(text).toContain('1. @octocat (user, t1):\nfirst');
    expect(text).toContain('/pi 🤖 Handoff');
  });

  it('labels a draft PR as "draft" and does not repeat it in the branch info', () => {
    const text = summarizeThread(details(thread({ draft: true })));
    expect(text).toContain('[draft]');
    // `draft` is conveyed by the [draft] label; the branch line must not
    // append `, draft` a second time (regression guard).
    expect(text).toContain('head: feature-x → main)');
    expect(text).not.toContain('main, draft');
  });

  it('omits the head→base branch info for an issue', () => {
    const text = summarizeThread(
      details(thread({ head_branch: null, base_branch: null, body: '' }))
    );
    expect(text).not.toContain('head:');
  });

  it('truncates a long comment body and points to details', () => {
    const long = 'x'.repeat(3000);
    const text = summarizeThread(
      details(
        thread({
          comments: [{ id: 1, author: 'u', author_type: 'user', created_at: 't', body: long }],
        })
      )
    );
    expect(text).toContain('… (truncated; full body in tool details)');
    // Truncated body keeps the cap, not the full 3000 chars.
    expect(text).not.toContain('x'.repeat(3000));
  });

  it('handles a thread with no comments', () => {
    const text = summarizeThread(details(thread()));
    expect(text).toContain('(No comments.)');
  });

  it('reports an aborted read explicitly', () => {
    const text = summarizeThread(details(thread(), { cancelled: true }));
    expect(text).toBe('Thread owner/repo#42 was not read (aborted).');
  });
});

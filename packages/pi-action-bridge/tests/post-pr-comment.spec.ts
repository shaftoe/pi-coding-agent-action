/**
 * @file Tests for the `post_pr_comment` tool (DI layer + summarizer).
 *
 * The octokit I/O is covered in `octokit.spec.ts`; here we drive the thin
 * orchestration `postPrComment` with an injected fake {@link PostCommentFn}
 * (no network) and assert the text rendering.
 */
import { describe, it, expect } from 'vitest';
import { postPrComment, summarizePostComment } from '../src/tools/post-pr-comment.js';
import type { PostCommentFn, PostPrCommentDetails } from '../src/types.js';

const baseParams = {
  serverUrl: 'https://github.com',
  owner: 'owner',
  repo: 'repo',
  number: 42,
  body: '/pi 🤖 Handoff\n\n## Done\n- x',
};

describe('postPrComment', () => {
  it('calls the injected postComment fn and returns its details', async () => {
    let received: typeof baseParams | undefined;
    const fake: PostCommentFn = async params => {
      received = params;
      return {
        id: 99,
        owner: params.owner,
        repo: params.repo,
        number: params.number,
        html_url: 'https://github.com/owner/repo/issues/42#issuecomment-99',
        created_at: '2024-05-01T00:00:00Z',
      };
    };
    const details = await postPrComment({ postComment: fake }, baseParams);
    expect(received).toEqual(baseParams);
    expect(details.id).toBe(99);
    expect(details.cancelled).toBeUndefined();
  });

  it('returns a cancelled sentinel without calling the fn when already aborted', async () => {
    let called = false;
    const fake: PostCommentFn = async () => {
      called = true;
      return {} as PostPrCommentDetails;
    };
    const controller = new AbortController();
    controller.abort();
    const details = await postPrComment({ postComment: fake }, baseParams, controller.signal);
    expect(called).toBe(false);
    expect(details.cancelled).toBe(true);
    expect(details.number).toBe(42);
  });

  it('propagates errors from the fn (e.g. missing token / API failure)', async () => {
    const fake: PostCommentFn = async () => {
      throw new Error('boom');
    };
    await expect(postPrComment({ postComment: fake }, baseParams)).rejects.toThrow('boom');
  });
});

describe('summarizePostComment', () => {
  it('renders the posted comment URL', () => {
    const text = summarizePostComment({
      id: 99,
      owner: 'owner',
      repo: 'repo',
      number: 42,
      html_url: 'https://github.com/owner/repo/issues/42#issuecomment-99',
      created_at: '2024-05-01T00:00:00Z',
    });
    expect(text).toBe(
      'Posted comment 99 on owner/repo#42: https://github.com/owner/repo/issues/42#issuecomment-99'
    );
  });

  it('reports an aborted post explicitly (no fake URL)', () => {
    const text = summarizePostComment({
      id: 0,
      owner: 'owner',
      repo: 'repo',
      number: 42,
      html_url: '',
      created_at: '',
      cancelled: true,
    });
    expect(text).toBe('Comment on owner/repo#42 was not posted (aborted).');
  });
});

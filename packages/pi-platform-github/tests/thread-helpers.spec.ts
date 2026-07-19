/**
 * Unit tests for `mapReviewComment`, the pure payload→domain mapper extracted
 * from `fetchPRReviewComments` in
 * `packages/pi-platform-github/src/tools/thread.ts`.
 *
 * `fetchPRReviewComments` (the caller) is exercised end-to-end by
 * `thread.spec.ts` via `getIssueOrPRThread`. Here we test the mapper
 * directly so all null/coercion branches are pinned down even when the
 * fetcher is refactored.
 */

import { describe, expect, test } from 'vitest';
import { mapReviewComment } from '@alexanderfortin/pi-platform-github';
import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';

type RawReviewComment =
  RestEndpointMethodTypes['pulls']['listReviewComments']['response']['data'][number];

// Use a looser Partial type so tests can override fields like `user: undefined`
// or `line: null` without TS exactOptionalPropertyTypes complaining. The
// helper itself only reads a handful of fields, so this is safe.
function buildRaw(overrides: Record<string, unknown> = {}): RawReviewComment {
  return {
    id: 42,
    path: 'src/main.ts',
    line: 10,
    original_line: 10,
    side: 'RIGHT',
    body: 'looks good',
    created_at: '2024-01-01T00:00:00Z',
    user: { login: 'alice', type: 'User' } as RawReviewComment['user'],
    ...overrides,
  } as unknown as RawReviewComment;
}

describe('mapReviewComment', () => {
  test('maps a fully-populated payload verbatim', () => {
    const result = mapReviewComment(buildRaw());
    expect(result).toEqual({
      id: 42,
      path: 'src/main.ts',
      line: 10,
      side: 'RIGHT',
      author: 'alice',
      author_type: 'user',
      created_at: '2024-01-01T00:00:00Z',
      body: 'looks good',
    });
  });

  test('falls back to original_line when line is null', () => {
    const result = mapReviewComment(buildRaw({ line: null, original_line: 99 }));
    expect(result.line).toBe(99);
  });

  test('line is null when both line and original_line are null', () => {
    const result = mapReviewComment(buildRaw({ line: null, original_line: null }));
    expect(result.line).toBeNull();
  });

  test('line is null when both line and original_line are undefined', () => {
    const result = mapReviewComment(
      buildRaw({ line: undefined as unknown as null, original_line: undefined as unknown as null })
    );
    expect(result.line).toBeNull();
  });

  test('defaults side to RIGHT when side is missing', () => {
    const result = mapReviewComment(buildRaw({ side: undefined as unknown as 'RIGHT' }));
    expect(result.side).toBe('RIGHT');
  });

  test('preserves LEFT side verbatim', () => {
    const result = mapReviewComment(buildRaw({ side: 'LEFT' }));
    expect(result.side).toBe('LEFT');
  });

  test('author_type is "bot" when user.type === "Bot"', () => {
    const result = mapReviewComment(buildRaw({ user: { login: 'dependabot', type: 'Bot' } }));
    expect(result.author_type).toBe('bot');
  });

  test('author_type is "user" when user.type is anything else', () => {
    const result = mapReviewComment(buildRaw({ user: { login: 'alice', type: 'User' } }));
    expect(result.author_type).toBe('user');
  });

  test('author is "unknown" when user is missing', () => {
    const result = mapReviewComment(buildRaw({ user: undefined }));
    expect(result.author).toBe('unknown');
  });

  test('author_type defaults to "user" when user is missing', () => {
    // user?.type === 'Bot' is false when user is undefined, so author_type falls through to 'user'.
    const result = mapReviewComment(buildRaw({ user: undefined }));
    expect(result.author_type).toBe('user');
  });

  test('includes in_reply_to_id when set', () => {
    const result = mapReviewComment(buildRaw({ in_reply_to_id: 99 }));
    expect(result.in_reply_to_id).toBe(99);
  });

  test('omits in_reply_to_id when missing', () => {
    const result = mapReviewComment(buildRaw());
    expect('in_reply_to_id' in result).toBe(false);
  });

  test('passes body through verbatim (including empty string)', () => {
    expect(mapReviewComment(buildRaw({ body: 'a' })).body).toBe('a');
    expect(mapReviewComment(buildRaw({ body: '' })).body).toBe('');
  });

  test('passes created_at through verbatim', () => {
    expect(mapReviewComment(buildRaw({ created_at: '2025-12-31T23:59:59Z' })).created_at).toBe(
      '2025-12-31T23:59:59Z'
    );
  });
});

/**
 * Unit tests for the pure validation helpers extracted from
 * `packages/pi-platform-github/src/tools/review.ts`.
 *
 * These complement `review-logic.spec.ts`, which tests the full
 * `validateCreateReviewParams` pipeline + `toGitHubComment`. Here we
 * exercise the per-comment and per-event validators directly so all
 * error-message text is pinned down even when the pipeline consumer
 * is refactored.
 */

import { describe, expect, test } from 'vitest';
import { validateReviewComment, validateReviewEvent } from '@alexanderfortin/pi-platform-github';
import type { ReviewInlineComment } from '@alexanderfortin/pi-platform-github';

function buildComment(overrides: Partial<ReviewInlineComment> = {}): ReviewInlineComment {
  return {
    path: 'src/main.ts',
    line: 10,
    body: 'looks good',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateReviewComment
// ---------------------------------------------------------------------------

describe('validateReviewComment', () => {
  test('does not throw for a valid single-line comment', () => {
    expect(() => validateReviewComment(buildComment(), 0)).not.toThrow();
  });

  test('does not throw for a valid multi-line comment', () => {
    expect(() => validateReviewComment(buildComment({ start_line: 5 }), 2)).not.toThrow();
  });

  test('does not throw when start_line equals line (single-line, degenerate)', () => {
    expect(() =>
      validateReviewComment(buildComment({ start_line: 10, line: 10 }), 0)
    ).not.toThrow();
  });

  test('throws when path is empty', () => {
    expect(() => validateReviewComment(buildComment({ path: '' }), 0)).toThrow(
      'Comment at index 0: "path" is required and cannot be empty'
    );
  });

  test('throws when path is whitespace-only', () => {
    expect(() => validateReviewComment(buildComment({ path: '   ' }), 3)).toThrow(
      'Comment at index 3: "path" is required and cannot be empty'
    );
  });

  test('throws when body is empty', () => {
    expect(() => validateReviewComment(buildComment({ body: '' }), 0)).toThrow(
      'Comment at index 0: "body" is required and cannot be empty'
    );
  });

  test('throws when body is whitespace-only', () => {
    expect(() => validateReviewComment(buildComment({ body: '\t  \n' }), 1)).toThrow(
      'Comment at index 1: "body" is required and cannot be empty'
    );
  });

  test('throws when line is missing', () => {
    // @ts-expect-error -- deliberately invalid input for the negative path
    expect(() => validateReviewComment(buildComment({ line: undefined }), 0)).toThrow(
      'Comment at index 0: "line" must be a positive integer'
    );
  });

  test('throws when line is a float', () => {
    expect(() => validateReviewComment(buildComment({ line: 1.5 }), 0)).toThrow(
      'Comment at index 0: "line" must be a positive integer'
    );
  });

  test('throws when line is negative', () => {
    expect(() => validateReviewComment(buildComment({ line: -1 }), 0)).toThrow(
      'Comment at index 0: "line" must be a positive integer'
    );
  });

  test('throws when line is zero', () => {
    expect(() => validateReviewComment(buildComment({ line: 0 }), 0)).toThrow(
      'Comment at index 0: "line" must be a positive integer'
    );
  });

  test('throws when start_line is a float', () => {
    expect(() => validateReviewComment(buildComment({ start_line: 2.5 }), 0)).toThrow(
      'Comment at index 0: "start_line" must be a positive integer'
    );
  });

  test('throws when start_line is zero', () => {
    expect(() => validateReviewComment(buildComment({ start_line: 0 }), 0)).toThrow(
      'Comment at index 0: "start_line" must be a positive integer'
    );
  });

  test('throws when start_line is greater than line', () => {
    expect(() => validateReviewComment(buildComment({ start_line: 20, line: 10 }), 4)).toThrow(
      'Comment at index 4: "start_line" (20) must be <= "line" (10)'
    );
  });

  test('error messages always include the passed-in index', () => {
    // Use a large index to confirm it's threaded through verbatim.
    expect(() => validateReviewComment(buildComment({ path: '' }), 99)).toThrow(
      'Comment at index 99:'
    );
  });
});

// ---------------------------------------------------------------------------
// validateReviewEvent
// ---------------------------------------------------------------------------

describe('validateReviewEvent', () => {
  test('does not throw for undefined event', () => {
    expect(() => validateReviewEvent(undefined)).not.toThrow();
  });

  test('does not throw for COMMENT', () => {
    expect(() => validateReviewEvent('COMMENT')).not.toThrow();
  });

  test('does not throw for APPROVE', () => {
    expect(() => validateReviewEvent('APPROVE')).not.toThrow();
  });

  test('does not throw for REQUEST_CHANGES', () => {
    expect(() => validateReviewEvent('REQUEST_CHANGES')).not.toThrow();
  });

  test('does not throw for empty string (treated as "not provided")', () => {
    expect(() => validateReviewEvent('')).not.toThrow();
  });

  test('throws for an unrecognized event name', () => {
    expect(() => validateReviewEvent('CHANGES_REQUESTED')).toThrow(
      'Invalid event "CHANGES_REQUESTED". Must be one of: COMMENT, APPROVE, REQUEST_CHANGES'
    );
  });

  test('throws for lowercase variants (case-sensitive)', () => {
    expect(() => validateReviewEvent('comment')).toThrow('Invalid event "comment"');
    expect(() => validateReviewEvent('approve')).toThrow('Invalid event "approve"');
  });

  test('error message echoes the invalid value back to the caller', () => {
    expect(() => validateReviewEvent('DISAPPROVE')).toThrow(/"DISAPPROVE"/);
  });
});

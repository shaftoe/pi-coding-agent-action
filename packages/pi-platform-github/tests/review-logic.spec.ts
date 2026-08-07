/**
 * Tests for the review creation logic.
 *
 * Tests validation, parameter transformation, and the createReview
 * function exported from the platform layer.
 */

import { describe, expect, test } from 'vitest';
import { validateCreateReviewParams, toGitHubComment } from '@alexanderfortin/pi-platform-github';
import type { CreateReviewParams, ReviewInlineComment } from '@alexanderfortin/pi-platform-github';

describe('validateCreateReviewParams', () => {
  test('throws when comments and review body are empty', () => {
    const params: CreateReviewParams = { comments: [] };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /At least one inline comment or a non-empty review body is required/
    );
  });

  test('throws when comments are empty and review body is whitespace only', () => {
    const params: CreateReviewParams = { body: '   ', comments: [] };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /At least one inline comment or a non-empty review body is required/
    );
  });

  test('passes for a summary-only review', () => {
    const params: CreateReviewParams = { body: 'No issues found.', comments: [] };
    expect(() => validateCreateReviewParams(params)).not.toThrow();
  });

  test('throws when comment path is empty', () => {
    const params: CreateReviewParams = {
      comments: [{ path: '', line: 1, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "path" is required/
    );
  });

  test('throws when comment body is empty', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1, body: '' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "body" is required/
    );
  });

  test('throws when line is not a positive integer', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 0, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "line" must be a positive integer/
    );
  });

  test('throws when line is negative', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: -1, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "line" must be a positive integer/
    );
  });

  test('throws when line is a non-integer float', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1.5, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "line" must be a positive integer/
    );
  });

  test('throws when start_line is a non-integer float', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 5, start_line: 2.7, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "start_line" must be a positive integer/
    );
  });

  test('throws when start_line is greater than line', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 5, start_line: 10, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "start_line" \(10\) must be <= "line" \(5\)/
    );
  });

  test('throws when start_line is not a positive integer', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 5, start_line: 0, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "start_line" must be a positive integer/
    );
  });

  test('error message includes correct comment index for second comment', () => {
    const params: CreateReviewParams = {
      comments: [
        { path: 'src/ok.ts', line: 1, body: 'fine' },
        { path: '', line: 1, body: 'bad' },
      ],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 1: "path" is required/
    );
  });

  test('throws for invalid event', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1, body: 'test' }],
      event: 'INVALID' as 'COMMENT',
    };
    expect(() => validateCreateReviewParams(params)).toThrow(/Invalid event "INVALID"/);
  });

  test('passes for valid single-line comment', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 10, body: 'Looks good' }],
    };
    expect(() => validateCreateReviewParams(params)).not.toThrow();
  });

  test('passes for valid multi-line comment', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 15, start_line: 10, body: 'Multi-line issue' }],
    };
    expect(() => validateCreateReviewParams(params)).not.toThrow();
  });

  test('passes for valid multi-line comment where start_line equals line', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 10, start_line: 10, body: 'Single line' }],
    };
    expect(() => validateCreateReviewParams(params)).not.toThrow();
  });

  test('passes for COMMENT event', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1, body: 'test' }],
      event: 'COMMENT',
    };
    expect(() => validateCreateReviewParams(params)).not.toThrow();
  });

  test('passes for APPROVE event', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1, body: 'LGTM' }],
      event: 'APPROVE',
    };
    expect(() => validateCreateReviewParams(params)).not.toThrow();
  });

  test('passes for REQUEST_CHANGES event', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1, body: 'Fix this' }],
      event: 'REQUEST_CHANGES',
    };
    expect(() => validateCreateReviewParams(params)).not.toThrow();
  });

  test('passes for multiple valid comments', () => {
    const params: CreateReviewParams = {
      comments: [
        { path: 'src/main.ts', line: 10, body: 'Issue 1' },
        { path: 'src/util.ts', line: 20, body: 'Issue 2' },
        { path: 'src/types.ts', line: 5, start_line: 3, side: 'RIGHT', body: 'Issue 3' },
      ],
    };
    expect(() => validateCreateReviewParams(params)).not.toThrow();
  });

  test('throws when whitespace-only path', () => {
    const params: CreateReviewParams = {
      comments: [{ path: '   ', line: 1, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "path" is required/
    );
  });

  test('throws when whitespace-only body', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1, body: '   ' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /Comment at index 0: "body" is required/
    );
  });
});

describe('toGitHubComment', () => {
  test('maps single-line comment with defaults', () => {
    const comment: ReviewInlineComment = {
      path: 'src/main.ts',
      line: 10,
      body: 'Looks good',
    };
    const result = toGitHubComment(comment);
    expect(result).toEqual({
      path: 'src/main.ts',
      line: 10,
      side: 'RIGHT',
      body: 'Looks good',
    });
    expect(result).not.toHaveProperty('start_line');
    expect(result).not.toHaveProperty('start_side');
  });

  test('preserves explicit side', () => {
    const comment: ReviewInlineComment = {
      path: 'src/main.ts',
      line: 10,
      side: 'LEFT',
      body: 'Old code was better',
    };
    const result = toGitHubComment(comment);
    expect(result.side).toBe('LEFT');
  });

  test('maps multi-line comment with start_line and default sides', () => {
    const comment: ReviewInlineComment = {
      path: 'src/main.ts',
      line: 15,
      start_line: 10,
      body: 'Multi-line issue',
    };
    const result = toGitHubComment(comment);
    expect(result).toEqual({
      path: 'src/main.ts',
      line: 15,
      side: 'RIGHT',
      body: 'Multi-line issue',
      start_line: 10,
      start_side: 'RIGHT',
    });
  });

  test('start_side falls back to side when side is explicitly set', () => {
    const comment: ReviewInlineComment = {
      path: 'src/main.ts',
      line: 15,
      start_line: 10,
      side: 'LEFT',
      body: 'Old multi-line',
    };
    const result = toGitHubComment(comment);
    expect(result.start_side).toBe('LEFT');
    expect(result.side).toBe('LEFT');
  });

  test('start_side uses explicit value when provided', () => {
    const comment: ReviewInlineComment = {
      path: 'src/main.ts',
      line: 15,
      start_line: 10,
      side: 'RIGHT',
      start_side: 'LEFT',
      body: 'Cross-side comment',
    };
    const result = toGitHubComment(comment);
    expect(result.side).toBe('RIGHT');
    expect(result.start_side).toBe('LEFT');
  });

  test('omits start_line and start_side when start_line is not provided', () => {
    const comment: ReviewInlineComment = {
      path: 'src/util.ts',
      line: 5,
      body: 'Single line',
    };
    const result = toGitHubComment(comment);
    expect(result).not.toHaveProperty('start_line');
    expect(result).not.toHaveProperty('start_side');
  });
});

/**
 * Tests for the review creation logic.
 *
 * Tests validation, parameter transformation, and the createReview
 * function exported from the platform layer.
 */

import { describe, expect, test } from 'bun:test';
import { validateCreateReviewParams } from '../../../src/platform/github/tools/review';
import type { CreateReviewParams } from '../../../src/platform/github/types';

describe('validateCreateReviewParams', () => {
  test('throws when comments array is empty', () => {
    const params: CreateReviewParams = { comments: [] };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /At least one inline comment is required/
    );
  });

  test('throws when comment path is empty', () => {
    const params: CreateReviewParams = {
      comments: [{ path: '', line: 1, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(/"path" is required/);
  });

  test('throws when comment body is empty', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1, body: '' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(/"body" is required/);
  });

  test('throws when line is not a positive integer', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 0, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(/"line" must be a positive integer/);
  });

  test('throws when line is negative', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: -1, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(/"line" must be a positive integer/);
  });

  test('throws when start_line is greater than line', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 5, start_line: 10, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /"start_line" \(10\) must be <= "line" \(5\)/
    );
  });

  test('throws when start_line is not a positive integer', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 5, start_line: 0, body: 'test' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(
      /"start_line" must be a positive integer/
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
      comments: [
        { path: 'src/main.ts', line: 15, start_line: 10, body: 'Multi-line issue' },
      ],
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
    expect(() => validateCreateReviewParams(params)).toThrow(/"path" is required/);
  });

  test('throws when whitespace-only body', () => {
    const params: CreateReviewParams = {
      comments: [{ path: 'src/main.ts', line: 1, body: '   ' }],
    };
    expect(() => validateCreateReviewParams(params)).toThrow(/"body" is required/);
  });
});

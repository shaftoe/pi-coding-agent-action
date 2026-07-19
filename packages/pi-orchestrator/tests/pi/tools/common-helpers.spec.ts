/**
 * Unit tests for the pure render helpers exported from
 * `packages/pi-orchestrator/src/pi/tools/common.ts`.
 *
 * These complement `common.spec.ts`, which tests the full
 * `formatThreadAsText` pipeline end-to-end. Each helper here is a pure
 * function over a fake `IssueOrPRThread`.
 */

import { describe, expect, test } from 'vitest';
import {
  formatPRFields,
  formatReviewComments,
  formatThreadBody,
  formatThreadComments,
  formatThreadHeader,
  formatThreadLabels,
  formatThreadTimestamps,
} from '@alexanderfortin/pi-orchestrator';
import type {
  IssueOrPRThread,
  ReviewComment,
  ThreadComment,
} from '@alexanderfortin/pi-orchestrator';

function buildThread(overrides: Partial<IssueOrPRThread> = {}): IssueOrPRThread {
  return {
    number: 42,
    title: 'Fix the bug',
    body: 'some description',
    state: 'open',
    author: 'alice',
    author_type: 'user',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    closed_at: undefined,
    merged_at: undefined,
    labels: [],
    is_pull_request: false,
    head_branch: undefined,
    base_branch: undefined,
    head_sha: undefined,
    comments: [],
    review_comments: [],
    ...overrides,
  };
}

function buildComment(overrides: Partial<ThreadComment> = {}): ThreadComment {
  return {
    id: 1,
    author: 'bob',
    author_type: 'user',
    created_at: '2024-02-01T00:00:00Z',
    body: 'comment body',
    ...overrides,
  };
}

function buildReviewComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: 100,
    path: 'src/main.ts',
    line: 42,
    side: 'RIGHT',
    author: 'carol',
    author_type: 'user',
    created_at: '2024-03-01T00:00:00Z',
    body: 'inline review comment',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatThreadHeader
// ---------------------------------------------------------------------------

describe('formatThreadHeader', () => {
  test('renders Issue header for issues', () => {
    const lines = formatThreadHeader(buildThread({ is_pull_request: false }));
    expect(lines[0]).toBe('Issue #42: Fix the bug');
  });

  test('renders Pull Request header for PRs', () => {
    const lines = formatThreadHeader(buildThread({ is_pull_request: true }));
    expect(lines[0]).toBe('Pull Request #42: Fix the bug');
  });

  test('emits a blank separator line after the title', () => {
    const lines = formatThreadHeader(buildThread());
    expect(lines[1]).toBe('');
  });

  test('uppercases the state', () => {
    const lines = formatThreadHeader(buildThread({ state: 'closed' }));
    expect(lines).toContain('State: CLOSED');
  });

  test('appends "(bot)" when author is a bot', () => {
    const lines = formatThreadHeader(buildThread({ author: 'dependabot', author_type: 'bot' }));
    expect(lines).toContain('Author: @dependabot (bot)');
  });

  test('does not append "(bot)" when author is a user', () => {
    const lines = formatThreadHeader(buildThread({ author: 'alice', author_type: 'user' }));
    expect(lines).toContain('Author: @alice');
  });
});

// ---------------------------------------------------------------------------
// formatThreadTimestamps
// ---------------------------------------------------------------------------

describe('formatThreadTimestamps', () => {
  test('returns [] when no timestamps are set', () => {
    expect(
      formatThreadTimestamps(
        buildThread({
          created_at: undefined,
          updated_at: undefined,
          closed_at: undefined,
          merged_at: undefined,
        })
      )
    ).toEqual([]);
  });

  test('emits only the Created line when only created_at is set', () => {
    const lines = formatThreadTimestamps(
      buildThread({
        created_at: '2024-01-01T00:00:00Z',
        updated_at: undefined,
        closed_at: undefined,
        merged_at: undefined,
      })
    );
    expect(lines).toEqual(['Created: 2024-01-01T00:00:00Z']);
  });

  test('emits Updated line when updated_at is set', () => {
    const lines = formatThreadTimestamps(buildThread({ updated_at: '2024-06-01T12:00:00Z' }));
    expect(lines.some(l => l.startsWith('Updated: '))).toBe(true);
  });

  test('emits Closed line when closed_at is set', () => {
    const lines = formatThreadTimestamps(buildThread({ closed_at: '2024-06-01T12:00:00Z' }));
    expect(lines.some(l => l.startsWith('Closed: '))).toBe(true);
  });

  test('emits Merged line when merged_at is set', () => {
    const lines = formatThreadTimestamps(buildThread({ merged_at: '2024-06-01T12:00:00Z' }));
    expect(lines.some(l => l.startsWith('Merged: '))).toBe(true);
  });

  test('emits all four timestamps in canonical order when all are set', () => {
    const lines = formatThreadTimestamps(
      buildThread({
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
        closed_at: '2024-01-03T00:00:00Z',
        merged_at: '2024-01-04T00:00:00Z',
      })
    );
    expect(lines.map(l => l.split(':')[0])).toEqual(['Created', 'Updated', 'Closed', 'Merged']);
  });
});

// ---------------------------------------------------------------------------
// formatThreadLabels
// ---------------------------------------------------------------------------

describe('formatThreadLabels', () => {
  test('returns [] when there are no labels', () => {
    expect(formatThreadLabels(buildThread({ labels: [] }))).toEqual([]);
  });

  test('renders a single label', () => {
    const lines = formatThreadLabels(buildThread({ labels: ['bug'] }));
    expect(lines).toEqual(['Labels: "bug"']);
  });

  test('renders multiple labels comma-separated', () => {
    const lines = formatThreadLabels(buildThread({ labels: ['bug', 'enhancement', 'docs'] }));
    expect(lines).toEqual(['Labels: "bug", "enhancement", "docs"']);
  });
});

// ---------------------------------------------------------------------------
// formatPRFields
// ---------------------------------------------------------------------------

describe('formatPRFields', () => {
  test('returns [] for issues', () => {
    expect(formatPRFields(buildThread({ is_pull_request: false }))).toEqual([]);
  });

  test('renders head/base/sha for PRs', () => {
    const lines = formatPRFields(
      buildThread({
        is_pull_request: true,
        head_branch: 'feature/foo',
        base_branch: 'main',
        head_sha: 'abc123',
      })
    );
    expect(lines).toEqual(['Head Branch: feature/foo', 'Base Branch: main', 'Head SHA: abc123']);
  });

  test('uses "unknown" placeholder when PR fields are missing', () => {
    const lines = formatPRFields(
      buildThread({
        is_pull_request: true,
        head_branch: undefined,
        base_branch: undefined,
        head_sha: undefined,
      })
    );
    expect(lines).toEqual(['Head Branch: unknown', 'Base Branch: unknown', 'Head SHA: unknown']);
  });
});

// ---------------------------------------------------------------------------
// formatThreadBody
// ---------------------------------------------------------------------------

describe('formatThreadBody', () => {
  test('returns [] when there is no body', () => {
    expect(formatThreadBody(buildThread({ body: null }))).toEqual([]);
    expect(formatThreadBody(buildThread({ body: undefined }))).toEqual([]);
    expect(formatThreadBody(buildThread({ body: '' }))).toEqual([]);
  });

  test('renders Description label, body, and trailing blank separator', () => {
    const lines = formatThreadBody(buildThread({ body: 'this is the body' }));
    expect(lines).toEqual(['', 'Description:', 'this is the body', '']);
  });
});

// ---------------------------------------------------------------------------
// formatThreadComments
// ---------------------------------------------------------------------------

describe('formatThreadComments', () => {
  test('emits the count header even when there are no comments', () => {
    const lines = formatThreadComments([]);
    expect(lines).toEqual(['Comments (0):']);
  });

  test('renders one numbered block per comment', () => {
    const lines = formatThreadComments([
      buildComment({ id: 1, author: 'alice', body: 'first' }),
      buildComment({ id: 2, author: 'bob', body: 'second' }),
    ]);
    expect(lines[0]).toBe('Comments (2):');
    // Block 1 (3 lines): author / timestamp / body
    expect(lines[1]).toContain('1. @alice');
    expect(lines[3]).toContain('first');
    // Block 2 (3 more lines, starting at index 4)
    expect(lines[4]).toContain('2. @bob');
    expect(lines[6]).toContain('second');
  });

  test('appends the triggering-comment marker when set', () => {
    const lines = formatThreadComments([
      buildComment({ is_triggering_comment: true, author: 'alice' }),
    ]);
    expect(lines[1]).toContain('[📍 triggering comment]');
  });

  test('omits the triggering-comment marker when not set', () => {
    const lines = formatThreadComments([buildComment({ is_triggering_comment: false })]);
    expect(lines[1]).not.toContain('triggering');
  });

  test('appends "(bot)" when author is a bot', () => {
    const lines = formatThreadComments([buildComment({ author: 'renovate', author_type: 'bot' })]);
    expect(lines[1]).toContain('@renovate (bot)');
  });
});

// ---------------------------------------------------------------------------
// formatReviewComments
// ---------------------------------------------------------------------------

describe('formatReviewComments', () => {
  test('returns [] when reviewComments is undefined', () => {
    expect(formatReviewComments(undefined)).toEqual([]);
  });

  test('returns [] when reviewComments is empty', () => {
    expect(formatReviewComments([])).toEqual([]);
  });

  test('emits a separator + count header + one numbered block per comment', () => {
    const lines = formatReviewComments([buildReviewComment()]);
    expect(lines[0]).toBe('');
    expect(lines[1]).toBe('Review Comments (1):');
    expect(lines[2]).toContain('src/main.ts');
    expect(lines[2]).toContain('@carol');
  });

  test('renders line number with " L" prefix when line is non-null', () => {
    const lines = formatReviewComments([buildReviewComment({ line: 99 })]);
    expect(lines[2]).toContain('src/main.ts L99');
  });

  test('omits the line number when line is null', () => {
    const lines = formatReviewComments([buildReviewComment({ line: null })]);
    expect(lines[2]).not.toMatch(/ L\d+/);
    expect(lines[2]).toContain('src/main.ts');
  });

  test('appends " [old]" when side is LEFT', () => {
    const lines = formatReviewComments([buildReviewComment({ side: 'LEFT' })]);
    expect(lines[2]).toContain('[old]');
  });

  test('omits " [old]" when side is RIGHT', () => {
    const lines = formatReviewComments([buildReviewComment({ side: 'RIGHT' })]);
    expect(lines[2]).not.toContain('[old]');
  });

  test('appends "(bot)" when author is a bot', () => {
    const lines = formatReviewComments([
      buildReviewComment({ author: 'dependabot', author_type: 'bot' }),
    ]);
    expect(lines[2]).toContain('@dependabot (bot)');
  });
});

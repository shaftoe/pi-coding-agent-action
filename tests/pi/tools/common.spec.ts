import { describe, expect, test } from 'bun:test';
import { formatThreadAsText } from '../../../src/pi/tools/common';
import type { IssueOrPRThread } from '../../../src/platform';

function createMockIssue(overrides?: Partial<IssueOrPRThread>): IssueOrPRThread {
  return {
    number: 123,
    title: 'Test Issue',
    state: 'open',
    author: 'testuser',
    author_type: 'user',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    closed_at: undefined,
    merged_at: undefined,
    labels: [],
    is_pull_request: false,
    body: 'Test body',
    head_branch: undefined,
    base_branch: undefined,
    head_sha: undefined,
    comments: [],
    ...overrides,
  };
}

function createMockPR(overrides?: Partial<IssueOrPRThread>): IssueOrPRThread {
  return {
    number: 456,
    title: 'Test PR',
    state: 'open',
    author: 'testuser',
    author_type: 'user',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    closed_at: undefined,
    merged_at: undefined,
    labels: [],
    is_pull_request: true,
    head_branch: 'feature/test',
    base_branch: 'main',
    head_sha: 'abc123',
    body: 'PR body',
    comments: [],
    ...overrides,
  };
}

describe('formatThreadAsText', () => {
  test('formats basic issue without comments', () => {
    const thread = createMockIssue();
    const result = formatThreadAsText(thread);
    expect(result).toContain('Issue #123: Test Issue');
    expect(result).toContain('State: OPEN');
    expect(result).toContain('Author: @testuser');
    expect(result).toContain('Created: 2024-01-01T00:00:00Z');
    expect(result).toContain('Updated: 2024-01-02T00:00:00Z');
    expect(result).toContain('Description:');
    expect(result).toContain('Test body');
    expect(result).toContain('Comments (0):');
  });

  test('formats pull request with branch info', () => {
    const thread = createMockPR();
    const result = formatThreadAsText(thread);
    expect(result).toContain('Pull Request #456: Test PR');
    expect(result).toContain('Head Branch: feature/test');
    expect(result).toContain('Base Branch: main');
    expect(result).toContain('Head SHA: abc123');
  });

  test('formats issue with labels', () => {
    const thread = createMockIssue({ labels: ['bug', 'enhancement'] });
    const result = formatThreadAsText(thread);
    expect(result).toContain('Labels: "bug", "enhancement"');
  });

  test('formats closed issue with closed_at timestamp', () => {
    const thread = createMockIssue({ state: 'closed', closed_at: '2024-01-03T00:00:00Z' });
    const result = formatThreadAsText(thread);
    expect(result).toContain('State: CLOSED');
    expect(result).toContain('Closed: 2024-01-03T00:00:00Z');
  });

  test('formats merged PR with merged_at timestamp', () => {
    const thread = createMockPR({ state: 'merged', closed_at: '2024-01-03T00:00:00Z', merged_at: '2024-01-03T12:00:00Z' });
    const result = formatThreadAsText(thread);
    expect(result).toContain('State: MERGED');
    expect(result).toContain('Merged: 2024-01-03T12:00:00Z');
  });

  test('formats bot author', () => {
    const thread = createMockIssue({ author: 'botuser', author_type: 'bot' });
    const result = formatThreadAsText(thread);
    expect(result).toContain('Author: @botuser (bot)');
  });

  test('formats issue without body', () => {
    const thread = createMockIssue({ body: null });
    const result = formatThreadAsText(thread);
    expect(result).not.toContain('Description:');
  });

  test('formats issue with comments', () => {
    const thread = createMockIssue({
      comments: [
        {
          id: 1,
          author: 'commenter1',
          author_type: 'user',
          created_at: '2024-01-02T00:00:00Z',
          body: 'First comment',
          is_triggering_comment: false,
        },
        {
          id: 2,
          author: 'commenter2',
          author_type: 'user',
          created_at: '2024-01-03T00:00:00Z',
          body: 'Second comment',
          is_triggering_comment: true,
        },
      ],
    });
    const result = formatThreadAsText(thread);
    expect(result).toContain('Comments (2):');
    expect(result).toContain('1. @commenter1');
    expect(result).toContain('First comment');
    expect(result).toContain('2. @commenter2');
    expect(result).toContain('Second comment');
    expect(result).toContain('[📍 triggering comment]');
  });

  test('formats issue with bot comment', () => {
    const thread = createMockIssue({
      comments: [
        {
          id: 1,
          author: 'bot',
          author_type: 'bot',
          created_at: '2024-01-02T00:00:00Z',
          body: 'Bot comment',
          is_triggering_comment: false,
        },
      ],
    });
    const result = formatThreadAsText(thread);
    expect(result).toContain('@bot (bot)');
  });

  test('handles PR with unknown branch values', () => {
    const thread = createMockPR({ head_branch: undefined, base_branch: undefined, head_sha: undefined });
    const result = formatThreadAsText(thread);
    expect(result).toContain('Head Branch: unknown');
    expect(result).toContain('Base Branch: unknown');
    expect(result).toContain('Head SHA: unknown');
  });
});

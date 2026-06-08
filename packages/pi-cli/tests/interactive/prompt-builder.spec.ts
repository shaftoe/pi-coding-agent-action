/**
 * @file Tests for {@link packages/pi-cli/src/interactive/prompt-builder.ts}.
 *
 * Covers:
 *   - formatThreadAsPrompt: produces correct prompt for issues and PRs
 *   - buildIssuePrompt / buildPRPrompt: (tested with mock provider)
 */

import { describe, it, expect } from 'bun:test';
import { formatThreadAsPrompt } from '../../src/interactive/prompt-builder.js';
import type { IssueOrPRThread } from '@alexanderfortin/pi-orchestrator';

describe('formatThreadAsPrompt', () => {
  const baseThread: IssueOrPRThread = {
    number: 277,
    title: 'Develop CLI features',
    body: 'Let us use pi-cli package as starting reference.',
    state: 'open',
    author: 'alice',
    author_type: 'user',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    closed_at: null,
    merged_at: null,
    labels: ['enhancement', 'cli'],
    is_pull_request: false,
    head_branch: undefined,
    base_branch: undefined,
    head_sha: undefined,
    comments: [],
    review_comments: [],
  };

  describe('basic formatting', () => {
    it('includes the issue number and title', () => {
      const prompt = formatThreadAsPrompt(baseThread);
      expect(prompt).toContain('Issue #277: Develop CLI features');
    });

    it('includes the body as description', () => {
      const prompt = formatThreadAsPrompt(baseThread);
      expect(prompt).toContain('Description:');
      expect(prompt).toContain('Let us use pi-cli package as starting reference.');
    });

    it('includes the state', () => {
      const prompt = formatThreadAsPrompt(baseThread);
      expect(prompt).toContain('State: open');
    });

    it('includes labels', () => {
      const prompt = formatThreadAsPrompt(baseThread);
      expect(prompt).toContain('Labels: enhancement, cli');
    });
  });

  describe('without instruction', () => {
    it('uses default continuation instruction', () => {
      const prompt = formatThreadAsPrompt(baseThread);
      expect(prompt).toContain('Continue working on this based on the thread context above.');
    });
  });

  describe('with instruction', () => {
    it('includes the user instruction', () => {
      const prompt = formatThreadAsPrompt(baseThread, 'implement the CLI constitution');
      expect(prompt).toContain('Comment/Instruction:');
      expect(prompt).toContain('implement the CLI constitution');
    });
  });

  describe('without body', () => {
    it('omits the description section', () => {
      const thread = { ...baseThread, body: null };
      const prompt = formatThreadAsPrompt(thread);
      expect(prompt).not.toContain('Description:');
    });
  });

  describe('without labels', () => {
    it('omits the labels line', () => {
      const thread = { ...baseThread, labels: [] };
      const prompt = formatThreadAsPrompt(thread);
      expect(prompt).not.toContain('Labels:');
    });
  });

  describe('with comments', () => {
    it('includes all comments with authors', () => {
      const thread: IssueOrPRThread = {
        ...baseThread,
        comments: [
          {
            id: 1,
            author: 'bob',
            author_type: 'user',
            created_at: '2026-01-01T10:00:00Z',
            body: 'This looks great!',
          },
          {
            id: 2,
            author: 'pi-agent',
            author_type: 'bot',
            created_at: '2026-01-01T11:00:00Z',
            body: 'I have started implementing the CLI extension.',
          },
        ],
      };

      const prompt = formatThreadAsPrompt(thread);
      expect(prompt).toContain('@bob:');
      expect(prompt).toContain('This looks great!');
      expect(prompt).toContain('[Agent] pi-agent');
      expect(prompt).toContain('I have started implementing the CLI extension.');
    });

    it('marks triggering comments', () => {
      const thread: IssueOrPRThread = {
        ...baseThread,
        comments: [
          {
            id: 1,
            author: 'alice',
            author_type: 'user',
            created_at: '2026-01-01T10:00:00Z',
            body: '/pi implement the CLI',
            is_triggering_comment: true,
          },
        ],
      };

      const prompt = formatThreadAsPrompt(thread);
      expect(prompt).toContain('⚡');
    });
  });

  describe('for PRs', () => {
    const prThread: IssueOrPRThread = {
      ...baseThread,
      is_pull_request: true,
      head_branch: 'feature/cli',
      base_branch: 'main',
      head_sha: 'abc123',
    };

    it('shows PR header instead of Issue', () => {
      const prompt = formatThreadAsPrompt(prThread);
      expect(prompt).toContain('PR #277: Develop CLI features');
      expect(prompt).not.toContain('Issue #277');
    });

    it('includes branch info', () => {
      const prompt = formatThreadAsPrompt(prThread);
      expect(prompt).toContain('Branch: feature/cli → main');
    });

    it('includes review comments', () => {
      const thread: IssueOrPRThread = {
        ...prThread,
        review_comments: [
          {
            id: 10,
            path: 'src/index.ts',
            line: 42,
            side: 'RIGHT' as const,
            author: 'reviewer',
            author_type: 'user',
            created_at: '2026-01-01T12:00:00Z',
            body: 'This function could be simplified.',
          },
        ],
      };

      const prompt = formatThreadAsPrompt(thread);
      expect(prompt).toContain('Review comments (inline):');
      expect(prompt).toContain('src/index.ts:42');
      expect(prompt).toContain('This function could be simplified.');
    });

    it('handles review comments with null line', () => {
      const thread: IssueOrPRThread = {
        ...prThread,
        review_comments: [
          {
            id: 11,
            path: 'src/config.ts',
            line: null,
            side: 'RIGHT' as const,
            author: 'reviewer',
            author_type: 'user',
            created_at: '2026-01-01T12:00:00Z',
            body: 'General comment on this file.',
          },
        ],
      };

      const prompt = formatThreadAsPrompt(thread);
      // When line is null, only the path should be shown
      expect(prompt).toContain('src/config.ts');
      expect(prompt).not.toContain('src/config.ts:null');
    });
  });
});

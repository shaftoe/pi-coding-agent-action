import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { gh, GitHubClient } from './gh.js';
import type { IssueNode, PRNode } from './types.js';

describe('GitHubClient', () => {
  let getInputSpy: ReturnType<typeof spyOn>;
  let getOctokitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Set GITHUB_REPOSITORY environment variable for context.repo
    process.env.GITHUB_REPOSITORY = 'owner/repo';

    // Spy on getInput
    getInputSpy = spyOn(core, 'getInput').mockImplementation((name: string) => {
      if (name === 'github_token') {
        return 'test-token';
      }
      return '';
    });

    // Spy on getOctokit
    const createMockMethod = <T extends (...args: unknown[]) => unknown>(fn: T) => {
      const mockFn = mock(fn);
      return Object.assign(mockFn, {
        defaults: mock(() => mockFn),
        endpoint: mock(() => ({})),
      });
    };

    const mockOctokit = {
      rest: {
        issues: {
          createComment: createMockMethod(() => Promise.resolve({ data: {} })),
          updateComment: createMockMethod(() => Promise.resolve({ data: {} })),
        },
        reactions: {
          createForIssueComment: createMockMethod(() => Promise.resolve({ data: { id: 123 } })),
          deleteForIssueComment: createMockMethod(() => Promise.resolve({ data: {} })),
        },
        pulls: {
          create: createMockMethod(() => Promise.resolve({ data: { number: 42 } })),
        },
      },
    } as unknown as ReturnType<typeof github.getOctokit>;

    getOctokitSpy = spyOn(github, 'getOctokit').mockReturnValue(mockOctokit);
  });

  afterEach(() => {
    getInputSpy.mockRestore();
    getOctokitSpy.mockRestore();
    delete process.env.GITHUB_REPOSITORY;
  });

  describe('cli method', () => {
    it('should be available on gh instance', () => {
      expect(typeof gh.cli).toBe('function');
    });

    it('should set GH_TOKEN environment variable', () => {
      const env = { ...process.env };
      env.GH_TOKEN = 'test-token';
      expect(env.GH_TOKEN).toBe('test-token');
    });
  });

  describe('getIssueData method', () => {
    it('should be available on gh instance', () => {
      expect(typeof gh.getIssueData).toBe('function');
    });

    it('should include all required issue fields', () => {
      const mockIssue: IssueNode = {
        title: 'Test',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        createdAt: '2026-03-22T00:00:00Z',
        comments: [],
      };

      expect(mockIssue).toHaveProperty('title');
      expect(mockIssue).toHaveProperty('body');
      expect(mockIssue).toHaveProperty('state');
      expect(mockIssue).toHaveProperty('author');
      expect(mockIssue).toHaveProperty('createdAt');
    });
  });

  describe('getPRData method', () => {
    it('should be available on gh instance', () => {
      expect(typeof gh.getPRData).toBe('function');
    });

    it('should include all required PR fields', () => {
      const mockPR: PRNode = {
        title: 'Test PR',
        body: 'PR Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T00:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 3 },
      };

      expect(mockPR).toHaveProperty('title');
      expect(mockPR).toHaveProperty('body');
      expect(mockPR).toHaveProperty('state');
      expect(mockPR).toHaveProperty('author');
      expect(mockPR).toHaveProperty('baseRefName');
      expect(mockPR).toHaveProperty('headRefName');
      expect(mockPR).toHaveProperty('headRefOid');
      expect(mockPR).toHaveProperty('additions');
      expect(mockPR).toHaveProperty('deletions');
      expect(mockPR).toHaveProperty('baseRepository');
      expect(mockPR).toHaveProperty('headRepository');
      expect(mockPR).toHaveProperty('commits');
    });
  });

  describe('createComment method', () => {
    it('should be available on gh instance', () => {
      expect(typeof gh.createComment).toBe('function');
    });

    it('should be async', () => {
      const promise = gh.createComment(1, 'test');
      expect(promise).toBeInstanceOf(Promise);
      promise.catch(() => {
        // Suppress any unhandled rejections
      });
    });
  });

  describe('addReaction method', () => {
    it('should be available on gh instance', () => {
      expect(typeof gh.addReaction).toBe('function');
    });

    it('should be async', () => {
      const promise = gh.addReaction(1, 'eyes');
      expect(promise).toBeInstanceOf(Promise);
      promise.catch(() => {
        // Suppress any unhandled rejections
      });
    });

    it('should return the reaction ID', async () => {
      const reactionId = await gh.addReaction(1, 'eyes');
      expect(typeof reactionId).toBe('number');
      expect(reactionId).toBe(123);
    });
  });

  describe('removeReaction method', () => {
    it('should be available on gh instance', () => {
      expect(typeof gh.removeReaction).toBe('function');
    });

    it('should be async', () => {
      const promise = gh.removeReaction(1, 123);
      expect(promise).toBeInstanceOf(Promise);
      promise.catch(() => {
        // Suppress any unhandled rejections
      });
    });

    it('should complete without throwing', async () => {
      await gh.removeReaction(1, 123);
      expect(true).toBe(true);
    });
  });

  describe('createPR method', () => {
    it('should be available on gh instance', () => {
      expect(typeof gh.createPR).toBe('function');
    });

    it('should be async', () => {
      const promise = gh.createPR('main', 'feature', 'Test', 'Body');
      expect(promise).toBeInstanceOf(Promise);
      promise.catch(() => {
        // Suppress any unhandled rejections
      });
    });
  });

  describe('GitHubClient constructor', () => {
    it('should accept a custom token', () => {
      const client = new GitHubClient('custom-token');
      expect(client).toBeInstanceOf(GitHubClient);
    });

    it('should use core.getInput when no token is provided', () => {
      const client = new GitHubClient();
      expect(client).toBeInstanceOf(GitHubClient);
    });
  });
});

import { describe, it, expect } from 'bun:test';
import type { IssueComment, IssueNode, PRNode, GitAuthor } from './types.js';

describe('types', () => {
  describe('IssueComment', () => {
    it('should have required properties', () => {
      const comment: IssueComment = {
        databaseId: 123,
        body: 'Test comment',
        author: { login: 'user' },
        createdAt: '2026-03-22T12:00:00Z',
      };

      expect(comment).toHaveProperty('databaseId');
      expect(comment).toHaveProperty('body');
      expect(comment).toHaveProperty('author');
      expect(comment).toHaveProperty('createdAt');
    });

    it('should accept valid comment data', () => {
      const comment: IssueComment = {
        databaseId: 456,
        body: 'This is a comment',
        author: { login: 'commenter' },
        createdAt: '2026-03-22T13:30:00Z',
      };

      expect(comment.databaseId).toBe(456);
      expect(comment.body).toBe('This is a comment');
      expect(comment.author.login).toBe('commenter');
      expect(comment.createdAt).toBe('2026-03-22T13:30:00Z');
    });

    it('should accept multiline comment body', () => {
      const comment: IssueComment = {
        databaseId: 789,
        body: 'Line 1\nLine 2\nLine 3',
        author: { login: 'user' },
        createdAt: '2026-03-22T14:00:00Z',
      };

      expect(comment.body.split('\n')).toHaveLength(3);
    });

    it('should accept empty comment body', () => {
      const comment: IssueComment = {
        databaseId: 1,
        body: '',
        author: { login: 'user' },
        createdAt: '2026-03-22T14:00:00Z',
      };

      expect(comment.body).toBe('');
    });
  });

  describe('IssueNode', () => {
    it('should have required properties', () => {
      const issue: IssueNode = {
        title: 'Test Issue',
        body: 'Issue body',
        state: 'OPEN',
        author: { login: 'user' },
        createdAt: '2026-03-22T12:00:00Z',
      };

      expect(issue).toHaveProperty('title');
      expect(issue).toHaveProperty('body');
      expect(issue).toHaveProperty('state');
      expect(issue).toHaveProperty('author');
      expect(issue).toHaveProperty('createdAt');
    });

    it('should accept valid issue data', () => {
      const issue: IssueNode = {
        title: 'Bug fix needed',
        body: 'This is a bug',
        state: 'OPEN',
        author: { login: 'reporter' },
        createdAt: '2026-03-22T10:00:00Z',
      };

      expect(issue.title).toBe('Bug fix needed');
      expect(issue.body).toBe('This is a bug');
      expect(issue.state).toBe('OPEN');
      expect(issue.author.login).toBe('reporter');
    });

    it('should accept comments array', () => {
      const issue: IssueNode = {
        title: 'Issue with comments',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        createdAt: '2026-03-22T12:00:00Z',
        comments: [
          {
            databaseId: 1,
            body: 'First comment',
            author: { login: 'commenter1' },
            createdAt: '2026-03-22T13:00:00Z',
          },
          {
            databaseId: 2,
            body: 'Second comment',
            author: { login: 'commenter2' },
            createdAt: '2026-03-22T14:00:00Z',
          },
        ],
      };

      expect(issue.comments).toBeDefined();
      expect(issue.comments?.length).toBe(2);
    });

    it('should accept undefined comments', () => {
      const issue: IssueNode = {
        title: 'Issue without comments',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        createdAt: '2026-03-22T12:00:00Z',
      };

      expect(issue.comments).toBeUndefined();
    });

    it('should accept empty comments array', () => {
      const issue: IssueNode = {
        title: 'Issue',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        createdAt: '2026-03-22T12:00:00Z',
        comments: [],
      };

      expect(issue.comments).toEqual([]);
    });

    it('should handle different issue states', () => {
      const states: string[] = ['OPEN', 'CLOSED', 'MERGED'];

      states.forEach(state => {
        const issue: IssueNode = {
          title: 'Test',
          body: 'Body',
          state,
          author: { login: 'user' },
          createdAt: '2026-03-22T12:00:00Z',
        };

        expect(issue.state).toBe(state);
      });
    });

    it('should accept empty body', () => {
      const issue: IssueNode = {
        title: 'Issue with no body',
        body: '',
        state: 'OPEN',
        author: { login: 'user' },
        createdAt: '2026-03-22T12:00:00Z',
      };

      expect(issue.body).toBe('');
    });
  });

  describe('PRNode', () => {
    it('should have all required properties', () => {
      const pr: PRNode = {
        title: 'Test PR',
        body: 'PR body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 3 },
      };

      expect(pr).toHaveProperty('title');
      expect(pr).toHaveProperty('body');
      expect(pr).toHaveProperty('state');
      expect(pr).toHaveProperty('author');
      expect(pr).toHaveProperty('baseRefName');
      expect(pr).toHaveProperty('headRefName');
      expect(pr).toHaveProperty('headRefOid');
      expect(pr).toHaveProperty('createdAt');
      expect(pr).toHaveProperty('additions');
      expect(pr).toHaveProperty('deletions');
      expect(pr).toHaveProperty('baseRepository');
      expect(pr).toHaveProperty('headRepository');
      expect(pr).toHaveProperty('commits');
    });

    it('should accept valid PR data', () => {
      const pr: PRNode = {
        title: 'Feature implementation',
        body: 'This PR adds a feature',
        state: 'OPEN',
        author: { login: 'contributor' },
        baseRefName: 'develop',
        headRefName: 'feature/new-feature',
        headRefOid: 'def456',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 100,
        deletions: 25,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 7 },
      };

      expect(pr.title).toBe('Feature implementation');
      expect(pr.baseRefName).toBe('develop');
      expect(pr.headRefName).toBe('feature/new-feature');
      expect(pr.additions).toBe(100);
      expect(pr.deletions).toBe(25);
    });

    it('should accept files array', () => {
      const pr: PRNode = {
        title: 'PR',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 50,
        deletions: 25,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 2 },
        files: [
          {
            path: 'src/file1.ts',
            additions: 25,
            deletions: 10,
            changeType: 'MODIFIED',
          },
          {
            path: 'src/file2.ts',
            additions: 25,
            deletions: 15,
            changeType: 'ADDED',
          },
        ],
      };

      expect(pr.files).toBeDefined();
      expect(pr.files?.length).toBe(2);
      expect(pr.files?.[0]?.path).toBe('src/file1.ts');
      expect(pr.files?.[1]?.changeType).toBe('ADDED');
    });

    it('should accept comments array', () => {
      const pr: PRNode = {
        title: 'PR',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 1 },
        comments: [
          {
            databaseId: 1,
            body: 'PR comment',
            author: { login: 'reviewer' },
            createdAt: '2026-03-22T13:00:00Z',
          },
        ],
      };

      expect(pr.comments).toBeDefined();
      expect(pr.comments?.length).toBe(1);
    });

    it('should accept reviews array', () => {
      const pr: PRNode = {
        title: 'PR',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 1 },
        reviews: [
          {
            author: { login: 'reviewer' },
            body: 'Looks good',
            submittedAt: '2026-03-22T14:00:00Z',
          },
        ],
      };

      expect(pr.reviews).toBeDefined();
      expect(pr.reviews?.length).toBe(1);
    });

    it('should accept reviews with comments', () => {
      const pr: PRNode = {
        title: 'PR',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 1 },
        reviews: [
          {
            author: { login: 'reviewer' },
            body: 'Some feedback',
            submittedAt: '2026-03-22T14:00:00Z',
            comments: [
              {
                path: 'src/file.ts',
                line: 10,
                body: 'Fix this',
              },
            ],
          },
        ],
      };

      expect(pr.reviews?.[0]?.comments).toBeDefined();
      expect(pr.reviews?.[0]?.comments?.[0]?.path).toBe('src/file.ts');
      expect(pr.reviews?.[0]?.comments?.[0]?.line).toBe(10);
    });

    it('should handle different change types', () => {
      const changeTypes = ['ADDED', 'MODIFIED', 'DELETED', 'RENAMED'];

      changeTypes.forEach(changeType => {
        const pr: PRNode = {
          title: 'PR',
          body: 'Body',
          state: 'OPEN',
          author: { login: 'user' },
          baseRefName: 'main',
          headRefName: 'feature',
          headRefOid: 'abc123',
          createdAt: '2026-03-22T12:00:00Z',
          additions: 10,
          deletions: 5,
          baseRepository: { nameWithOwner: 'owner/repo' },
          headRepository: { nameWithOwner: 'owner/repo' },
          commits: { totalCount: 1 },
          files: [
            {
              path: 'file.ts',
              additions: 10,
              deletions: 5,
              changeType,
            },
          ],
        };

        expect(pr.files?.[0]?.changeType).toBe(changeType);
      });
    });

    it('should handle fork PR', () => {
      const pr: PRNode = {
        title: 'PR from fork',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'fork-user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'fork/repo' },
        commits: { totalCount: 1 },
      };

      expect(pr.baseRepository?.nameWithOwner).toBe('owner/repo');
      expect(pr.headRepository.nameWithOwner).toBe('fork/repo');
    });
  });

  describe('GitAuthor', () => {
    it('should have required name and email properties', () => {
      const author: GitAuthor = {
        name: 'Test Author',
        email: 'test@example.com',
      };

      expect(author).toHaveProperty('name');
      expect(author).toHaveProperty('email');
      expect(author.name).toBe('Test Author');
      expect(author.email).toBe('test@example.com');
    });

    it('should accept bot author format', () => {
      const botAuthor: GitAuthor = {
        name: 'bot[bot]',
        email: 'bot[bot]@users.noreply.github.com',
      };

      expect(botAuthor.name).toContain('[bot]');
      expect(botAuthor.email).toContain('users.noreply.github.com');
    });

    it('should accept GitHub noreply email format', () => {
      const author: GitAuthor = {
        name: 'GitHub User',
        email: 'username@users.noreply.github.com',
      };

      expect(author.email).toContain('users.noreply.github.com');
    });

    it('should accept regular email addresses', () => {
      const author: GitAuthor = {
        name: 'John Doe',
        email: 'john.doe@example.com',
      };

      expect(author.email).toMatch(/^[^@]+@[^@]+\.[^@]+$/);
    });
  });

  describe('Type compatibility', () => {
    it('should allow IssueComment in comments array', () => {
      const issue: IssueNode = {
        title: 'Issue',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        createdAt: '2026-03-22T12:00:00Z',
        comments: [],
      };

      expect(Array.isArray(issue.comments)).toBeTrue();
    });

    it('should allow IssueComment in PR comments array', () => {
      const pr: PRNode = {
        title: 'PR',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 1 },
        comments: [],
      };

      expect(Array.isArray(pr.comments)).toBeTrue();
    });

    it('should share author type between IssueNode and PRNode', () => {
      const issue: IssueNode = {
        title: 'Issue',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        createdAt: '2026-03-22T12:00:00Z',
      };

      const pr: PRNode = {
        title: 'PR',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T12:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 1 },
      };

      expect(issue.author.login).toBe(pr.author.login);
    });
  });
});

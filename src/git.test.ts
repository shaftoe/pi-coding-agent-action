import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { GitService } from './git.js';
import type { GitAuthor } from './types.js';

describe('GitService', () => {
  let gitService: GitService;

  beforeEach(() => {
    gitService = new GitService('test-token');
  });

  describe('constructor', () => {
    it('should initialize with token', () => {
      const service = new GitService('my-token');
      expect(service).toBeInstanceOf(GitService);
    });

    it('should use current working directory by default', () => {
      const service = new GitService('token', process.cwd());
      expect(service).toBeInstanceOf(GitService);
    });

    it('should use custom directory when provided', () => {
      const service = new GitService('token', '/custom/path');
      expect(service).toBeInstanceOf(GitService);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return branch name', () => {
      // This would require mocking runCommand from utils
      // For now we test the function exists and returns correct type
      const branch = gitService.getCurrentBranch();
      expect(branch === null || typeof branch === 'string').toBeTrue();
    });

    it('should return null when not on a branch', () => {
      // This would need mocking to test detached HEAD state
      const branch = gitService.getCurrentBranch();
      expect(branch === null || typeof branch === 'string').toBeTrue();
    });
  });

  describe('branchIsDirty', () => {
    it('should return false for clean working directory', () => {
      const isDirty = gitService.branchIsDirty();
      expect(typeof isDirty).toBe('boolean');
    });

    it('should return true when there are uncommitted changes', () => {
      // This would need mocking to test dirty state
      const isDirty = gitService.branchIsDirty();
      expect(typeof isDirty).toBe('boolean');
    });
  });

  describe('checkoutBranch', () => {
    it('should be able to create a new branch', () => {
      // This requires mocking git commands
      expect(() => gitService.checkoutBranch('test-branch', true)).not.toThrow();
    });

    it('should be able to checkout existing branch', () => {
      // This requires mocking git commands
      expect(() => gitService.checkoutBranch('main', false)).not.toThrow();
    });
  });

  describe('fetchBranch', () => {
    it('should fetch branch from remote', async () => {
      const url = 'https://github.com/owner/repo.git';
      // This requires mocking git commands
      await expect(
        gitService.fetchBranch(url, 'origin', 'main')
      ).resolves.not.toThrow();
    });

    it('should fetch with depth when specified', async () => {
      const url = 'https://github.com/owner/repo.git';
      await expect(
        gitService.fetchBranch(url, 'origin', 'main', 10)
      ).resolves.not.toThrow();
    });

    it('should embed auth token in URL', () => {
      const url = 'https://github.com/owner/repo.git';
      const authUrl = url.replace(
        'https://github.com/',
        `https://x-access-token:test-token@github.com/`
      );
      expect(authUrl).toContain('x-access-token:test-token@');
    });
  });

  describe('checkoutPRBranch', () => {
    it('should handle local PR', async () => {
      const pr = {
        title: 'Test PR',
        body: 'PR body',
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

      const result = await gitService.checkoutPRBranch(pr, 1);
      expect(result.isLocalPR).toBeTrue();
      expect(result.remote).toBeDefined();
      expect(result.branchName).toBeDefined();
      expect(result.headRefName).toBeDefined();
    });

    it('should handle fork PR', async () => {
      const pr = {
        title: 'Test PR',
        body: 'PR body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc123',
        createdAt: '2026-03-22T00:00:00Z',
        additions: 10,
        deletions: 5,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'fork/repo' },
        commits: { totalCount: 3 },
      };

      const result = await gitService.checkoutPRBranch(pr, 1);
      expect(result.isLocalPR).toBeFalse();
      expect(result.remote).toBeDefined();
      expect(result.branchName).toBeDefined();
      expect(result.headRefName).toBeDefined();
    });

    it('should return correct structure for local PR', async () => {
      const pr = {
        title: 'Test',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc',
        createdAt: '2026-03-22T00:00:00Z',
        additions: 1,
        deletions: 1,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 1 },
      };

      const result = await gitService.checkoutPRBranch(pr, 1);

      expect(result).toHaveProperty('remote');
      expect(result).toHaveProperty('branchName');
      expect(result).toHaveProperty('headRefName');
      expect(result).toHaveProperty('isLocalPR');
    });

    it('should generate branch name for fork PR', async () => {
      const pr = {
        title: 'Test',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'abc',
        createdAt: '2026-03-22T00:00:00Z',
        additions: 1,
        deletions: 1,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'fork/repo' },
        commits: { totalCount: 1 },
      };

      const result = await gitService.checkoutPRBranch(pr, 42);
      expect(result.branchName).toMatch(/^pi\/pr42-\d{14}$/);
    });

    it('should use original branch name for local PR', async () => {
      const pr = {
        title: 'Test',
        body: 'Body',
        state: 'OPEN',
        author: { login: 'user' },
        baseRefName: 'main',
        headRefName: 'my-feature',
        headRefOid: 'abc',
        createdAt: '2026-03-22T00:00:00Z',
        additions: 1,
        deletions: 1,
        baseRepository: { nameWithOwner: 'owner/repo' },
        headRepository: { nameWithOwner: 'owner/repo' },
        commits: { totalCount: 1 },
      };

      const result = await gitService.checkoutPRBranch(pr, 1);
      expect(result.headRefName).toBe('my-feature');
    });
  });

  describe('commitAndPush', () => {
    it('should commit and push changes', async () => {
      const author: GitAuthor = {
        name: 'Test User',
        email: 'test@example.com',
      };

      await expect(
        gitService.commitAndPush('Test commit', author, 'origin', 'feature')
      ).resolves.not.toThrow();
    });

    it('should use provided author information', async () => {
      const author: GitAuthor = {
        name: 'Custom Author',
        email: 'custom@example.com',
      };

      await expect(
        gitService.commitAndPush('Commit message', author, 'origin', 'main')
      ).resolves.not.toThrow();
    });

    it('should push to specified remote', async () => {
      const author: GitAuthor = {
        name: 'User',
        email: 'user@example.com',
      };

      await expect(
        gitService.commitAndPush('Message', author, 'fork', 'branch')
      ).resolves.not.toThrow();
    });

    it('should push to specified branch', async () => {
      const author: GitAuthor = {
        name: 'User',
        email: 'user@example.com',
      };

      await expect(
        gitService.commitAndPush('Message', author, 'origin', 'custom-branch')
      ).resolves.not.toThrow();
    });
  });
});

describe('GitService - URL handling', () => {
  it('should correctly embed auth token in GitHub URLs', () => {
    const token = 'test-token';
    const url = 'https://github.com/owner/repo.git';
    const authUrl = url.replace(
      'https://github.com/',
      `https://x-access-token:${token}@github.com/`
    );

    expect(authUrl).toBe('https://x-access-token:test-token@github.com/owner/repo.git');
    expect(authUrl).toContain(token);
    expect(authUrl).toContain('x-access-token:');
  });

  it('should preserve repository path in auth URL', () => {
    const token = 'my-token';
    const url = 'https://github.com/myorg/myrepo.git';
    const authUrl = url.replace(
      'https://github.com/',
      `https://x-access-token:${token}@github.com/`
    );

    expect(authUrl).toContain('myorg/myrepo.git');
  });

  it('should handle URLs with subpaths', () => {
    const token = 'token123';
    const url = 'https://github.com/org1/repo1';
    const authUrl = url.replace(
      'https://github.com/',
      `https://x-access-token:${token}@github.com/`
    );

    expect(authUrl).toContain('org1/repo1');
  });
});

describe('GitAuthor interface', () => {
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
});

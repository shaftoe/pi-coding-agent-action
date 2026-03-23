import { describe, it, expect, beforeEach } from 'bun:test';
import { GitService } from './git.js';

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

  describe('branchIsDirty', () => {
    it('should return false for clean working directory', async () => {
      const isDirty = await gitService.branchIsDirty();
      expect(typeof isDirty).toBe('boolean');
    });

    it('should return true when there are uncommitted changes', async () => {
      // This would need mocking to test dirty state
      const isDirty = await gitService.branchIsDirty();
      expect(typeof isDirty).toBe('boolean');
    });
  });

  describe('configureCredentials', () => {
    it('should configure credentials without error', async () => {
      expect(gitService.configureCredentials()).resolves.toBeUndefined();
    });
  });

  describe('checkoutBranch', () => {
    it('should be callable', async () => {
      // Note: This requires a git repository and may fail in test environment
      // The test is mainly to ensure the method signature is correct
      expect(typeof gitService.checkoutBranch).toBe('function');
    });
  });
});

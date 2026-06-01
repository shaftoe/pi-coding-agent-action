/**
 * Tests for RealGitAdapter.
 *
 * Tests that the production adapter correctly initializes with deps
 * and implements the GitAdapter interface.
 */

import { describe, expect, test } from 'bun:test';
import { RealGitAdapter } from '../../src/adapters/git-adapter';
import type { CoreAdapter } from '../../src/types';

function createMockCoreAdapter(overrides?: Partial<CoreAdapter>): CoreAdapter {
  return {
    getInput: () => '',
    setFailed: () => {},
    setOutput: () => {},
    notice: () => {},
    debug: () => {},
    info: () => {},
    warning: () => {},
    error: () => {},
    ...overrides,
  };
}

const mockOctokit = {
  rest: {},
};

const mockContext = {
  repo: { owner: 'test-owner', repo: 'test-repo' },
  issue: { number: 42 },
  eventName: 'issue_comment',
  payload: {},
  serverUrl: 'https://github.com',
  runId: 123456789,
  workspace: '/tmp/workspace',
};

describe('RealGitAdapter', () => {
  test('constructor accepts core adapter, octokit, and context', () => {
    const adapter = createMockCoreAdapter();
    expect(() => new RealGitAdapter(adapter, mockOctokit as any, mockContext)).not.toThrow();
  });

  test('implements GitAdapter interface - addReaction', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter(), mockOctokit as any, mockContext);
    expect(typeof gitAdapter.addReaction).toBe('function');
  });

  test('implements GitAdapter interface - deleteReaction', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter(), mockOctokit as any, mockContext);
    expect(typeof gitAdapter.deleteReaction).toBe('function');
  });

  test('implements GitAdapter interface - createFinalComment', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter(), mockOctokit as any, mockContext);
    expect(typeof gitAdapter.createFinalComment).toBe('function');
  });

  test('implements GitAdapter interface - getPrompt', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter(), mockOctokit as any, mockContext);
    expect(typeof gitAdapter.getPrompt).toBe('function');
  });

  test('implements GitAdapter interface - getStartTime', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter(), mockOctokit as any, mockContext);
    expect(typeof gitAdapter.getStartTime).toBe('function');
  });

  test('getStartTime returns undefined when no event timestamp is available', () => {
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter(), mockOctokit as any, mockContext);
    // In test environment with no real GitHub event context, getStartTime should return undefined
    const result = gitAdapter.getStartTime();
    expect(result).toBeUndefined();
  });
});

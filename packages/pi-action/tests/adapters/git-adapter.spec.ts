/**
 * Tests for RealGitAdapter.
 *
 * Tests that the production adapter correctly initializes with deps
 * and implements the GitAdapter interface.
 */

import { describe, expect, test } from 'bun:test';
import { RealGitAdapter } from '../../src/adapters/git-adapter';
import type { CoreAdapter } from '@alexanderfortin/pi-orchestrator';

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

  test('constructor accepts an optional platformType (forgejo)', () => {
    expect(
      () => new RealGitAdapter(createMockCoreAdapter(), mockOctokit as any, mockContext, 'forgejo')
    ).not.toThrow();
  });

  test('createFinalComment threads platformType into deps so the footer uses the Forgejo URL format', async () => {
    // Regression guard for the bug where RealGitAdapter dropped platformType,
    // causing buildActionRunUrl to emit the bare GitHub URL even on Forgejo.
    const created: { body: string }[] = [];
    const forgejoOctokit = {
      rest: {
        issues: {
          createComment: async (params: { body: string }) => {
            created.push({ body: params.body });
            return { data: {} };
          },
        },
      },
    };
    // Use a Forgejo-style serverUrl so the asserted URL is self-documenting
    // (a "forgejo" footer should not live under github.com).
    // runId (44) and runNumber (36) differ: Forgejo serves the run at the
    // per-repo run NUMBER, so the footer must use 36, not 44.
    const forgejoContext = {
      ...mockContext,
      serverUrl: 'https://codeberg.org',
      runId: 44,
      runNumber: 36,
    };
    const gitAdapter = new RealGitAdapter(
      createMockCoreAdapter(),
      forgejoOctokit as any,
      forgejoContext,
      'forgejo'
    );
    // Exercises the full RealGitAdapter → createFinalComment → buildActionRunUrl
    // path by capturing the body posted to octokit.rest.issues.createComment.
    await gitAdapter.createFinalComment('hello', {
      provider: 'p',
      model: 'm',
    });
    expect(created).toHaveLength(1);
    // Forgejo/Codeberg URLs use the per-repo runNumber, no job/attempt suffix.
    expect(created[0]!.body).toContain('https://codeberg.org/test-owner/test-repo/actions/runs/36');
    expect(created[0]!.body).not.toContain('/jobs/');
    expect(created[0]!.body).not.toContain('/runs/44');
  });

  test('createFinalComment omits platformType when not provided, yielding the GitHub URL format', async () => {
    const created: { body: string }[] = [];
    const ghOctokit = {
      rest: {
        issues: {
          createComment: async (params: { body: string }) => {
            created.push({ body: params.body });
            return { data: {} };
          },
        },
      },
    };
    const gitAdapter = new RealGitAdapter(createMockCoreAdapter(), ghOctokit as any, mockContext);
    await gitAdapter.createFinalComment('hello', {
      provider: 'p',
      model: 'm',
    });
    expect(created).toHaveLength(1);
    // GitHub URL has no job/attempt suffix.
    expect(created[0]!.body).toContain(
      'https://github.com/test-owner/test-repo/actions/runs/123456789'
    );
    expect(created[0]!.body).not.toContain('/jobs/0/attempt/');
  });
});

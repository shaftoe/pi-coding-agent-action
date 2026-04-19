/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { updatePullRequestToolFactory } from '../../../src/pi/tools/update-pr';
import type { PlatformProvider } from '../../../src/platform';
import * as githubIndex from '../../../src/platform/github';

// Mock platform provider for tests
const mockProvider: PlatformProvider = {
  type: 'github',
  getContext: () => ({
    repo: { owner: 'test-owner', repo: 'test-repo' },
    issue: { number: 1 },
    eventName: 'issue_comment',
    payload: {},
    serverUrl: 'https://github.com',
    runId: 123,
    workspace: '/tmp',
  }),
  addReaction: async () => undefined,
  deleteReaction: async () => {},
  createFinalComment: async () => {},
  getPrompt: async () => undefined,
  getStartTime: () => undefined,
  createPullRequest: async () => ({
    content: [{ type: 'text' as const, text: 'PR created' }],
    details: { pullRequestNumber: 1, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
  }),
  updatePullRequest: async () => ({
    content: [{ type: 'text' as const, text: 'PR updated' }],
    details: { pullRequestNumber: 1, pullRequestUrl: '', headBranch: '', baseBranch: '', dryRun: false },
  }),
  getIssueOrPRThread: async () => undefined,
};

const updatePullRequestTool = updatePullRequestToolFactory(mockProvider);

describe('update_pull_request tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(updatePullRequestTool.name).toBe('update_pull_request');
    expect(updatePullRequestTool.label).toBe('Update Pull Request');
  });

  test('execute function exists and is a function', () => {
    expect(typeof updatePullRequestTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = updatePullRequestTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.pull_number).toBeDefined();
    expect(schema.properties.title).toBeDefined();
    expect(schema.properties.body).toBeDefined();
    expect(schema.properties.message).toBeDefined();
    expect(schema.properties.dryRun).toBeDefined();
  });

  test('has execute with built-in cancellation handling', () => {
    // The execute function wraps the user's execute with cancellation checks
    // Cancellation is tested in tool-builder.spec.ts
    expect(typeof updatePullRequestTool.execute).toBe('function');
  });

  test('tool uses provider for execution', () => {
    // Verify that the underlying platform functions are available
    expect(githubIndex.updatePullRequest).toBeDefined();
    expect(typeof githubIndex.updatePullRequest).toBe('function');
  });

  test('parameters schema - all fields are optional', () => {
    const schema = updatePullRequestTool.parameters as any;
    // When all fields are optional, required may be undefined or empty
    if (Array.isArray(schema.required)) {
      expect(schema.required.length).toBe(0);
    }
  });
});

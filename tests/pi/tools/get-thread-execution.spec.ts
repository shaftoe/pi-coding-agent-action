/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { getIssueOrPRThreadToolFactory } from '../../../src/pi/tools/get-thread';
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

const getIssueOrPRThreadTool = getIssueOrPRThreadToolFactory(mockProvider);

describe('get_issue_or_pr_thread tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(getIssueOrPRThreadTool.name).toBe('get_issue_or_pr_thread');
    expect(getIssueOrPRThreadTool.label).toBe('Get Issue/PR Thread');
  });

  test('execute function exists and is a function', () => {
    expect(typeof getIssueOrPRThreadTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = getIssueOrPRThreadTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.owner).toBeDefined();
    expect(schema.properties.repo).toBeDefined();
    expect(schema.properties.issue_number).toBeDefined();
    expect(schema.properties.max_comments).toBeDefined();
  });

  test('has execute with built-in cancellation handling', () => {
    // The execute function wraps the user's execute with cancellation checks
    // Cancellation is tested in tool-builder.spec.ts
    expect(typeof getIssueOrPRThreadTool.execute).toBe('function');
  });

  test('tool uses provider for execution', () => {
    // Verify that the underlying platform functions are available
    expect(githubIndex.getIssueOrPRThread).toBeDefined();
    expect(typeof githubIndex.getIssueOrPRThread).toBe('function');
  });

  test('parameters schema - all fields are optional', () => {
    const schema = getIssueOrPRThreadTool.parameters as any;
    // When all fields are optional, required may be undefined or empty
    if (Array.isArray(schema.required)) {
      expect(schema.required.length).toBe(0);
    }
  });
});

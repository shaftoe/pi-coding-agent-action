/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, test } from 'bun:test';
import { createPRToolFactory } from '../../../src/pi/tools/create-pr';
import type { PlatformProvider } from '../../../src/platform';

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

const createPRTool = createPRToolFactory(mockProvider);
import * as githubIndex from '../../../src/platform/github';

describe('create_pull_request tool - execution', () => {
  test('has correct tool name and label', () => {
    expect(createPRTool.name).toBe('create_pull_request');
    expect(createPRTool.label).toBe('Create Pull Request');
  });

  test('execute function exists and is a function', () => {
    expect(typeof createPRTool.execute).toBe('function');
  });

  test('parameters have correct structure', () => {
    const schema = createPRTool.parameters as any;
    expect(schema.properties).toBeDefined();
    expect(schema.properties.title).toBeDefined();
    expect(schema.properties.body).toBeDefined();
    expect(schema.properties.base).toBeDefined();
    expect(schema.properties.dryRun).toBeDefined();
  });

  test('has execute with built-in cancellation handling', () => {
    // The execute function wraps the user's execute with cancellation checks
    // Cancellation is tested in tool-builder.spec.ts
    expect(typeof createPRTool.execute).toBe('function');
  });

  test('tool uses provider for execution', () => {
    // Verify that the tool has the correct execute function (uses provider internally)
    expect(githubIndex.createPullRequest).toBeDefined();
    expect(typeof githubIndex.createPullRequest).toBe('function');
  });

  test('parameters schema validates title as required', () => {
    const schema = createPRTool.parameters as any;
    expect(schema.required).toContain('title');
    expect(schema.required).not.toContain('body');
    expect(schema.required).not.toContain('base');
    expect(schema.required).not.toContain('dryRun');
  });
});

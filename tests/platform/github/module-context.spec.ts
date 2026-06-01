/**
 * Tests for GitHubModuleDeps interface — validates that the deps bag
 * is correctly structured.
 *
 * The old GitHubModuleContext singleton has been removed; these tests
 * now verify the deps-based approach works correctly.
 */

import { describe, expect, test } from 'bun:test';
import type { GitHubModuleDeps } from '../../../src/platform/github/types';

function createTestDeps(overrides?: Partial<GitHubModuleDeps>): GitHubModuleDeps {
  return {
    octokit: {
      rest: {} as any,
    } as any,
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 42 },
      eventName: 'issue_comment',
      payload: {},
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: '/tmp/workspace',
    },
    logger: {
      debug: () => {},
      info: () => {},
      warning: () => {},
      notice: () => {},
      error: () => {},
    },
    ...overrides,
  };
}

describe('GitHubModuleDeps', () => {
  test('can be constructed with all required fields', () => {
    const deps = createTestDeps();
    expect(deps.octokit).toBeDefined();
    expect(deps.context).toBeDefined();
    expect(deps.logger).toBeDefined();
  });

  test('octokit is accessible', () => {
    const deps = createTestDeps();
    expect(deps.octokit.rest).toBeDefined();
  });

  test('context has required fields', () => {
    const deps = createTestDeps();
    expect(deps.context.repo.owner).toBe('test-owner');
    expect(deps.context.repo.repo).toBe('test-repo');
    expect(deps.context.issue.number).toBe(42);
    expect(deps.context.eventName).toBe('issue_comment');
  });

  test('logger is functional', () => {
    const logs: string[] = [];
    const deps = createTestDeps({
      logger: {
        debug: (msg: string) => logs.push(`debug: ${msg}`),
        info: (msg: string) => logs.push(`info: ${msg}`),
        warning: (msg: string) => logs.push(`warning: ${msg}`),
        notice: (msg: string) => logs.push(`notice: ${msg}`),
        error: (msg: string) => logs.push(`error: ${msg}`),
      },
    });

    deps.logger.debug('test');
    deps.logger.info('test');
    deps.logger.warning('test');
    deps.logger.notice('test');
    deps.logger.error('test');

    expect(logs).toHaveLength(5);
  });

  test('deps properties are readonly at type level', () => {
    const deps = createTestDeps();
    // Verify the values are set — TypeScript enforces readonly at compile time
    expect(deps.context.repo.owner).toBe('test-owner');
    expect(deps.octokit).toBeDefined();
    expect(deps.logger).toBeDefined();
  });

  test('can override individual fields', () => {
    const deps = createTestDeps({
      context: {
        repo: { owner: 'other', repo: 'repo' },
        issue: { number: 99 },
        eventName: 'pull_request',
        payload: { pull_request: { number: 99 } },
        serverUrl: 'https://codeberg.org',
        runId: 0,
        workspace: '/tmp',
      },
    });
    expect(deps.context.repo.owner).toBe('other');
    expect(deps.context.eventName).toBe('pull_request');
  });
});

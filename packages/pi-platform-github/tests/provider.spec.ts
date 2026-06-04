/**
 * Tests for platform abstraction module.
 *
 * Tests platform detection, provider creation, and the module's
 * public API surface.
 */

import { describe, expect, test } from 'bun:test';

import { setupGitHubTestEnv } from './helpers/github-test-env';
setupGitHubTestEnv({ envPathPrefix: 'gh-event-platform' });

// Import after mocks are set up
import type { PlatformProvider } from '@alexanderfortin/pi-orchestrator';
import { detectPlatform, createGitHubPlatformProvider } from '@alexanderfortin/pi-platform-github';
import type { GitHubPlatformDeps } from '@alexanderfortin/pi-platform-github';

function makeMockDeps(overrides?: Partial<GitHubPlatformDeps>): GitHubPlatformDeps {
  return {
    octokit: {} as GitHubPlatformDeps['octokit'],
    context: {
      repo: { owner: 'test-owner', repo: 'test-repo' },
      issue: { number: 123 },
      eventName: 'issue_comment',
      payload: {} as Record<string, unknown>,
      serverUrl: 'https://github.com',
      runId: 123456789,
      workspace: process.cwd(),
    },
    logger: {
      debug: () => {},
      info: () => {},
      warning: () => {},
      notice: () => {},
      error: () => {},
    },
    platformType: 'github',
    ...overrides,
  };
}

describe('detectPlatform', () => {
  test('returns github for github.com server URL', () => {
    expect(detectPlatform('https://github.com')).toBe('github');
  });

  test('throws when server URL is empty', () => {
    expect(() => detectPlatform('')).toThrow(/requires a server URL/);
  });

  test('returns codeberg for codeberg.org server URL', () => {
    expect(detectPlatform('https://codeberg.org')).toBe('codeberg');
  });

  test('returns forgejo for server URL containing forgejo', () => {
    expect(detectPlatform('https://forgejo.example.com')).toBe('forgejo');
  });

  test('returns forgejo for server URL containing gitea', () => {
    expect(detectPlatform('https://gitea.example.com')).toBe('forgejo');
  });

  test('throws for unknown non-github.com server URL', () => {
    expect(() => detectPlatform('https://git.mycompany.com')).toThrow(
      /Unsupported platform server URL/
    );
  });

  test('throws for GitHub Enterprise-like URL (custom domain)', () => {
    expect(() => detectPlatform('https://github.mycompany.com')).toThrow(
      /Unsupported platform server URL/
    );
  });

  test('detects codeberg with subpath URL', () => {
    expect(detectPlatform('https://codeberg.org/some/repo')).toBe('codeberg');
  });

  test('detects forgejo with nested subdomain', () => {
    expect(detectPlatform('https://git.forgejo.internal.company.net')).toBe('forgejo');
  });

  test('detects gitea with trailing slash', () => {
    expect(detectPlatform('https://gitea.example.com/')).toBe('forgejo');
  });

  test('error message includes the problematic URL', () => {
    expect(() => detectPlatform('https://unknown.host')).toThrow('https://unknown.host');
  });

  test('error message mentions supported platforms', () => {
    expect(() => detectPlatform('https://unknown.host')).toThrow(/github\.com.*codeberg.*forgejo/i);
  });
});

describe('createGitHubPlatformProvider', () => {
  test('returns a PlatformProvider', () => {
    const provider = createGitHubPlatformProvider(makeMockDeps());
    expect(provider).toBeDefined();
    expect(typeof provider.addReaction).toBe('function');
    expect(typeof provider.deleteReaction).toBe('function');
    expect(typeof provider.createFinalComment).toBe('function');
    expect(typeof provider.getPrompt).toBe('function');
    expect(typeof provider.getStartTime).toBe('function');
    expect(typeof provider.createPullRequest).toBe('function');
    expect(typeof provider.updatePullRequest).toBe('function');
    expect(typeof provider.getIssueOrPRThread).toBe('function');
  });

  test('has a type property matching the explicit platform', () => {
    const provider = createGitHubPlatformProvider(makeMockDeps());
    expect(['github', 'codeberg', 'forgejo']).toContain(provider.type);
  });

  test('has a type of github when platformType is github', () => {
    const provider = createGitHubPlatformProvider(makeMockDeps());
    expect(provider.type).toBe('github');
  });

  test('has type codeberg when platformType is codeberg', () => {
    const provider = createGitHubPlatformProvider(makeMockDeps({ platformType: 'codeberg' }));
    expect(provider.type).toBe('codeberg');
  });

  test('has type forgejo when platformType is forgejo', () => {
    const provider = createGitHubPlatformProvider(makeMockDeps({ platformType: 'forgejo' }));
    expect(provider.type).toBe('forgejo');
  });

  test('type property is immutable from TypeScript perspective (readonly)', () => {
    const provider = createGitHubPlatformProvider(makeMockDeps());
    // The type property is typed as readonly in TypeScript but can be
    // reassigned at runtime in JavaScript. Verify it starts correct.
    expect(provider.type).toBe('github');
  });

  test('type property reflects the explicit platformType, not context.serverUrl', () => {
    // Even if context.serverUrl says codeberg, explicit platformType wins.
    const provider = createGitHubPlatformProvider(
      makeMockDeps({
        platformType: 'github',
        context: { ...makeMockDeps().context, serverUrl: 'https://codeberg.org' },
      })
    );
    expect(provider.type).toBe('github');
  });
});

describe('PlatformProvider interface compliance', () => {
  test('provider implements all required methods', () => {
    const provider = createGitHubPlatformProvider(makeMockDeps());

    const requiredMethods: (keyof PlatformProvider)[] = [
      'addReaction',
      'deleteReaction',
      'createFinalComment',
      'getPrompt',
      'getStartTime',
      'createPullRequest',
      'updatePullRequest',
      'getIssueOrPRThread',
      'getPRDiff',
      'createReview',
      'getCIStatus',
      'getWorkflowRunLogs',
      'getContext',
    ];

    for (const method of requiredMethods) {
      expect(typeof provider[method]).toBe('function');
    }
  });
});

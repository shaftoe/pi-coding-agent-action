/**
 * Tests for platform abstraction module.
 *
 * Tests platform input parsing, provider creation, and the module's
 * public API surface.
 */

import { describe, expect, test } from 'vitest';

import { setupGitHubTestEnv } from './helpers/github-test-env';
setupGitHubTestEnv({ envPathPrefix: 'gh-event-platform' });

// Import after vis are set up
import type { PlatformProvider } from '@alexanderfortin/pi-orchestrator';
import {
  parsePlatformType,
  apiBaseUrlFromServerUrl,
  createGitHubPlatformProvider,
} from '@alexanderfortin/pi-platform-github';
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

describe('parsePlatformType', () => {
  test('defaults to github for empty / undefined input', () => {
    expect(parsePlatformType('')).toBe('github');
    expect(parsePlatformType(undefined)).toBe('github');
    expect(parsePlatformType('   ')).toBe('github');
  });

  test('returns github for github', () => {
    expect(parsePlatformType('github')).toBe('github');
  });

  test('returns codeberg for codeberg', () => {
    expect(parsePlatformType('codeberg')).toBe('codeberg');
  });

  test('returns forgejo for forgejo', () => {
    expect(parsePlatformType('forgejo')).toBe('forgejo');
  });

  test('returns forgejo for gitea (API-compatible alias)', () => {
    expect(parsePlatformType('gitea')).toBe('forgejo');
  });

  test('is case-insensitive and trims whitespace', () => {
    expect(parsePlatformType('Forgejo')).toBe('forgejo');
    expect(parsePlatformType('  CODEBERG  ')).toBe('codeberg');
    expect(parsePlatformType('\tGiteA\n')).toBe('forgejo');
  });

  test('falls back to github for an unrecognized value', () => {
    expect(parsePlatformType('gitlab')).toBe('github');
    expect(parsePlatformType('bitbucket')).toBe('github');
    expect(parsePlatformType('nonsense')).toBe('github');
  });

  test('invokes onUnknown with the raw input for an unrecognized value', () => {
    const received: string[] = [];
    const result = parsePlatformType('gitlab', raw => received.push(raw));
    expect(result).toBe('github');
    expect(received).toEqual(['gitlab']);
  });

  test('does not invoke onUnknown for recognized values (including the empty default)', () => {
    const calls: string[] = [];
    for (const value of ['', undefined, 'github', 'forgejo', 'gitea', 'codeberg']) {
      parsePlatformType(value, raw => calls.push(raw));
    }
    expect(calls).toEqual([]);
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

describe('apiBaseUrlFromServerUrl', () => {
  test('returns undefined for exact github.com', () => {
    expect(apiBaseUrlFromServerUrl('https://github.com')).toBeUndefined();
  });

  test('returns undefined for github.com subdomains', () => {
    expect(apiBaseUrlFromServerUrl('https://api.github.com')).toBeUndefined();
    expect(apiBaseUrlFromServerUrl('https://gist.github.com')).toBeUndefined();
  });

  test('returns /api/v3 for self-hosted GHE hostnames like github.example.com', () => {
    // These hostnames don't contain '.github.' (no dot before 'github'),
    // so they fall through to the unrecognized-host default (/api/v3).
    // This is correct: GHES REST API is at {host}/api/v3.
    expect(apiBaseUrlFromServerUrl('https://github.example.com')).toBe(
      'https://github.example.com/api/v3'
    );
  });

  test('returns /api/v3 for corporate GHE hostnames like github.internal.corp', () => {
    expect(apiBaseUrlFromServerUrl('https://github.internal.corp')).toBe(
      'https://github.internal.corp/api/v3'
    );
  });

  test('returns /api/v3 for GHE hosts where github is a middle segment (github.company.internal)', () => {
    // Regression: the old `.github.` substring check matched any host with
    // `github` as an interior dotted segment, wrongly returning undefined
    // (github.com default) for self-hosted GHE hosts like
    // github.company.internal / github.mycompany.com. These must fall
    // through to the /api/v3 GHE default.
    expect(apiBaseUrlFromServerUrl('https://github.company.internal')).toBe(
      'https://github.company.internal/api/v3'
    );
    expect(apiBaseUrlFromServerUrl('https://github.mycompany.com')).toBe(
      'https://github.mycompany.com/api/v3'
    );
  });

  test('returns /api/v3 for unrecognized hosts (self-hosted GHE default)', () => {
    expect(apiBaseUrlFromServerUrl('https://git.company.internal')).toBe(
      'https://git.company.internal/api/v3'
    );
  });

  test('returns /api/v1 for codeberg.org', () => {
    expect(apiBaseUrlFromServerUrl('https://codeberg.org')).toBe('https://codeberg.org/api/v1');
  });

  test('returns /api/v1 for forgejo hosts', () => {
    expect(apiBaseUrlFromServerUrl('https://git.forgejo.example')).toBe(
      'https://git.forgejo.example/api/v1'
    );
  });

  test('returns /api/v1 for gitea hosts', () => {
    expect(apiBaseUrlFromServerUrl('https://git.gitea.internal')).toBe(
      'https://git.gitea.internal/api/v1'
    );
  });

  test('strips trailing slash from input', () => {
    expect(apiBaseUrlFromServerUrl('https://codeberg.org/')).toBe('https://codeberg.org/api/v1');
    expect(apiBaseUrlFromServerUrl('https://git.company.internal/')).toBe(
      'https://git.company.internal/api/v3'
    );
  });

  test('throws when server URL is empty', () => {
    expect(() => apiBaseUrlFromServerUrl('')).toThrow(
      /apiBaseUrlFromServerUrl requires a server URL/
    );
  });

  // --- platformType override --------------------------------------------

  test('platformType=forgejo forces /api/v1 regardless of hostname', () => {
    // forge.l3x.in has no forgejo/codeberg/gitea indicator in its hostname,
    // so hostname matching alone would return /api/v3 (wrong).
    expect(apiBaseUrlFromServerUrl('https://forge.l3x.in', 'forgejo')).toBe(
      'https://forge.l3x.in/api/v1'
    );
    expect(apiBaseUrlFromServerUrl('https://git.company.internal', 'forgejo')).toBe(
      'https://git.company.internal/api/v1'
    );
  });

  test('platformType=codeberg forces /api/v1 regardless of hostname', () => {
    expect(apiBaseUrlFromServerUrl('https://example.com', 'codeberg')).toBe(
      'https://example.com/api/v1'
    );
  });

  test('platformType=github uses hostname matching (backward compat)', () => {
    // Explicit github still uses the hostname-based logic below the override.
    expect(apiBaseUrlFromServerUrl('https://github.com', 'github')).toBeUndefined();
    expect(apiBaseUrlFromServerUrl('https://codeberg.org', 'github')).toBe(
      'https://codeberg.org/api/v1'
    );
    expect(apiBaseUrlFromServerUrl('https://github.company.internal', 'github')).toBe(
      'https://github.company.internal/api/v3'
    );
  });

  test('platformType undefined uses hostname matching (backward compat)', () => {
    expect(apiBaseUrlFromServerUrl('https://forge.l3x.in')).toBe('https://forge.l3x.in/api/v3');
    expect(apiBaseUrlFromServerUrl('https://forge.l3x.in', undefined)).toBe(
      'https://forge.l3x.in/api/v3'
    );
  });
});

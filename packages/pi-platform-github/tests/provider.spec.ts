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
import {
  detectPlatform,
  isKnownServerUrl,
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

  test('returns github for unknown non-github.com server URL (default fallback)', () => {
    // Self-hosted GHE and other GitHub-compatible hosts default to 'github'
    // instead of throwing. See detectPlatform docstring for rationale.
    expect(detectPlatform('https://git.mycompany.com')).toBe('github');
  });

  test('returns github for GitHub Enterprise-like URL with custom domain', () => {
    expect(detectPlatform('https://github.mycompany.com')).toBe('github');
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

  test('returns github for unknown host (default fallback)', () => {
    expect(detectPlatform('https://unknown.host')).toBe('github');
    expect(detectPlatform('https://another-unknown.host')).toBe('github');
  });
});

describe('isKnownServerUrl', () => {
  test('returns true for github.com', () => {
    expect(isKnownServerUrl('https://github.com')).toBe(true);
  });

  test('returns true for codeberg', () => {
    expect(isKnownServerUrl('https://codeberg.org')).toBe(true);
  });

  test('returns true for forgejo', () => {
    expect(isKnownServerUrl('https://forgejo.example.com')).toBe(true);
  });

  test('returns true for gitea', () => {
    expect(isKnownServerUrl('https://gitea.example.com')).toBe(true);
  });

  test('returns true for self-hosted GHE matching .github.', () => {
    expect(isKnownServerUrl('https://something.github.company')).toBe(true);
    expect(isKnownServerUrl('https://github.company.internal')).toBe(true);
  });

  test("returns false for hosts only matched by detectPlatform's silent fallback", () => {
    // detectPlatform returns 'github' for these via the unknown-host default,
    // but isKnownServerUrl surfaces them as unrecognized so the CLI can warn.
    expect(isKnownServerUrl('https://github.mycompany.com')).toBe(false);
    expect(isKnownServerUrl('https://gh.internal.corp')).toBe(false);
  });

  test('returns false for an unrecognized host (GitLab/Bitbucket case)', () => {
    expect(isKnownServerUrl('https://gitlab.com')).toBe(false);
    expect(isKnownServerUrl('https://bitbucket.org')).toBe(false);
    expect(isKnownServerUrl('https://git.mycompany.com')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isKnownServerUrl('')).toBe(false);
  });

  test('agrees with detectPlatform for hosts matched by explicit patterns', () => {
    // detectPlatform also returns 'github' for unrecognized hosts via its
    // silent fallback. isKnownServerUrl only returns true for hosts matched
    // by explicit patterns (the cases above). The list below must NOT
    // include fallback-only hosts like 'https://github.mycompany.com'.
    const explicitMatch = [
      'https://github.com',
      'https://codeberg.org',
      'https://forgejo.example.com',
      'https://gitea.example.com',
      'https://something.github.company', // matches '.github.' substring
    ];
    for (const url of explicitMatch) {
      expect(isKnownServerUrl(url)).toBe(true);
    }
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

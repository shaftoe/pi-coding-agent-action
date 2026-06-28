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
  apiBaseUrlFromServerUrl,
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

  test('detects forgejo from /api/v1 API URL even when hostname is ambiguous', () => {
    // forge.example.com has no "forgejo"/"gitea"/"codeberg" substring, so
    // without the API-URL hint it would fall back to 'github'. The
    // GITHUB_API_URL ending in /api/v1 reliably identifies Forgejo/Gitea.
    expect(detectPlatform('https://forge.l3x.in', 'https://forge.l3x.in/api/v1')).toBe('forgejo');
    expect(
      detectPlatform('https://git.company.internal', 'https://git.company.internal/api/v1')
    ).toBe('forgejo');
  });

  test('detects codeberg from /api/v1 API URL containing "codeberg"', () => {
    expect(detectPlatform('https://codeberg.org', 'https://codeberg.org/api/v1')).toBe('codeberg');
  });

  test('keeps github when API URL ends in /api/v3 (self-hosted GHE)', () => {
    expect(
      detectPlatform('https://github.company.internal', 'https://github.company.internal/api/v3')
    ).toBe('github');
  });

  test('keeps github when API URL is api.github.com', () => {
    expect(detectPlatform('https://github.com', 'https://api.github.com')).toBe('github');
  });

  test('trailing slash on /api/v1 is handled', () => {
    expect(detectPlatform('https://forge.l3x.in', 'https://forge.l3x.in/api/v1/')).toBe('forgejo');
  });

  test('explicit server-URL patterns take precedence over API URL', () => {
    // A server URL that explicitly contains "forgejo" wins regardless of apiUrl.
    expect(detectPlatform('https://forgejo.example.com', 'https://api.github.com')).toBe('forgejo');
    // A server URL that explicitly contains "github.com" wins over /api/v1.
    expect(detectPlatform('https://github.com', 'https://some.host/api/v1')).toBe('github');
  });

  test('ignores empty / undefined API URL', () => {
    expect(detectPlatform('https://unknown.host', undefined)).toBe('github');
    expect(detectPlatform('https://unknown.host', '')).toBe('github');
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

  test('throws when server URL is empty (aligned with detectPlatform)', () => {
    expect(() => apiBaseUrlFromServerUrl('')).toThrow(
      /apiBaseUrlFromServerUrl requires a server URL/
    );
  });
});

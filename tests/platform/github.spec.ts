/**
 * Tests for platform abstraction module.
 *
 * Tests platform detection, provider creation, and the module's
 * public API surface.
 */

import { describe, expect, test, afterEach } from 'bun:test';
import type { PlatformProvider } from '../../src/platform/types';
import { detectPlatform, createGitHubPlatformProvider } from '../../src/platform/github';

describe('detectPlatform', () => {
  const originalServerUrl = process.env.GITHUB_SERVER_URL;

  afterEach(() => {
    if (originalServerUrl !== undefined) {
      process.env.GITHUB_SERVER_URL = originalServerUrl;
    } else {
      delete process.env.GITHUB_SERVER_URL;
    }
  });

  test('returns github for github.com server URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    expect(detectPlatform()).toBe('github');
  });

  test('returns github when GITHUB_SERVER_URL is not set', () => {
    delete process.env.GITHUB_SERVER_URL;
    expect(detectPlatform()).toBe('github');
  });

  test('returns codeberg for codeberg.org server URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://codeberg.org';
    expect(detectPlatform()).toBe('codeberg');
  });

  test('returns forgejo for server URL containing forgejo', () => {
    process.env.GITHUB_SERVER_URL = 'https://forgejo.example.com';
    expect(detectPlatform()).toBe('forgejo');
  });

  test('returns forgejo for server URL containing gitea', () => {
    process.env.GITHUB_SERVER_URL = 'https://gitea.example.com';
    expect(detectPlatform()).toBe('forgejo');
  });

  test('returns forgejo for unknown non-github.com server URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://git.mycompany.com';
    expect(detectPlatform()).toBe('forgejo');
  });

  test('returns forgejo for GitHub Enterprise-like URL (custom domain)', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.mycompany.com';
    expect(detectPlatform()).toBe('forgejo');
  });
});

describe('createGitHubPlatformProvider', () => {
  test('returns a PlatformProvider', () => {
    const provider = createGitHubPlatformProvider();
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

  test('has a type property matching the detected platform', () => {
    const provider = createGitHubPlatformProvider();
    expect(['github', 'codeberg', 'forgejo']).toContain(provider.type);
  });

  test('has a type of github in default CI environment', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    const provider = createGitHubPlatformProvider();
    expect(provider.type).toBe('github');
  });
});

describe('PlatformProvider interface compliance', () => {
  test('provider implements all required methods', () => {
    const provider = createGitHubPlatformProvider();

    const requiredMethods: (keyof PlatformProvider)[] = [
      'addReaction',
      'deleteReaction',
      'createFinalComment',
      'getPrompt',
      'getStartTime',
      'createPullRequest',
      'updatePullRequest',
      'getIssueOrPRThread',
      'getContext',
    ];

    for (const method of requiredMethods) {
      expect(typeof provider[method]).toBe('function');
    }
  });
});

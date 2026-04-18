/**
 * Tests for platform detection module.
 */

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { detectPlatform } from '../../src/platform/detector';

describe('detectPlatform', () => {
  const originalServerUrl = process.env.GITHUB_SERVER_URL;
  const originalApiUrl = process.env.GITHUB_API_URL;

  beforeEach(() => {
    delete process.env.GITHUB_SERVER_URL;
    delete process.env.GITHUB_API_URL;
  });

  afterEach(() => {
    if (originalServerUrl !== undefined) {
      process.env.GITHUB_SERVER_URL = originalServerUrl;
    } else {
      delete process.env.GITHUB_SERVER_URL;
    }
    if (originalApiUrl !== undefined) {
      process.env.GITHUB_API_URL = originalApiUrl;
    } else {
      delete process.env.GITHUB_API_URL;
    }
  });

  describe('defaults', () => {
    test('defaults to github when no env vars set', () => {
      const platform = detectPlatform();
      expect(platform.type).toBe('github');
      expect(platform.serverUrl).toBe('https://github.com');
      expect(platform.apiBaseUrl).toBe('https://api.github.com');
    });
  });

  describe('GitHub detection', () => {
    test('detects github.com', () => {
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      const platform = detectPlatform();
      expect(platform.type).toBe('github');
      expect(platform.serverUrl).toBe('https://github.com');
    });

    test('uses GITHUB_API_URL when set for github', () => {
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_API_URL = 'https://custom-api.github.com';
      const platform = detectPlatform();
      expect(platform.apiBaseUrl).toBe('https://custom-api.github.com');
    });

    test('defaults api base url to api.github.com for github', () => {
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      const platform = detectPlatform();
      expect(platform.apiBaseUrl).toBe('https://api.github.com');
    });
  });

  describe('Codeberg detection', () => {
    test('detects codeberg.org', () => {
      process.env.GITHUB_SERVER_URL = 'https://codeberg.org';
      const platform = detectPlatform();
      expect(platform.type).toBe('codeberg');
      expect(platform.serverUrl).toBe('https://codeberg.org');
    });

    test('derives api base url for codeberg', () => {
      process.env.GITHUB_SERVER_URL = 'https://codeberg.org';
      const platform = detectPlatform();
      expect(platform.apiBaseUrl).toBe('https://codeberg.org/api/v1');
    });

    test('uses GITHUB_API_URL override for codeberg', () => {
      process.env.GITHUB_SERVER_URL = 'https://codeberg.org';
      process.env.GITHUB_API_URL = 'https://codeberg.org/api/v1/custom';
      const platform = detectPlatform();
      expect(platform.apiBaseUrl).toBe('https://codeberg.org/api/v1/custom');
    });
  });

  describe('Forgejo detection', () => {
    test('detects self-hosted forgejo by domain', () => {
      process.env.GITHUB_SERVER_URL = 'https://git.example.com';
      const platform = detectPlatform();
      expect(platform.type).toBe('forgejo');
      expect(platform.serverUrl).toBe('https://git.example.com');
    });

    test('derives api base url for forgejo', () => {
      process.env.GITHUB_SERVER_URL = 'https://git.mycompany.com';
      const platform = detectPlatform();
      expect(platform.apiBaseUrl).toBe('https://git.mycompany.com/api/v1');
    });

    test('detects forgejo on non-standard port', () => {
      process.env.GITHUB_SERVER_URL = 'https://git.example.com:3000';
      const platform = detectPlatform();
      expect(platform.type).toBe('forgejo');
      expect(platform.apiBaseUrl).toBe('https://git.example.com:3000/api/v1');
    });

    test('uses GITHUB_API_URL override for forgejo', () => {
      process.env.GITHUB_SERVER_URL = 'https://git.example.com';
      process.env.GITHUB_API_URL = 'https://git.example.com/api/v1';
      const platform = detectPlatform();
      expect(platform.apiBaseUrl).toBe('https://git.example.com/api/v1');
    });

    test('handles http scheme for self-hosted', () => {
      process.env.GITHUB_SERVER_URL = 'http://localhost:3000';
      const platform = detectPlatform();
      expect(platform.type).toBe('forgejo');
      expect(platform.serverUrl).toBe('http://localhost:3000');
      expect(platform.apiBaseUrl).toBe('http://localhost:3000/api/v1');
    });
  });
});

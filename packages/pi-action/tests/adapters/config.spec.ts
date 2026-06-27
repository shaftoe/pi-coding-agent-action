/**
 * Tests for gatherActionsConfig() — the GitHub Actions config adapter.
 *
 * Tests that the config gathering logic correctly parses @actions/core
 * inputs into a PiConfig object with proper defaults and validation.
 *
 * Mock strategy: we register the shared `coreMock` object via a DIRECT
 * `mock.module()` call (Bun hoists direct calls before import resolution).
 * Both this direct call and `registerCoreMock()` (used by other test files)
 * point to the **same** `coreMock` object, so regardless of which
 * registration Bun processes first, `@actions/core` always resolves to
 * `coreMock`. Per-test overrides are then applied via
 * `coreMock.getInput.mockImplementation(...)`.
 */

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { coreMock } from '../../../pi-orchestrator/tests/helpers/core-mock';

// Register the mock DIRECTLY (hoisted by Bun) pointing to the shared coreMock
// object — same object registerCoreMock() uses, so order doesn't matter.
mock.module('@actions/core', () => coreMock);

import { gatherActionsConfig } from '../../src/adapters/config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set per-test input overrides on top of required defaults.
 */
function mockCore(overrides: Record<string, string> = {}): void {
  const defaults: Record<string, string> = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    token: 'test-token',
    thinking_level: '',
    prompt: '',
    ...overrides,
  };
  coreMock.getInput.mockImplementation((name: string) => defaults[name] ?? '');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gatherActionsConfig', () => {
  beforeEach(() => {
    coreMock.getInput.mockClear();
    coreMock.debug.mockClear();
    coreMock.setSecret.mockClear();
    mockCore();
  });

  describe('required fields validation', () => {
    test('throws descriptive error when provider is missing', () => {
      mockCore({ provider: '' });
      expect(() => gatherActionsConfig()).toThrow('Missing required input: `provider`');
    });

    test('provider error mentions possible values', () => {
      mockCore({ provider: '' });
      expect(() => gatherActionsConfig()).toThrow(/anthropic/);
    });

    test('throws descriptive error when model is missing', () => {
      mockCore({ model: '' });
      expect(() => gatherActionsConfig()).toThrow('Missing required input: `model`');
    });

    test('allows empty token for provider-side auth', () => {
      mockCore({ provider: 'google-vertex', model: 'gemini-2.5-pro', token: '' });
      const config = gatherActionsConfig();
      expect(config.token).toBe('');
    });
  });

  describe('default values', () => {
    test('loadBuiltinExtensions defaults to true', () => {
      const config = gatherActionsConfig();
      expect(config.loadBuiltinExtensions).toBe(true);
    });

    test('exportSessionHtml defaults to true', () => {
      const config = gatherActionsConfig();
      expect(config.exportSessionHtml).toBe(true);
    });

    test('exportSessionJsonl defaults to false', () => {
      const config = gatherActionsConfig();
      expect(config.exportSessionJsonl).toBe(false);
    });

    test('autoCompaction defaults to false', () => {
      const config = gatherActionsConfig();
      expect(config.autoCompaction).toBe(false);
    });
  });

  describe('boolean input parsing', () => {
    test('parses load_builtin_extensions false', () => {
      mockCore({ load_builtin_extensions: 'false' });
      expect(gatherActionsConfig().loadBuiltinExtensions).toBe(false);
    });

    test('parses export_session_html false', () => {
      mockCore({ export_session_html: 'false' });
      expect(gatherActionsConfig().exportSessionHtml).toBe(false);
    });

    test('parses export_session_jsonl true', () => {
      mockCore({ export_session_jsonl: 'true' });
      expect(gatherActionsConfig().exportSessionJsonl).toBe(true);
    });

    test('parses auto_compaction true', () => {
      mockCore({ auto_compaction: 'true' });
      expect(gatherActionsConfig().autoCompaction).toBe(true);
    });
  });

  describe('extensions parsing', () => {
    test('parses newline-separated extensions', () => {
      mockCore({ extensions: 'npm:package-one\ngit:github.com/user/repo\n./local-path.ts' });
      const config = gatherActionsConfig();
      expect(config.extensions).toEqual([
        'npm:package-one',
        'git:github.com/user/repo',
        './local-path.ts',
      ]);
    });

    test('omits extensions when input is empty', () => {
      mockCore({ extensions: '' });
      const config = gatherActionsConfig();
      expect(config.extensions).toBeUndefined();
    });
  });

  describe('loaded_tools parsing', () => {
    test('parses newline-separated tool names (YAML list style)', () => {
      mockCore({
        loaded_tools: 'get_pr_diff\ncreate_pull_request\nget_issue_or_pr_thread',
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toEqual([
        'get_pr_diff',
        'create_pull_request',
        'get_issue_or_pr_thread',
      ]);
    });

    test('returns undefined for "all"', () => {
      mockCore({ loaded_tools: 'all' });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toBeUndefined();
    });

    test('returns undefined for empty input', () => {
      mockCore({ loaded_tools: '' });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toBeUndefined();
    });

    test('deduplicates tool names', () => {
      mockCore({ loaded_tools: 'read\nread\nwrite' });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toEqual(['read', 'write']);
    });
  });

  describe('diff configuration', () => {
    test('parses diff_max_lines', () => {
      mockCore({ diff_max_lines: '500' });
      expect(gatherActionsConfig().diffMaxLines).toBe(500);
    });

    test('parses diff_max_bytes', () => {
      mockCore({ diff_max_bytes: '204800' });
      expect(gatherActionsConfig().diffMaxBytes).toBe(204800);
    });

    test('parses diff_ignore_patterns', () => {
      mockCore({ diff_ignore_patterns: 'dist/ package-lock.json' });
      expect(gatherActionsConfig().diffIgnorePatterns).toEqual(['dist/', 'package-lock.json']);
    });

    test('ignores non-numeric diff_max_lines', () => {
      mockCore({ diff_max_lines: 'not-a-number' });
      expect(gatherActionsConfig().diffMaxLines).toBeUndefined();
    });

    test('ignores negative diff_max_lines', () => {
      mockCore({ diff_max_lines: '-1' });
      expect(gatherActionsConfig().diffMaxLines).toBeUndefined();
    });

    test('ignores zero diff_max_lines', () => {
      mockCore({ diff_max_lines: '0' });
      expect(gatherActionsConfig().diffMaxLines).toBeUndefined();
    });
  });

  describe('base_url', () => {
    test('parses base_url when provided', () => {
      mockCore({ base_url: 'https://my-proxy.example.com/v1' });
      expect(gatherActionsConfig().baseUrl).toBe('https://my-proxy.example.com/v1');
    });

    test('omits base_url when empty', () => {
      mockCore({ base_url: '' });
      expect(gatherActionsConfig().baseUrl).toBeUndefined();
    });
  });

  describe('session sharing inputs', () => {
    test('share_session defaults to false', () => {
      expect(gatherActionsConfig().shareSession).toBe(false);
    });

    test('parses share_session true', () => {
      mockCore({ share_session: 'true' });
      expect(gatherActionsConfig().shareSession).toBe(true);
    });

    test('omits githubToken when empty', () => {
      expect(gatherActionsConfig().githubToken).toBeUndefined();
    });

    test('parses github_token when provided', () => {
      mockCore({ github_token: 'ghp_secret' });
      expect(gatherActionsConfig().githubToken).toBe('ghp_secret');
    });

    test('does not auto-enable exportSessionHtml at config time (orchestrator responsibility)', () => {
      mockCore({ share_session: 'true', export_session_html: 'false' });
      const config = gatherActionsConfig();
      // Config adapter parses inputs verbatim; the orchestrator derives the
      // effective HTML-export flag (exportSessionHtml || shareSession).
      expect(config.shareSession).toBe(true);
      expect(config.exportSessionHtml).toBe(false);
    });

    test('registers github_token as a secret for log masking', () => {
      mockCore({ github_token: 'ghp_secret' });
      gatherActionsConfig();
      expect(coreMock.setSecret).toHaveBeenCalledWith('ghp_secret');
    });

    test('does not call setSecret when github_token is empty', () => {
      mockCore({ github_token: '' });
      gatherActionsConfig();
      expect(coreMock.setSecret).not.toHaveBeenCalled();
    });

    test('share_gist_provider defaults to undefined (github)', () => {
      expect(gatherActionsConfig().shareGistProvider).toBeUndefined();
    });

    test('parses share_gist_provider opengist (case-insensitive)', () => {
      mockCore({ share_gist_provider: 'Opengist' });
      expect(gatherActionsConfig().shareGistProvider).toBe('opengist');
    });

    test('normalizes an unknown share_gist_provider to undefined', () => {
      mockCore({ share_gist_provider: 'dropbox' });
      expect(gatherActionsConfig().shareGistProvider).toBeUndefined();
    });

    test('parses share_gist_api_url', () => {
      mockCore({ share_gist_api_url: 'https://gist.l3x.in/api/gists' });
      expect(gatherActionsConfig().shareGistApiUrl).toBe('https://gist.l3x.in/api/gists');
    });

    test('omits share_gist_api_url when empty', () => {
      mockCore({ share_gist_api_url: '   ' });
      expect(gatherActionsConfig().shareGistApiUrl).toBeUndefined();
    });

    test('parses share_gist_token and registers it as a secret', () => {
      mockCore({ share_gist_token: 'og_secret' });
      const config = gatherActionsConfig();
      expect(config.shareGistToken).toBe('og_secret');
      expect(coreMock.setSecret).toHaveBeenCalledWith('og_secret');
    });
  });
});

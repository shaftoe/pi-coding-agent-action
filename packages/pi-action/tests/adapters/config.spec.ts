/**
 * Tests for gatherActionsConfig() — the GitHub Actions config adapter.
 *
 * Tests that the config gathering logic correctly parses @actions/core
 * inputs into a PiConfig object with proper defaults and validation.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { coreMock, registerCoreMock } from '../../../pi-orchestrator/tests/helpers/core-mock';

registerCoreMock();

import { gatherActionsConfig } from '../../src/adapters/config';

describe('gatherActionsConfig', () => {
  beforeEach(() => {
    coreMock.getInput.mockClear();
    coreMock.debug.mockClear();
    coreMock.getInput.mockImplementation((name: string) => {
      const defaults: Record<string, string> = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        token: 'test-token',
        thinking_level: '',
        prompt: '',
      };
      return defaults[name] ?? '';
    });
  });

  describe('required fields validation', () => {
    test('throws descriptive error when provider is missing', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'provider') {
          return '';
        }
        return 'value';
      });
      expect(() => gatherActionsConfig()).toThrow('Missing required input: `provider`');
    });

    test('provider error mentions possible values', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'provider') {
          return '';
        }
        return 'value';
      });
      expect(() => gatherActionsConfig()).toThrow(/anthropic/);
    });

    test('throws descriptive error when model is missing', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'model') {
          return '';
        }
        return 'value';
      });
      expect(() => gatherActionsConfig()).toThrow('Missing required input: `model`');
    });

    test('allows empty token for provider-side auth', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'token') {
          return '';
        }
        if (name === 'provider') {
          return 'google-vertex';
        }
        if (name === 'model') {
          return 'gemini-2.5-pro';
        }
        return '';
      });
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
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'load_builtin_extensions') {
          return 'false';
        }
        return 'value';
      });
      expect(gatherActionsConfig().loadBuiltinExtensions).toBe(false);
    });

    test('parses export_session_html false', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'export_session_html') {
          return 'false';
        }
        return 'value';
      });
      expect(gatherActionsConfig().exportSessionHtml).toBe(false);
    });

    test('parses export_session_jsonl true', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'export_session_jsonl') {
          return 'true';
        }
        return 'value';
      });
      expect(gatherActionsConfig().exportSessionJsonl).toBe(true);
    });

    test('parses auto_compaction true', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'auto_compaction') {
          return 'true';
        }
        return 'value';
      });
      expect(gatherActionsConfig().autoCompaction).toBe(true);
    });
  });

  describe('extensions parsing', () => {
    test('parses newline-separated extensions', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'extensions') {
          return 'npm:package-one\ngit:github.com/user/repo\n./local-path.ts';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.extensions).toEqual([
        'npm:package-one',
        'git:github.com/user/repo',
        './local-path.ts',
      ]);
    });

    test('omits extensions when input is empty', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'extensions') {
          return '';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.extensions).toBeUndefined();
    });
  });

  describe('loaded_tools parsing', () => {
    test('parses newline-separated tool names (YAML list style)', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'loaded_tools') {
          return 'get_pr_diff\ncreate_pull_request\nget_issue_or_pr_thread';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toEqual([
        'get_pr_diff',
        'create_pull_request',
        'get_issue_or_pr_thread',
      ]);
    });

    test('returns undefined for "all"', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'loaded_tools') {
          return 'all';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toBeUndefined();
    });

    test('returns undefined for empty input', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'loaded_tools') {
          return '';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toBeUndefined();
    });

    test('deduplicates tool names', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'loaded_tools') {
          return 'read\nread\nwrite';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toEqual(['read', 'write']);
    });
  });

  describe('diff configuration', () => {
    test('parses diff_max_lines', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'diff_max_lines') {
          return '500';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxLines).toBe(500);
    });

    test('parses diff_max_bytes', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'diff_max_bytes') {
          return '204800';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxBytes).toBe(204800);
    });

    test('parses diff_ignore_patterns', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'diff_ignore_patterns') {
          return 'dist/ package-lock.json';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffIgnorePatterns).toEqual(['dist/', 'package-lock.json']);
    });

    test('ignores non-numeric diff_max_lines', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'diff_max_lines') {
          return 'not-a-number';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxLines).toBeUndefined();
    });

    test('ignores negative diff_max_lines', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'diff_max_lines') {
          return '-1';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxLines).toBeUndefined();
    });

    test('ignores zero diff_max_lines', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'diff_max_lines') {
          return '0';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxLines).toBeUndefined();
    });
  });

  describe('base_url', () => {
    test('parses base_url when provided', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'base_url') {
          return 'https://my-proxy.example.com/v1';
        }
        return 'value';
      });
      expect(gatherActionsConfig().baseUrl).toBe('https://my-proxy.example.com/v1');
    });

    test('omits base_url when empty', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'base_url') {
          return '';
        }
        return 'value';
      });
      expect(gatherActionsConfig().baseUrl).toBeUndefined();
    });
  });

  describe('session sharing inputs', () => {
    test('share_session defaults to false', () => {
      expect(gatherActionsConfig().shareSession).toBe(false);
    });

    test('parses share_session true', () => {
      coreMock.getInput.mockImplementation((name: string) =>
        name === 'share_session' ? 'true' : ''
      );
      expect(gatherActionsConfig().shareSession).toBe(true);
    });

    test('omits githubToken when empty', () => {
      expect(gatherActionsConfig().githubToken).toBeUndefined();
    });

    test('parses github_token when provided', () => {
      coreMock.getInput.mockImplementation((name: string) =>
        name === 'github_token' ? 'ghp_secret' : ''
      );
      expect(gatherActionsConfig().githubToken).toBe('ghp_secret');
    });

    test('omits shareViewerUrl when empty (defaults applied by orchestrator)', () => {
      expect(gatherActionsConfig().shareViewerUrl).toBeUndefined();
    });

    test('parses share_viewer_url when provided', () => {
      coreMock.getInput.mockImplementation((name: string) =>
        name === 'share_viewer_url' ? 'https://example.com/v/' : ''
      );
      expect(gatherActionsConfig().shareViewerUrl).toBe('https://example.com/v/');
    });

    test('does not auto-enable exportSessionHtml at config time (orchestrator responsibility)', () => {
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'share_session') {
          return 'true';
        }
        if (name === 'export_session_html') {
          return 'false';
        }
        return '';
      });
      const config = gatherActionsConfig();
      // Config adapter parses inputs verbatim; the orchestrator derives the
      // effective HTML-export flag (exportSessionHtml || shareSession).
      expect(config.shareSession).toBe(true);
      expect(config.exportSessionHtml).toBe(false);
    });
  });
});

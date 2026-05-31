/**
 * Tests for gatherActionsConfig() — the GitHub Actions config adapter.
 *
 * Tests that the config gathering logic correctly parses @actions/core
 * inputs into a PiConfig object with proper defaults and validation.
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Mock @actions/core
const mockGetInput = mock((name: string) => {
  const defaults: Record<string, string> = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    token: 'test-token',
    thinking_level: '',
    prompt: '',
  };
  return defaults[name] ?? '';
});

const coreMock = { getInput: mockGetInput, debug: mock() };

mock.module('@actions/core', () => coreMock);

import { gatherActionsConfig } from '../../src/adapters/config';

describe('gatherActionsConfig', () => {
  beforeEach(() => {
    mockGetInput.mockImplementation((name: string) => {
      const defaults: Record<string, string> = {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        token: 'test-token',
        thinking_level: '',
        prompt: '',
      };
      if (name === 'provider') {
        return defaults[name] ?? '';
      }
      if (name === 'model') {
        return defaults[name] ?? '';
      }
      if (name === 'token') {
        return defaults[name] ?? '';
      }
      if (name === 'thinking_level') {
        return defaults[name] ?? '';
      }
      return defaults[name] ?? '';
    });
  });

  describe('required fields validation', () => {
    test('throws descriptive error when provider is missing', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'provider') {
          return '';
        }
        return 'value';
      });
      expect(() => gatherActionsConfig()).toThrow('Missing required input: `provider`');
    });

    test('provider error mentions possible values', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'provider') {
          return '';
        }
        return 'value';
      });
      expect(() => gatherActionsConfig()).toThrow(/anthropic/);
    });

    test('throws descriptive error when model is missing', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'model') {
          return '';
        }
        return 'value';
      });
      expect(() => gatherActionsConfig()).toThrow('Missing required input: `model`');
    });

    test('allows empty token for provider-side auth', () => {
      mockGetInput.mockImplementation((name: string) => {
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
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'load_builtin_extensions') {
          return 'false';
        }
        return 'value';
      });
      expect(gatherActionsConfig().loadBuiltinExtensions).toBe(false);
    });

    test('parses export_session_html false', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'export_session_html') {
          return 'false';
        }
        return 'value';
      });
      expect(gatherActionsConfig().exportSessionHtml).toBe(false);
    });

    test('parses export_session_jsonl true', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'export_session_jsonl') {
          return 'true';
        }
        return 'value';
      });
      expect(gatherActionsConfig().exportSessionJsonl).toBe(true);
    });

    test('parses auto_compaction true', () => {
      mockGetInput.mockImplementation((name: string) => {
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
      mockGetInput.mockImplementation((name: string) => {
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
      mockGetInput.mockImplementation((name: string) => {
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
    test('parses comma-separated tool names', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'loaded_tools') {
          return 'get_pr_diff,create_pull_request';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toEqual(['get_pr_diff', 'create_pull_request']);
    });

    test('returns undefined for "all"', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'loaded_tools') {
          return 'all';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toBeUndefined();
    });

    test('returns undefined for empty input', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'loaded_tools') {
          return '';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toBeUndefined();
    });

    test('deduplicates tool names', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'loaded_tools') {
          return 'read,read,write';
        }
        return 'value';
      });
      const config = gatherActionsConfig();
      expect(config.loadedTools).toEqual(['read', 'write']);
    });
  });

  describe('diff configuration', () => {
    test('parses diff_max_lines', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'diff_max_lines') {
          return '500';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxLines).toBe(500);
    });

    test('parses diff_max_bytes', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'diff_max_bytes') {
          return '204800';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxBytes).toBe(204800);
    });

    test('parses diff_ignore_patterns', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'diff_ignore_patterns') {
          return 'dist/ package-lock.json';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffIgnorePatterns).toEqual(['dist/', 'package-lock.json']);
    });

    test('ignores non-numeric diff_max_lines', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'diff_max_lines') {
          return 'not-a-number';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxLines).toBeUndefined();
    });

    test('ignores negative diff_max_lines', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'diff_max_lines') {
          return '-1';
        }
        return 'value';
      });
      expect(gatherActionsConfig().diffMaxLines).toBeUndefined();
    });

    test('ignores zero diff_max_lines', () => {
      mockGetInput.mockImplementation((name: string) => {
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
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'base_url') {
          return 'https://my-proxy.example.com/v1';
        }
        return 'value';
      });
      expect(gatherActionsConfig().baseUrl).toBe('https://my-proxy.example.com/v1');
    });

    test('omits base_url when empty', () => {
      mockGetInput.mockImplementation((name: string) => {
        if (name === 'base_url') {
          return '';
        }
        return 'value';
      });
      expect(gatherActionsConfig().baseUrl).toBeUndefined();
    });
  });
});

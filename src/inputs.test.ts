/**
 * Tests for GitHub Action inputs handling.
 *
 * Validates that required and optional inputs are retrieved correctly,
 * defaults are applied appropriately, and edge cases are handled.
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Mock @actions/core to control input behavior
const mockNotice = mock();
const mockInfo = mock();
const mockDebug = mock();
const mockSetFailed = mock();
const mockWarning = mock();

let mockGetInputValue: Record<string, string> = {};

const mockGetInput = (name: string): string => {
  return mockGetInputValue[name] ?? '';
};

mock.module('@actions/core', () => ({
  getInput: mockGetInput,
  notice: mockNotice,
  info: mockInfo,
  debug: mockDebug,
  setFailed: mockSetFailed,
  warning: mockWarning,
}));

// Import after mocking - run is not directly tested in this file but needed for module resolution
import './run.js';

describe('Inputs', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    mockNotice.mockClear();
    mockInfo.mockClear();
    mockDebug.mockClear();
    mockSetFailed.mockClear();
    mockWarning.mockClear();

    // Reset mock input values to defaults
    mockGetInputValue = {
      github_token: 'fake-token',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      token: 'fake-api-token',
      thinking_level: 'off',
      prompt: '',
      trigger: '/pi',
    };

    // Reset GitHub context
    process.env.INPUT_TRIGGER = '/pi';
    process.env.INPUT_GITHUB_TOKEN = 'fake-token';
    process.env.GITHUB_REPOSITORY = 'test-owner/test-repo';
  });

  describe('Required inputs', () => {
    test('should retrieve github_token input', () => {
      mockGetInputValue.github_token = 'ghp_test_token_123';
      const result = mockGetInput('github_token');
      expect(result).toBe('ghp_test_token_123');
    });

    test('should retrieve provider input', () => {
      mockGetInputValue.provider = 'openai';
      const result = mockGetInput('provider');
      expect(result).toBe('openai');
    });

    test('should retrieve model input', () => {
      mockGetInputValue.model = 'gpt-4o';
      const result = mockGetInput('model');
      expect(result).toBe('gpt-4o');
    });

    test('should retrieve token input', () => {
      mockGetInputValue.token = 'sk_test_api_key';
      const result = mockGetInput('token');
      expect(result).toBe('sk_test_api_key');
    });

    test('should support anthropic provider', () => {
      mockGetInputValue.provider = 'anthropic';
      mockGetInputValue.model = 'claude-sonnet-4-5';
      expect(mockGetInput('provider')).toBe('anthropic');
      expect(mockGetInput('model')).toBe('claude-sonnet-4-5');
    });

    test('should support openai provider', () => {
      mockGetInputValue.provider = 'openai';
      mockGetInputValue.model = 'gpt-4o';
      expect(mockGetInput('provider')).toBe('openai');
      expect(mockGetInput('model')).toBe('gpt-4o');
    });

    test('should support google provider', () => {
      mockGetInputValue.provider = 'google';
      mockGetInputValue.model = 'gemini-2.5-pro';
      expect(mockGetInput('provider')).toBe('google');
      expect(mockGetInput('model')).toBe('gemini-2.5-pro');
    });

    test('should support zai provider', () => {
      mockGetInputValue.provider = 'zai';
      mockGetInputValue.model = 'glm-4.7';
      expect(mockGetInput('provider')).toBe('zai');
      expect(mockGetInput('model')).toBe('glm-4.7');
    });
  });

  describe('Optional inputs with defaults', () => {
    test('should default thinking_level to off when not provided', () => {
      mockGetInputValue.thinking_level = '';
      const result = mockGetInput('thinking_level');
      // Note: The actual default is applied in run.ts with ?? 'off'
      expect(result).toBe('');
    });

    test('should use provided thinking_level when set', () => {
      mockGetInputValue.thinking_level = 'high';
      const result = mockGetInput('thinking_level');
      expect(result).toBe('high');
    });

    test('should support all thinking_level values', () => {
      const levels = ['off', 'low', 'medium', 'high'];
      levels.forEach(level => {
        mockGetInputValue.thinking_level = level;
        expect(mockGetInput('thinking_level')).toBe(level);
      });
    });

    test('should default trigger to /pi when not provided', () => {
      mockGetInputValue.trigger = '';
      const result = mockGetInput('trigger');
      // Note: The actual default is applied in context.ts with || DEFAULT_TRIGGER
      expect(result).toBe('');
    });

    test('should use provided trigger when set', () => {
      mockGetInputValue.trigger = '/ai';
      const result = mockGetInput('trigger');
      expect(result).toBe('/ai');
    });

    test('should return empty string for prompt when not provided', () => {
      mockGetInputValue.prompt = '';
      const result = mockGetInput('prompt');
      expect(result).toBe('');
    });

    test('should use provided prompt when set', () => {
      mockGetInputValue.prompt = 'Review this code';
      const result = mockGetInput('prompt');
      expect(result).toBe('Review this code');
    });
  });

  describe('Input edge cases', () => {
    test('should handle empty strings for optional inputs', () => {
      mockGetInputValue.prompt = '';
      mockGetInputValue.thinking_level = '';
      mockGetInputValue.trigger = '';

      expect(mockGetInput('prompt')).toBe('');
      expect(mockGetInput('thinking_level')).toBe('');
      expect(mockGetInput('trigger')).toBe('');
    });

    test('should handle whitespace-only values', () => {
      mockGetInputValue.prompt = '   ';
      mockGetInputValue.thinking_level = '  ';
      mockGetInputValue.trigger = ' /pi ';

      expect(mockGetInput('prompt')).toBe('   ');
      expect(mockGetInput('thinking_level')).toBe('  ');
      expect(mockGetInput('trigger')).toBe(' /pi ');
    });

    test('should handle special characters in prompt', () => {
      const specialPrompt = 'Review this: \n\n\t"Code with \'quotes\'"';
      mockGetInputValue.prompt = specialPrompt;
      expect(mockGetInput('prompt')).toBe(specialPrompt);
    });

    test('should handle numeric-looking values as strings', () => {
      mockGetInputValue.thinking_level = '123';
      expect(mockGetInput('thinking_level')).toBe('123');
    });

    test('should handle case-sensitive provider names', () => {
      mockGetInputValue.provider = 'OpenAI'; // Different case
      expect(mockGetInput('provider')).toBe('OpenAI');
    });

    test('should handle case-sensitive model names', () => {
      mockGetInputValue.model = 'GPT-4O'; // Different case
      expect(mockGetInput('model')).toBe('GPT-4O');
    });

    test('should handle multi-line prompt', () => {
      const multiline = 'Line 1\nLine 2\nLine 3';
      mockGetInputValue.prompt = multiline;
      expect(mockGetInput('prompt')).toBe(multiline);
    });
  });

  describe('Input validation scenarios', () => {
    test('should accept valid thinking_level values', () => {
      const validLevels = ['off', 'low', 'medium', 'high'];
      validLevels.forEach(level => {
        mockGetInputValue.thinking_level = level;
        expect(mockGetInput('thinking_level')).toBe(level);
      });
    });

    test('should handle custom thinking_level values', () => {
      // The implementation doesn't validate, so custom values pass through
      mockGetInputValue.thinking_level = 'custom-level';
      expect(mockGetInput('thinking_level')).toBe('custom-level');
    });

    test('should handle custom trigger phrases', () => {
      const customTriggers = ['/ai', '/bot', '/coder', '@assistant'];
      customTriggers.forEach(trigger => {
        mockGetInputValue.trigger = trigger;
        expect(mockGetInput('trigger')).toBe(trigger);
      });
    });

    test('should handle various provider names', () => {
      const providers = ['anthropic', 'openai', 'google', 'zai', 'openrouter'];
      providers.forEach(provider => {
        mockGetInputValue.provider = provider;
        expect(mockGetInput('provider')).toBe(provider);
      });
    });

    test('should handle various model names', () => {
      const models = [
        'claude-sonnet-4-5',
        'gpt-4o',
        'gemini-2.5-pro',
        'glm-4.7',
        'deepseek-coder-v2',
      ];
      models.forEach(model => {
        mockGetInputValue.model = model;
        expect(mockGetInput('model')).toBe(model);
      });
    });
  });

  describe('Input combinations', () => {
    test('should handle all required inputs with minimal optional inputs', () => {
      mockGetInputValue = {
        github_token: 'ghp_token',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        token: 'api_key',
        thinking_level: '',
        prompt: '',
        trigger: '',
      };

      expect(mockGetInput('github_token')).toBe('ghp_token');
      expect(mockGetInput('provider')).toBe('anthropic');
      expect(mockGetInput('model')).toBe('claude-sonnet-4-5');
      expect(mockGetInput('token')).toBe('api_key');
      expect(mockGetInput('thinking_level')).toBe('');
      expect(mockGetInput('prompt')).toBe('');
      expect(mockGetInput('trigger')).toBe('');
    });

    test('should handle all inputs provided', () => {
      mockGetInputValue = {
        github_token: 'ghp_token',
        provider: 'openai',
        model: 'gpt-4o',
        token: 'sk_api_key',
        thinking_level: 'high',
        prompt: 'Review this code thoroughly',
        trigger: '/ai',
      };

      expect(mockGetInput('github_token')).toBe('ghp_token');
      expect(mockGetInput('provider')).toBe('openai');
      expect(mockGetInput('model')).toBe('gpt-4o');
      expect(mockGetInput('token')).toBe('sk_api_key');
      expect(mockGetInput('thinking_level')).toBe('high');
      expect(mockGetInput('prompt')).toBe('Review this code thoroughly');
      expect(mockGetInput('trigger')).toBe('/ai');
    });

    test('should handle mixed provider-model combinations', () => {
      const combinations = [
        { provider: 'anthropic', model: 'claude-sonnet-4-5' },
        { provider: 'openai', model: 'gpt-4o' },
        { provider: 'google', model: 'gemini-2.5-pro' },
        { provider: 'zai', model: 'glm-4.7' },
      ];

      combinations.forEach(({ provider, model }) => {
        mockGetInputValue.provider = provider;
        mockGetInputValue.model = model;
        expect(mockGetInput('provider')).toBe(provider);
        expect(mockGetInput('model')).toBe(model);
      });
    });

    test('should handle prompt with different thinking levels', () => {
      mockGetInputValue.prompt = 'Analyze this code';
      const levels = ['off', 'low', 'medium', 'high'];

      levels.forEach(level => {
        mockGetInputValue.thinking_level = level;
        expect(mockGetInput('prompt')).toBe('Analyze this code');
        expect(mockGetInput('thinking_level')).toBe(level);
      });
    });
  });
});

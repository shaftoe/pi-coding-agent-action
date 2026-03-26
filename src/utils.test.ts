import { describe, it, expect } from 'bun:test';
import { runCommand, extractUserPrompt, parseEnvVars } from './utils.js';

describe('utils', () => {
  describe('runCommand', () => {
    it('should execute a simple command successfully', () => {
      const result = runCommand(['echo', 'hello']);
      expect(result).toBe('hello');
    });

    it('should handle command with multiple arguments', () => {
      const result = runCommand(['echo', 'hello', 'world']);
      expect(result).toBe('hello world');
    });

    it('should throw error on non-zero exit status', () => {
      expect(() => runCommand(['false'])).toThrow();
    });

    it('should throw error with command name on failure', () => {
      try {
        runCommand(['ls', '/nonexistent-directory-xyz']);
        throw new Error('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain('ls');
      }
    });

    it('should provide input to stdin', () => {
      const result = runCommand(['cat'], { input: 'test input' });
      expect(result).toBe('test input');
    });

    it('should pass custom environment variables', () => {
      const result = runCommand(['sh', '-c', 'echo $TEST_VAR'], undefined, {
        TEST_VAR: 'custom_value',
      });
      expect(result).toBe('custom_value');
    });

    it('should merge custom env with process env', () => {
      const result = runCommand(['sh', '-c', 'echo $PATH:$TEST_VAR'], undefined, {
        TEST_VAR: 'custom',
      });
      expect(result).toContain('custom');
      expect(result).toContain('/'); // PATH should exist
    });
  });

  describe('extractUserPrompt', () => {
    it('should extract prompt after mention', () => {
      const prompt = extractUserPrompt('/pi fix this bug');
      expect(prompt).toBe('fix this bug');
    });

    it('should return null for mention only', () => {
      const prompt = extractUserPrompt('/pi');
      expect(prompt).toBeNull();
    });

    it('should handle whitespace after mention', () => {
      const prompt = extractUserPrompt('/pi   fix this bug');
      expect(prompt).toBe('fix this bug');
    });

    it('should handle mention in middle of text', () => {
      const prompt = extractUserPrompt('Can you /pi help me?');
      expect(prompt).toBe('help me?');
    });

    it('should return full text if no mention found', () => {
      const prompt = extractUserPrompt('just a comment');
      expect(prompt).toBe('just a comment');
    });

    it('should trim whitespace from text without mention', () => {
      const prompt = extractUserPrompt('  just a comment  ');
      expect(prompt).toBe('just a comment');
    });
  });

  describe('parseEnvVars', () => {
    it('should parse single env var', () => {
      const envVars = parseEnvVars('API_KEY=secret123');
      expect(envVars).toEqual([{ key: 'API_KEY', value: 'secret123' }]);
    });

    it('should parse multiple env vars', () => {
      const envVars = parseEnvVars('API_KEY=secret123\nDEBUG=true');
      expect(envVars).toEqual([
        { key: 'API_KEY', value: 'secret123' },
        { key: 'DEBUG', value: 'true' },
      ]);
    });

    it('should handle empty input', () => {
      const envVars = parseEnvVars('');
      expect(envVars).toEqual([]);
    });

    it('should handle whitespace only', () => {
      const envVars = parseEnvVars('   ');
      expect(envVars).toEqual([]);
    });

    it('should trim whitespace', () => {
      const envVars = parseEnvVars('  API_KEY=secret123  \n  DEBUG=true  ');
      expect(envVars).toEqual([
        { key: 'API_KEY', value: 'secret123' },
        { key: 'DEBUG', value: 'true' },
      ]);
    });

    it('should filter lines without equals', () => {
      const envVars = parseEnvVars('API_KEY=secret123\nINVALID_LINE\nDEBUG=true');
      expect(envVars).toEqual([
        { key: 'API_KEY', value: 'secret123' },
        { key: 'DEBUG', value: 'true' },
      ]);
    });

    it('should handle values with spaces', () => {
      const envVars = parseEnvVars('MESSAGE=hello world');
      expect(envVars).toEqual([{ key: 'MESSAGE', value: 'hello world' }]);
    });

    it('should handle values with equals signs', () => {
      const envVars = parseEnvVars('URL=https://example.com?param=value');
      expect(envVars).toEqual([{ key: 'URL', value: 'https://example.com?param=value' }]);
    });

    it('should handle empty values', () => {
      const envVars = parseEnvVars('EMPTY=');
      expect(envVars).toEqual([{ key: 'EMPTY', value: '' }]);
    });

    it('should handle multi-line with blank lines', () => {
      const envVars = parseEnvVars('API_KEY=secret123\n\nDEBUG=true');
      expect(envVars).toEqual([
        { key: 'API_KEY', value: 'secret123' },
        { key: 'DEBUG', value: 'true' },
      ]);
    });

    it('should throw for env var key starting with number', () => {
      expect(() => parseEnvVars('1API_KEY=secret123')).toThrow(
        "Invalid environment variable key '1API_KEY': must start with a letter or underscore and contain only letters, numbers, and underscores"
      );
    });

    it('should throw for env var key with special characters', () => {
      expect(() => parseEnvVars('API-KEY=secret123')).toThrow(
        "Invalid environment variable key 'API-KEY': must start with a letter or underscore and contain only letters, numbers, and underscores"
      );
    });

    it('should throw for env var key with spaces', () => {
      expect(() => parseEnvVars('API KEY=secret123')).toThrow(
        "Invalid environment variable key 'API KEY': must start with a letter or underscore and contain only letters, numbers, and underscores"
      );
    });

    it('should throw for env var key starting with dot', () => {
      expect(() => parseEnvVars('.API_KEY=secret123')).toThrow(
        "Invalid environment variable key '.API_KEY': must start with a letter or underscore and contain only letters, numbers, and underscores"
      );
    });

    it('should allow valid env var keys with underscores and numbers', () => {
      const envVars = parseEnvVars('API_KEY_2=test123');
      expect(envVars).toEqual([{ key: 'API_KEY_2', value: 'test123' }]);
    });

    it('should allow env var key starting with underscore', () => {
      const envVars = parseEnvVars('_PRIVATE_KEY=secret');
      expect(envVars).toEqual([{ key: '_PRIVATE_KEY', value: 'secret' }]);
    });
  });
});

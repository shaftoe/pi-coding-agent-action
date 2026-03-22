import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mock } from 'bun:test';
import * as core from '@actions/core';
import {
  runCommand,
  getMentions,
  assertKeyword,
  extractUserPrompt,
  generateBranchName,
  parseEnvVars,
} from './utils.js';

// Mock @actions/core
const mockCore = mock(() => core);

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
        expect.fail('Should have thrown');
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

  describe('getMentions', () => {
    let originalGetInput: typeof core.getInput;

    beforeEach(() => {
      originalGetInput = core.getInput;
    });

    afterEach(() => {
      core.getInput = originalGetInput;
    });

    it('should return default mention when no input is provided', () => {
      core.getInput = mock(() => '');
      expect(getMentions()).toEqual(['/pi']);
    });

    it('should parse comma-separated mentions', () => {
      core.getInput = mock(() => '/pi,@bot,/ai');
      expect(getMentions()).toEqual(['/pi', '@bot', '/ai']);
    });

    it('should trim whitespace from mentions', () => {
      core.getInput = mock(() => ' /pi , @bot , /ai ');
      expect(getMentions()).toEqual(['/pi', '@bot', '/ai']);
    });

    it('should convert mentions to lowercase', () => {
      core.getInput = mock(() => '/Pi,@Bot,/AI');
      expect(getMentions()).toEqual(['/pi', '@bot', '/ai']);
    });

    it('should handle single mention', () => {
      core.getInput = mock(() => '/custom');
      expect(getMentions()).toEqual(['/custom']);
    });
  });

  describe('assertKeyword', () => {
    let originalGetInput: typeof core.getInput;
    let originalSetFailed: typeof core.setFailed;

    beforeEach(() => {
      originalGetInput = core.getInput;
      originalSetFailed = core.setFailed;
      core.setFailed = mock(() => {});
    });

    afterEach(() => {
      core.getInput = originalGetInput;
      core.setFailed = originalSetFailed;
    });

    it('should pass when comment starts with mention', () => {
      core.getInput = mock(() => '/pi');
      expect(() => assertKeyword('/pi help me')).not.toThrow();
    });

    it('should pass when comment ends with mention', () => {
      core.getInput = mock(() => '/pi');
      expect(() => assertKeyword('help me /pi')).not.toThrow();
    });

    it('should pass when mention is in middle', () => {
      core.getInput = mock(() => '/pi');
      expect(() => assertKeyword('help /pi me')).not.toThrow();
    });

    it('should pass when comment is just the mention', () => {
      core.getInput = mock(() => '/pi');
      expect(() => assertKeyword('/pi')).not.toThrow();
    });

    it('should be case insensitive', () => {
      core.getInput = mock(() => '/pi');
      expect(() => assertKeyword('/PI help me')).not.toThrow();
      expect(() => assertKeyword('/Pi help me')).not.toThrow();
    });

    it('should support multiple configured mentions', () => {
      core.getInput = mock(() => '/pi,@bot');
      expect(() => assertKeyword('/pi help')).not.toThrow();
      expect(() => assertKeyword('@bot help')).not.toThrow();
    });

    it('should throw when no mention is found', () => {
      core.getInput = mock(() => '/pi');
      expect(() => assertKeyword('help me without keyword')).toThrow();
    });

    it('should call setFailed when no mention is found', () => {
      core.getInput = mock(() => '/pi');
      assertKeyword('no keyword');
      expect(core.setFailed).toHaveBeenCalled();
    });

    it('should handle custom mention', () => {
      core.getInput = mock(() => '@assistant');
      expect(() => assertKeyword('@assistant help')).not.toThrow();
      expect(() => assertKeyword('help me')).toThrow();
    });
  });

  describe('extractUserPrompt', () => {
    let originalGetInput: typeof core.getInput;

    beforeEach(() => {
      originalGetInput = core.getInput;
    });

    afterEach(() => {
      core.getInput = originalGetInput;
    });

    it('should extract prompt after mention', () => {
      core.getInput = mock(() => '/pi');
      expect(extractUserPrompt('/pi fix this bug')).toBe('fix this bug');
    });

    it('should return null for mention-only comment', () => {
      core.getInput = mock(() => '/pi');
      expect(extractUserPrompt('/pi')).toBeNull();
    });

    it('should handle whitespace after mention', () => {
      core.getInput = mock(() => '/pi');
      expect(extractUserPrompt('/pi   fix this')).toBe('fix this');
    });

    it('should preserve case of user prompt', () => {
      core.getInput = mock(() => '/pi');
      expect(extractUserPrompt('/pi Fix This Bug')).toBe('Fix This Bug');
    });

    it('should find first matching mention', () => {
      core.getInput = mock(() => '/pi,@bot');
      expect(extractUserPrompt('/pi help me')).toBe('help me');
    });

    it('should handle mention in middle of text', () => {
      core.getInput = mock(() => '/pi');
      expect(extractUserPrompt('hello /pi help me')).toBe('help me');
    });

    it('should return null if no mention found', () => {
      core.getInput = mock(() => '/pi');
      expect(extractUserPrompt('no mention here')).toBeNull();
    });

    it('should handle multiline prompt', () => {
      core.getInput = mock(() => '/pi');
      const prompt = '/pi fix this\nand also this';
      expect(extractUserPrompt(prompt)).toContain('fix this');
    });
  });

  describe('generateBranchName', () => {
    it('should generate branch name with issue type', () => {
      const branchName = generateBranchName('issue', 123);
      expect(branchName).toMatch(/^pi\/issue123-\d{14}$/);
    });

    it('should generate branch name with pr type', () => {
      const branchName = generateBranchName('pr', 456);
      expect(branchName).toMatch(/^pi\/pr456-\d{14}$/);
    });

    it('should include timestamp in format YYYYMMDDHHmmss', () => {
      const branchName = generateBranchName('issue', 1);
      const match = branchName.match(/pi\/issue1-(\d{14})/);
      expect(match).not.toBeNull();
      if (match) {
        const timestamp = match[1];
        const date = new Date();
        const year = date.getFullYear();
        expect(timestamp.startsWith(String(year))).toBeTrue();
      }
    });

    it('should generate unique branch names', () => {
      const branch1 = generateBranchName('issue', 123);
      // Small delay to ensure different timestamp
      const branch2 = generateBranchName('issue', 123);
      expect(branch1).not.toBe(branch2);
    });

    it('should handle large issue numbers', () => {
      const branchName = generateBranchName('issue', 999999);
      expect(branchName).toMatch(/^pi\/issue999999-\d{14}$/);
    });

    it('should use custom type strings', () => {
      const branchName = generateBranchName('custom', 42);
      expect(branchName).toMatch(/^pi\/custom42-\d{14}$/);
    });
  });

  describe('parseEnvVars', () => {
    it('should return empty array for empty string', () => {
      expect(parseEnvVars('')).toEqual([]);
    });

    it('should return empty array for whitespace only', () => {
      expect(parseEnvVars('   \n  \t  ')).toEqual([]);
    });

    it('should parse single environment variable', () => {
      const result = parseEnvVars('KEY=VALUE');
      expect(result).toEqual([{ key: 'KEY', value: 'VALUE' }]);
    });

    it('should parse multiple environment variables', () => {
      const result = parseEnvVars('KEY1=VALUE1\nKEY2=VALUE2\nKEY3=VALUE3');
      expect(result).toEqual([
        { key: 'KEY1', value: 'VALUE1' },
        { key: 'KEY2', value: 'VALUE2' },
        { key: 'KEY3', value: 'VALUE3' },
      ]);
    });

    it('should trim whitespace from keys and values', () => {
      const result = parseEnvVars('  KEY  =  VALUE  ');
      expect(result).toEqual([{ key: 'KEY', value: 'VALUE' }]);
    });

    it('should handle empty values', () => {
      const result = parseEnvVars('KEY=');
      expect(result).toEqual([{ key: 'KEY', value: '' }]);
    });

    it('should handle values with equals signs', () => {
      const result = parseEnvVars('KEY=VALUE=WITH=EQUALS');
      expect(result).toEqual([{ key: 'KEY', value: 'VALUE=WITH=EQUALS' }]);
    });

    it('should handle values with spaces', () => {
      const result = parseEnvVars('KEY=value with spaces');
      expect(result).toEqual([{ key: 'KEY', value: 'value with spaces' }]);
    });

    it('should filter out lines without equals signs', () => {
      const result = parseEnvVars('KEY1=VALUE1\nINVALID_LINE\nKEY2=VALUE2');
      expect(result).toEqual([
        { key: 'KEY1', value: 'VALUE1' },
        { key: 'KEY2', value: 'VALUE2' },
      ]);
    });

    it('should filter out empty lines', () => {
      const result = parseEnvVars('KEY1=VALUE1\n\nKEY2=VALUE2\n');
      expect(result).toEqual([
        { key: 'KEY1', value: 'VALUE1' },
        { key: 'KEY2', value: 'VALUE2' },
      ]);
    });

    it('should handle complex environment variable formats', () => {
      const result = parseEnvVars(`
API_KEY=sk-1234567890
DATABASE_URL=postgresql://localhost:5432/db
NODE_ENV=production
  DEBUG=true  
`);
      expect(result).toEqual([
        { key: 'API_KEY', value: 'sk-1234567890' },
        { key: 'DATABASE_URL', value: 'postgresql://localhost:5432/db' },
        { key: 'NODE_ENV', value: 'production' },
        { key: 'DEBUG', value: 'true' },
      ]);
    });
  });
});

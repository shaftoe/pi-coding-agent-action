import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import * as core from '@actions/core';
import * as os from 'os';
import * as fs from 'fs';
import { runPi, summarize } from './pi.js';

describe('pi', () => {
  describe('runPi', () => {
    let originalGetInput: typeof core.getInput;
    let mockSpawnSync: any;

    beforeEach(() => {
      originalGetInput = core.getInput;
    });

    afterEach(() => {
      core.getInput = originalGetInput;
      // Clean up any temp files
      const promptFile = `${os.tmpdir()}/pi_prompt.md`;
      try {
        fs.unlinkSync(promptFile);
      } catch {}
      try {
        fs.unlinkSync('SYSTEM.md');
      } catch {}
    });

    it('should run pi with default provider and model', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      // Mock spawnSync to return success
      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock((cmd: string, args: any[], options: any) => {
        expect(cmd).toBe('pi');
        expect(args).toContain('--provider');
        expect(args).toContain('anthropic');
        expect(args).toContain('--model');
        expect(args).toContain('claude-sonnet-4-5');
        expect(args).toContain('-p');

        // Check that prompt file was created
        const promptFileIndex = args.findIndex((a: string) => a.startsWith('@'));
        expect(promptFileIndex).toBeGreaterThan(0);
        const promptFile = args[promptFileIndex].slice(1);
        expect(fs.existsSync(promptFile)).toBeTrue();

        return { status: 0, stdout: 'AI response', stderr: '' };
      });

      require('child_process').spawnSync = mockSpawnSync;

      const result = runPi('Test prompt');
      expect(result).toBe('AI response');

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should use provider override when provided', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({ status: 0, stdout: 'Response', stderr: '' }));
      require('child_process').spawnSync = mockSpawnSync;

      runPi('Test prompt', 'openai', 'gpt-4');

      const lastCall = mockSpawnSync.mock.calls[0];
      expect(lastCall[1]).toContain('--provider');
      expect(lastCall[1]).toContain('openai');

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should use model override when provided', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({ status: 0, stdout: 'Response', stderr: '' }));
      require('child_process').spawnSync = mockSpawnSync;

      runPi('Test prompt', 'anthropic', 'claude-3-opus');

      const lastCall = mockSpawnSync.mock.calls[0];
      expect(lastCall[1]).toContain('--model');
      expect(lastCall[1]).toContain('claude-3-opus');

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should include extra tools when specified', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: 'git,docker',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({ status: 0, stdout: 'Response', stderr: '' }));
      require('child_process').spawnSync = mockSpawnSync;

      runPi('Test prompt');

      const lastCall = mockSpawnSync.mock.calls[0];
      expect(lastCall[1]).toContain('--tools');
      expect(lastCall[1]).toContain('git,docker');

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should create SYSTEM.md when custom system prompt is provided', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: 'You are a helpful assistant.',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => {
        // SYSTEM.md should exist at this point
        expect(fs.existsSync('SYSTEM.md')).toBeTrue();
        const content = fs.readFileSync('SYSTEM.md', 'utf8');
        expect(content).toBe('You are a helpful assistant.');
        return { status: 0, stdout: 'Response', stderr: '' };
      });
      require('child_process').spawnSync = mockSpawnSync;

      runPi('Test prompt');

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should pass environment variables from env_vars input', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: 'API_KEY=secret123\nDEBUG=true',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock((cmd: string, args: any[], options: any) => {
        expect(options.env).toBeDefined();
        expect(options.env.API_KEY).toBe('secret123');
        expect(options.env.DEBUG).toBe('true');
        expect(options.env).toHaveProperty('PATH'); // Original env should be preserved
        return { status: 0, stdout: 'Response', stderr: '' };
      });
      require('child_process').spawnSync = mockSpawnSync;

      runPi('Test prompt');

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should write prompt to temp file', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      let capturedPromptFile: string | null = null;
      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock((cmd: string, args: any[], options: any) => {
        const promptFileArg = args.find((a: string) => a.startsWith('@'));
        if (promptFileArg) {
          capturedPromptFile = promptFileArg.slice(1);
          const promptContent = fs.readFileSync(capturedPromptFile, 'utf8');
          expect(promptContent).toBe('Test prompt');
        }
        return { status: 0, stdout: 'Response', stderr: '' };
      });
      require('child_process').spawnSync = mockSpawnSync;

      runPi('Test prompt');

      expect(capturedPromptFile).not.toBeNull();
      expect(capturedPromptFile).toContain(os.tmpdir());

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should clean up prompt file after execution', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      let promptFile: string | null = null;
      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock((cmd: string, args: any[], options: any) => {
        const promptFileArg = args.find((a: string) => a.startsWith('@'));
        if (promptFileArg) {
          promptFile = promptFileArg.slice(1);
        }
        return { status: 0, stdout: 'Response', stderr: '' };
      });
      require('child_process').spawnSync = mockSpawnSync;

      runPi('Test prompt');

      // After execution, temp file should be cleaned up
      if (promptFile) {
        expect(fs.existsSync(promptFile)).toBeFalse();
      }

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should clean up SYSTEM.md after execution when custom prompt was used', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: 'Custom system prompt',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({ status: 0, stdout: 'Response', stderr: '' }));
      require('child_process').spawnSync = mockSpawnSync;

      runPi('Test prompt');

      // After execution, SYSTEM.md should be cleaned up
      expect(fs.existsSync('SYSTEM.md')).toBeFalse();

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should throw error when pi exits with non-zero status', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({
        status: 1,
        stderr: 'Something went wrong',
        stdout: '',
      }));
      require('child_process').spawnSync = mockSpawnSync;

      expect(() => runPi('Test prompt')).toThrow('pi agent failed');
      expect(() => runPi('Test prompt')).toThrow('Something went wrong');

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should include stderr in error message when command fails', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({
        status: 1,
        stderr: 'API connection failed',
        stdout: '',
      }));
      require('child_process').spawnSync = mockSpawnSync;

      try {
        runPi('Test prompt');
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('API connection failed');
      }

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should handle error object in spawnSync result', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({
        status: null,
        error: new Error('Command not found'),
        stderr: '',
        stdout: '',
      }));
      require('child_process').spawnSync = mockSpawnSync;

      try {
        runPi('Test prompt');
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('Command not found');
      }

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should handle missing stderr and error', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({ status: 1, stderr: '', stdout: '' }));
      require('child_process').spawnSync = mockSpawnSync;

      try {
        runPi('Test prompt');
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('pi exited with non-zero status');
      }

      require('child_process').spawnSync = originalSpawnSync;
    });

    it('should return trimmed stdout', () => {
      core.getInput = mock((name: string) => {
        const inputs: Record<string, string> = {
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          extra_tools: '',
          prompt: '',
          env_vars: '',
        };
        return inputs[name] || '';
      });

      const originalSpawnSync = require('child_process').spawnSync;
      const mockSpawnSync = mock(() => ({
        status: 0,
        stdout: '  AI response with extra spaces  \n',
        stderr: '',
      }));
      require('child_process').spawnSync = mockSpawnSync;

      const result = runPi('Test prompt');
      expect(result).toBe('AI response with extra spaces');

      require('child_process').spawnSync = originalSpawnSync;
    });
  });

  describe('summarize', () => {
    it('should use first line if short enough', () => {
      const summary = summarize('This is a short summary\nMore details here', 123);
      expect(summary).toBe('This is a short summary');
    });

    it('should use first line if exactly 50 characters', () => {
      const fiftyCharLine = 'x'.repeat(50);
      const summary = summarize(`${fiftyCharLine}\nMore text`, 123);
      expect(summary).toBe(fiftyCharLine);
    });

    it('should not use first line if over 50 characters', () => {
      const fiftyOneCharLine = 'x'.repeat(51);
      const summary = summarize(`${fiftyOneCharLine}\nMore text`, 123);
      expect(summary).not.toBe(fiftyOneCharLine);
      expect(summary.length).toBeLessThanOrEqual(50);
    });

    it('should not use generic first lines', () => {
      const summary = summarize('I will help you with that', 123);
      expect(summary).not.toBe('I will help you with that');
    });

    it('should reject "Sure" as generic', () => {
      const summary = summarize('Sure, I can do that', 123);
      expect(summary).not.toContain('Sure');
    });

    it('should reject "OK" as generic', () => {
      const summary = summarize('OK, let me help', 123);
      expect(summary).not.toContain('OK');
    });

    it('should reject "Great" as generic', () => {
      const summary = summarize('Great question!', 123);
      expect(summary).not.toContain('Great');
    });

    it('should reject "Here" as generic', () => {
      const summary = summarize('Here is the solution', 123);
      expect(summary).not.toContain('Here');
    });

    it('should reject "The" as generic', () => {
      const summary = summarize('The solution is simple', 123);
      expect(summary).not.toContain('The');
    });

    it('should reject "This" as generic', () => {
      const summary = summarize('This fixes the bug', 123);
      expect(summary).not.toContain('This');
    });

    it('should reject "A" as generic', () => {
      const summary = summarize('A better approach is needed', 123);
      expect(summary).not.toContain('A');
    });

    it('should use first sentence if first line is too long', () => {
      const summary = summarize(
        'This is a very long first line that exceeds fifty characters. But this is shorter.',
        123
      );
      expect(summary.length).toBeLessThanOrEqual(50);
      expect(summary).toContain('very long first line');
    });

    it('should truncate first sentence to 50 characters', () => {
      const longSentence = 'a'.repeat(100);
      const summary = summarize(`${longSentence}. More text.`, 123);
      expect(summary).toBe('a'.repeat(50));
    });

    it('should strip generic prefixes from first sentence', () => {
      const summary = summarize('I will implement a fix for the bug', 123);
      expect(summary).not.toContain('I');
      expect(summary).toBe('implement a fix for the bug');
    });

    it('should fallback to generic message for empty text', () => {
      const summary = summarize('', 123);
      expect(summary).toBe('Fix issue #123');
    });

    it('should fallback to generic message for very short text', () => {
      const summary = summarize('Hi', 123);
      expect(summary).toBe('Fix issue #123');
    });

    it('should fallback to generic message for generic text', () => {
      const summary = summarize('I will do it', 123);
      expect(summary).toBe('Fix issue #123');
    });

    it('should handle multiline text with first short line', () => {
      const summary = summarize('Fixed memory leak\n\nDetails here', 123);
      expect(summary).toBe('Fixed memory leak');
    });

    it('should handle text with only one long line', () => {
      const longLine = 'x'.repeat(100);
      const summary = summarize(longLine, 123);
      expect(summary).toBe('x'.repeat(50));
    });

    it('should include issue number in fallback', () => {
      const summary = summarize('I can help', 456);
      expect(summary).toContain('456');
    });

    it('should handle text with exclamation mark', () => {
      const summary = summarize('Bug fixed! More details', 123);
      expect(summary).toBe('Bug fixed');
    });

    it('should handle text with question mark', () => {
      const summary = summarize('What about this? More text', 123);
      expect(summary).toBe('What about this');
    });

    it('should handle text with period', () => {
      const summary = summarize('Done. More text', 123);
      expect(summary).toBe('Done');
    });

    it('should trim whitespace from summary', () => {
      const summary = summarize('  Fixed bug  ', 123);
      expect(summary).toBe('Fixed bug');
    });

    it('should handle first line with leading/trailing spaces', () => {
      const shortLine = '  Fix  ';
      const summary = summarize(`${shortLine}\nMore text`, 123);
      expect(summary).toBe('Fix');
    });
  });
});

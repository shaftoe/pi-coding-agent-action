/**
 * @file Tests for {@link packages/pi-cli/src/config.ts}.
 *
 * Covers:
 *   - gatherCliConfig: produces the expected PiConfig shape
 */

import { describe, it, expect } from 'bun:test';
import { gatherCliConfig, gatherInteractiveConfig } from '../src/config.js';

describe('gatherCliConfig', () => {
  const baseArgs = {
    prompt: 'fix the tests',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    cwd: '/some/workspace',
  };

  it('produces a PiConfig with the expected fields', () => {
    const config = gatherCliConfig(baseArgs, 'sk-ant-test');

    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-5');
    expect(config.token).toBe('sk-ant-test');
    expect(config.promptInput).toBe('fix the tests');
    expect(config.cwd).toBe('/some/workspace');
  });

  it('injects the CLI-specific system prompt', () => {
    const config = gatherCliConfig(baseArgs, 'sk-ant-test');
    expect(config.systemPrompt).toContain("developer's terminal");
    expect(config.systemPrompt).toContain('Do NOT add any footer');
  });

  it('disables HTML/JSONL exports by default', () => {
    const config = gatherCliConfig(baseArgs, 'sk-ant-test');
    expect(config.exportSessionHtml).toBe(false);
    expect(config.exportSessionJsonl).toBe(false);
  });

  it('enables builtin extensions by default', () => {
    const config = gatherCliConfig(baseArgs, 'sk-ant-test');
    expect(config.loadBuiltinExtensions).toBe(true);
  });

  it('disables auto-compaction by default', () => {
    const config = gatherCliConfig(baseArgs, 'sk-ant-test');
    expect(config.autoCompaction).toBe(false);
  });

  it('sets thinking level to off for M1', () => {
    const config = gatherCliConfig(baseArgs, 'sk-ant-test');
    expect(config.thinkingLevel).toBe('off');
  });

  it('omits packageDir (not needed in CLI node_modules layout)', () => {
    const config = gatherCliConfig(baseArgs, 'sk-ant-test');
    expect(config.packageDir).toBeUndefined();
  });

  it('does not set extensions/loadedTools/diff limits in M1', () => {
    const config = gatherCliConfig(baseArgs, 'sk-ant-test');
    expect(config.extensions).toBeUndefined();
    expect(config.loadedTools).toBeUndefined();
    expect(config.diffMaxLines).toBeUndefined();
    expect(config.diffMaxBytes).toBeUndefined();
    expect(config.diffIgnorePatterns).toBeUndefined();
    expect(config.baseUrl).toBeUndefined();
  });

  it('accepts different cwd values', () => {
    const config = gatherCliConfig({ ...baseArgs, cwd: '/other/dir' }, 'tok');
    expect(config.cwd).toBe('/other/dir');
  });
});

describe('gatherInteractiveConfig', () => {
  const interactiveArgs = {
    prompt: 'Issue #277: Develop CLI features\n\nInstruction: implement the CLI',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    cwd: '/some/workspace',
    postComment: true,
  };

  it('produces a PiConfig with the expected fields', () => {
    const config = gatherInteractiveConfig(interactiveArgs, 'sk-ant-test');

    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-sonnet-4-5');
    expect(config.token).toBe('sk-ant-test');
    expect(config.promptInput).toContain('Issue #277');
    expect(config.cwd).toBe('/some/workspace');
  });

  it('uses the interactive system prompt (mixed CLI/GitHub mode)', () => {
    const config = gatherInteractiveConfig(interactiveArgs, 'sk-ant-test');
    expect(config.systemPrompt).toContain('mixed CLI/GitHub mode');
    expect(config.systemPrompt).toContain('thread history');
    expect(config.systemPrompt).toContain('Do NOT add any footer');
  });

  it('disables HTML/JSONL exports by default', () => {
    const config = gatherInteractiveConfig(interactiveArgs, 'sk-ant-test');
    expect(config.exportSessionHtml).toBe(false);
    expect(config.exportSessionJsonl).toBe(false);
  });

  it('enables builtin extensions by default', () => {
    const config = gatherInteractiveConfig(interactiveArgs, 'sk-ant-test');
    expect(config.loadBuiltinExtensions).toBe(true);
  });

  it('sets thinking level to off', () => {
    const config = gatherInteractiveConfig(interactiveArgs, 'sk-ant-test');
    expect(config.thinkingLevel).toBe('off');
  });
});

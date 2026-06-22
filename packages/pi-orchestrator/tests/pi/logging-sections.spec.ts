/**
 * Unit tests for the pure section formatters extracted from `logging.ts`
 * (Step 2.12: `loggingFactory` / `before_agent_start` refactor).
 *
 * Each formatter returns an array of `LogLine` objects, making them easy to
 * assert against without mocking a `Logger`.
 */

import { describe, expect, test } from 'bun:test';
import {
  formatExtensionsSection,
  formatLLMSection,
  formatSystemPromptSection,
  formatToolsSection,
  formatUserPromptSection,
  compactionReasonLabel,
  formatCompactionLine,
  type ExtensionLoadingInfo,
  type LogLine,
} from '@alexanderfortin/pi-orchestrator';

function allInfo(lines: readonly LogLine[]): string[] {
  return lines.filter(l => l.level === 'info').map(l => l.text);
}

function allWarning(lines: readonly LogLine[]): string[] {
  return lines.filter(l => l.level === 'warning').map(l => l.text);
}

function noExtensions(): ExtensionLoadingInfo {
  return { requested: [], loaded: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// formatLLMSection
// ---------------------------------------------------------------------------

describe('formatLLMSection', () => {
  test('emits model lines when model is provided', () => {
    const lines = formatLLMSection(
      { provider: 'anthropic', id: 'claude-3-opus', reasoning: 'high' },
      'medium'
    );
    expect(allInfo(lines)).toEqual([
      '📊 LLM',
      '  Model:            anthropic/claude-3-opus',
      '  Reasoning:        high',
      '  Thinking Level:   medium',
      '─────────────────────────────────────────────────────────────────────',
    ]);
    expect(allWarning(lines)).toEqual([]);
  });

  test('emits "Not configured" when model is null', () => {
    const lines = formatLLMSection(null, 'low');
    const texts = allInfo(lines);
    expect(texts).toContain('  Model:     Not configured');
    // No other "Model:" line should appear
    expect(texts.filter(t => /^  Model:/.test(t))).toEqual(['  Model:     Not configured']);
  });

  test('emits "Not configured" when model is undefined', () => {
    const lines = formatLLMSection(undefined, 42);
    expect(allInfo(lines)).toContain('  Model:     Not configured');
  });

  test('accepts boolean reasoning (Pi SDK Model type)', () => {
    const lines = formatLLMSection({ provider: 'openai', id: 'gpt-4o', reasoning: true }, 'high');
    expect(allInfo(lines)).toContain('  Reasoning:        true');
  });

  test('accepts null reasoning', () => {
    const lines = formatLLMSection({ provider: 'openai', id: 'gpt-4o', reasoning: null }, 'high');
    expect(allInfo(lines)).toContain('  Reasoning:        null');
  });

  test('always ends with the section separator', () => {
    const lines = formatLLMSection(null, '');
    expect(lines[lines.length - 1]).toEqual({
      level: 'info',
      text: '─────────────────────────────────────────────────────────────────────',
    });
  });
});

// ---------------------------------------------------------------------------
// formatExtensionsSection
// ---------------------------------------------------------------------------

describe('formatExtensionsSection', () => {
  test('returns empty array when no extensions requested', () => {
    expect(formatExtensionsSection(noExtensions())).toEqual([]);
  });

  test('lists loaded extensions with bullet points', () => {
    const info: ExtensionLoadingInfo = {
      requested: ['./ext1', './ext2'],
      loaded: ['/path/ext1', '/path/ext2'],
      warnings: [],
    };
    const lines = formatExtensionsSection(info);
    expect(allInfo(lines)).toEqual([
      '📦 Extensions',
      '  Requested:        ./ext1, ./ext2',
      '  Loaded:           2 extension(s)',
      '    • /path/ext1',
      '    • /path/ext2',
      '─────────────────────────────────────────────────────────────────────',
    ]);
  });

  test('shows "None" when no extensions loaded', () => {
    const info: ExtensionLoadingInfo = {
      requested: ['./ext1'],
      loaded: [],
      warnings: [],
    };
    expect(allInfo(formatExtensionsSection(info))).toContain('  Loaded:           None');
  });

  test('emits warnings at warning level', () => {
    const info: ExtensionLoadingInfo = {
      requested: ['./ext1'],
      loaded: [],
      warnings: ['ext1 failed to load', 'duplicate name'],
    };
    const lines = formatExtensionsSection(info);
    expect(allWarning(lines)).toEqual(['  ⚠️  ext1 failed to load', '  ⚠️  duplicate name']);
  });

  test('emits no warnings when warnings array is empty', () => {
    const info: ExtensionLoadingInfo = {
      requested: ['./ext1'],
      loaded: ['/path/ext1'],
      warnings: [],
    };
    expect(allWarning(formatExtensionsSection(info))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatToolsSection
// ---------------------------------------------------------------------------

describe('formatToolsSection', () => {
  test('returns empty array when no tools', () => {
    expect(formatToolsSection([])).toEqual([]);
  });

  test('lists tools without source prefix when source is missing', () => {
    const lines = formatToolsSection([
      { name: 'bash', sourceInfo: {} },
      { name: 'read', sourceInfo: { source: null } },
    ]);
    expect(allInfo(lines)).toEqual([
      '🔧 Available Tools',
      '  • bash',
      '  • read',
      '─────────────────────────────────────────────────────────────────────',
    ]);
  });

  test('lists tools with [source] prefix when source is set', () => {
    const lines = formatToolsSection([
      { name: 'gh_pr', sourceInfo: { source: 'github' } },
      { name: 'bash', sourceInfo: {} },
    ]);
    expect(allInfo(lines)).toEqual([
      '🔧 Available Tools',
      '  • [github] gh_pr',
      '  • bash',
      '─────────────────────────────────────────────────────────────────────',
    ]);
  });

  test('treats null source as missing', () => {
    const lines = formatToolsSection([{ name: 'tool', sourceInfo: { source: null } }]);
    expect(allInfo(lines)).toContain('  • tool');
    expect(allInfo(lines)).not.toContainEqual(expect.stringMatching(/^\s+•\s+\[/));
  });
});

// ---------------------------------------------------------------------------
// formatSystemPromptSection
// ---------------------------------------------------------------------------

describe('formatSystemPromptSection', () => {
  test('emits prompt verbatim when under 1000 chars', () => {
    const prompt = 'You are a helpful coding assistant.';
    const lines = formatSystemPromptSection(prompt);
    expect(allInfo(lines)).toEqual([
      '📝 System Prompt',
      prompt,
      '─────────────────────────────────────────────────────────────────────',
    ]);
  });

  test('truncates long prompts and appends a continuation indicator', () => {
    const long = 'a'.repeat(2500);
    const lines = formatSystemPromptSection(long);
    const text = allInfo(lines);
    expect(text[0]).toBe('📝 System Prompt');
    // truncateText truncates at word boundaries when possible — for a string
    // of 2500 'a' chars there are no spaces, so it falls back to a hard cut
    expect(text[1]!.length).toBeLessThanOrEqual(1000 + 3); // text + '...'
    expect(text[1]!.endsWith('...')).toBe(true);
    expect(text[2]).toMatch(/^\n\.\.\. \(1500 more characters\)$/);
    expect(text[3]).toBe('─────────────────────────────────────────────────────────────────────');
  });

  test('no continuation indicator when prompt is exactly 1000 chars', () => {
    const exact = 'a'.repeat(1000);
    const lines = formatSystemPromptSection(exact);
    expect(allInfo(lines)).toEqual([
      '📝 System Prompt',
      exact,
      '─────────────────────────────────────────────────────────────────────',
    ]);
  });
});

// ---------------------------------------------------------------------------
// formatUserPromptSection
// ---------------------------------------------------------------------------

describe('formatUserPromptSection', () => {
  test('emits prompt header and truncated text', () => {
    const lines = formatUserPromptSection('Fix the bug', undefined);
    expect(allInfo(lines)).toEqual(['👤 User Prompt', 'Fix the bug']);
  });

  test('omits image count when images array is missing', () => {
    const lines = formatUserPromptSection('Hi', undefined);
    expect(allInfo(lines)).not.toContainEqual(expect.stringMatching(/image/));
  });

  test('omits image count when images array is empty', () => {
    const lines = formatUserPromptSection('Hi', []);
    expect(allInfo(lines)).not.toContainEqual(expect.stringMatching(/image/));
  });

  test('includes image attachment count when images are present', () => {
    const lines = formatUserPromptSection('See attached', [{}, {}, {}]);
    expect(allInfo(lines)).toContain('  [3 image(s) attached]');
  });

  test('truncates long prompts to 500 chars', () => {
    const long = 'x'.repeat(800);
    const lines = formatUserPromptSection(long);
    const texts = allInfo(lines);
    expect(texts[1]!.length).toBeLessThanOrEqual(500 + 3);
    expect(texts[1]!.endsWith('...')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compactionReasonLabel / formatCompactionLine
// ---------------------------------------------------------------------------

describe('compactionReasonLabel', () => {
  test('maps manual reason', () => {
    expect(compactionReasonLabel('manual')).toBe('manual /compact');
  });

  test('maps threshold reason', () => {
    expect(compactionReasonLabel('threshold')).toBe('context threshold reached');
  });

  test('maps overflow reason', () => {
    expect(compactionReasonLabel('overflow')).toBe('context overflow recovery');
  });
});

describe('formatCompactionLine', () => {
  test('emits a before line with the reason label', () => {
    const line = formatCompactionLine('before', 'threshold', false);
    expect(line.level).toBe('info');
    expect(line.text).toBe('🧹 Compacting context (context threshold reached)');
  });

  test('emits an after line with the reason label', () => {
    const line = formatCompactionLine('after', 'overflow', false);
    expect(line.level).toBe('info');
    expect(line.text).toBe('✅ Context compacted (context overflow recovery)');
  });

  test('includes the retry indicator when willRetry is true', () => {
    const line = formatCompactionLine('before', 'overflow', true);
    expect(line.text).toBe(
      '🧹 Compacting context (context overflow recovery) — turn will be retried'
    );
  });

  test('omits the retry indicator when willRetry is false', () => {
    const line = formatCompactionLine('after', 'manual', false);
    expect(line.text).not.toContain('retried');
    expect(line.text).toBe('✅ Context compacted (manual /compact)');
  });

  test('covers every reason for the before phase', () => {
    for (const reason of ['manual', 'threshold', 'overflow'] as const) {
      const line = formatCompactionLine('before', reason, false);
      expect(line.text).toContain(compactionReasonLabel(reason));
      expect(line.text).toContain('🧹');
    }
  });

  test('covers every reason for the after phase', () => {
    for (const reason of ['manual', 'threshold', 'overflow'] as const) {
      const line = formatCompactionLine('after', reason, true);
      expect(line.text).toContain(compactionReasonLabel(reason));
      expect(line.text).toContain('✅');
      expect(line.text).toContain('turn will be retried');
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: LogLine shape
// ---------------------------------------------------------------------------

describe('LogLine type invariants', () => {
  test('every line from every formatter has level "info" or "warning"', () => {
    const extensionInfo: ExtensionLoadingInfo = {
      requested: ['./x'],
      loaded: [],
      warnings: ['warn'],
    };
    const all: LogLine[] = [
      ...formatLLMSection(null, ''),
      ...formatExtensionsSection(extensionInfo),
      ...formatToolsSection([{ name: 't', sourceInfo: {} }]),
      ...formatSystemPromptSection('p'),
      ...formatUserPromptSection('p'),
    ];
    for (const l of all) {
      expect(['info', 'warning']).toContain(l.level);
      expect(typeof l.text).toBe('string');
    }
  });
});

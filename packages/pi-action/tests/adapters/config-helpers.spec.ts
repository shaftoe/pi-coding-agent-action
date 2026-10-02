/**
 * Unit tests for the parsing/validation helpers exported from
 * `packages/pi-action/src/adapters/config.ts`.
 *
 * These complement `config.spec.ts`, which tests the full
 * `gatherActionsConfig` pipeline end-to-end via the `@actions/core` mock.
 * Each helper is a pure function over raw strings, so we test edge cases
 * here directly without any mocking.
 */

import { describe, expect, test } from 'vitest';
import {
  MISSING_MODEL_MESSAGE,
  MISSING_PROVIDER_MESSAGE,
  parseBooleanInput,
  parseLoadedTools,
  parseMcpServers,
  parsePositiveIntInput,
  parseStringListInput,
  validateRequiredInputs,
} from '../../src/adapters/config';

describe('parseBooleanInput', () => {
  test('returns the default value when raw is empty', () => {
    expect(parseBooleanInput('', true)).toBe(true);
    expect(parseBooleanInput('', false)).toBe(false);
  });

  test('"true" (case-insensitive) maps to true', () => {
    expect(parseBooleanInput('true', false)).toBe(true);
    expect(parseBooleanInput('TRUE', false)).toBe(true);
    expect(parseBooleanInput('True', false)).toBe(true);
  });

  test('"false" (case-insensitive) maps to false', () => {
    expect(parseBooleanInput('false', true)).toBe(false);
    expect(parseBooleanInput('FALSE', true)).toBe(false);
  });

  test('any other non-empty string maps to false (defaulting-on-truthy only matches "true")', () => {
    expect(parseBooleanInput('yes', true)).toBe(false);
    expect(parseBooleanInput('1', true)).toBe(false);
    expect(parseBooleanInput('on', true)).toBe(false);
    expect(parseBooleanInput('garbage', true)).toBe(false);
  });
});

describe('parsePositiveIntInput', () => {
  test('returns undefined for empty input', () => {
    expect(parsePositiveIntInput('')).toBeUndefined();
  });

  test('returns the integer for positive numeric input', () => {
    expect(parsePositiveIntInput('1')).toBe(1);
    expect(parsePositiveIntInput('500')).toBe(500);
    expect(parsePositiveIntInput('204800')).toBe(204800);
  });

  test('returns undefined for zero', () => {
    expect(parsePositiveIntInput('0')).toBeUndefined();
  });

  test('returns undefined for negative numbers', () => {
    expect(parsePositiveIntInput('-1')).toBeUndefined();
    expect(parsePositiveIntInput('-1000')).toBeUndefined();
  });

  test('returns undefined for non-numeric strings', () => {
    expect(parsePositiveIntInput('not-a-number')).toBeUndefined();
    expect(parsePositiveIntInput('1e5')).toBe(1); // parseInt stops at 'e'
    expect(parsePositiveIntInput('abc')).toBeUndefined();
  });
});

describe('parseStringListInput', () => {
  test('returns undefined for empty input', () => {
    expect(parseStringListInput('', '\n')).toBeUndefined();
  });

  test('splits a newline-separated list', () => {
    expect(parseStringListInput('a\nb\nc', '\n')).toEqual(['a', 'b', 'c']);
  });

  test('splits a whitespace-separated list', () => {
    expect(parseStringListInput('a b  c', /\s+/)).toEqual(['a', 'b', 'c']);
    expect(parseStringListInput('a\tb\tc', /\s+/)).toEqual(['a', 'b', 'c']);
  });

  test('trims whitespace around items', () => {
    expect(parseStringListInput(' a \n b \n c ', '\n')).toEqual(['a', 'b', 'c']);
  });

  test('drops empty items', () => {
    expect(parseStringListInput('a\n\nb', '\n')).toEqual(['a', 'b']);
    expect(parseStringListInput('a  b', /\s+/)).toEqual(['a', 'b']);
  });

  test('returns undefined when all items are empty/whitespace', () => {
    expect(parseStringListInput('   ', '\n')).toBeUndefined();
    expect(parseStringListInput('   ', /\s+/)).toBeUndefined();
  });

  test('supports a custom RegExp separator (commas)', () => {
    expect(parseStringListInput('a,b , c', ',')).toEqual(['a', 'b', 'c']);
  });
});

describe('parseLoadedTools', () => {
  test('returns undefined for empty input', () => {
    expect(parseLoadedTools('')).toBeUndefined();
  });

  test('returns undefined for whitespace-only input', () => {
    expect(parseLoadedTools('   ')).toBeUndefined();
    expect(parseLoadedTools('\n\n')).toBeUndefined();
  });

  test('returns undefined for the "all" keyword (case-insensitive)', () => {
    expect(parseLoadedTools('all')).toBeUndefined();
    expect(parseLoadedTools('ALL')).toBeUndefined();
    expect(parseLoadedTools('All')).toBeUndefined();
  });

  test('parses a newline-separated tool list', () => {
    expect(parseLoadedTools('read\nwrite\ngrep')).toEqual(['read', 'write', 'grep']);
  });

  test('trims whitespace around tool names', () => {
    expect(parseLoadedTools(' read \n write ')).toEqual(['read', 'write']);
  });

  test('drops empty items', () => {
    expect(parseLoadedTools('read\n\nwrite')).toEqual(['read', 'write']);
  });

  test('deduplicates tool names while preserving order', () => {
    expect(parseLoadedTools('read\nwrite\nread\nbash')).toEqual(['read', 'write', 'bash']);
  });

  test('returns undefined when only empty items remain after parsing', () => {
    expect(parseLoadedTools('\n\n')).toBeUndefined();
  });
});

describe('parseMcpServers', () => {
  test('returns undefined for empty/whitespace input', () => {
    expect(parseMcpServers('')).toBeUndefined();
    expect(parseMcpServers('   ')).toBeUndefined();
  });

  test('parses a bare servers map (stdio + http)', () => {
    const raw = JSON.stringify({
      filesystem: { command: 'npx', args: ['-y', 'server-filesystem'] },
      docs: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${DOCS}' } },
    });
    const parsed = parseMcpServers(raw);
    expect(parsed?.servers).toHaveProperty('filesystem');
    expect(parsed?.servers).toHaveProperty('docs');
    expect(parsed?.autoEnableCodemode).toBeUndefined();
  });

  test('parses the full mcp.json shape with autoEnableCodemode', () => {
    const raw = JSON.stringify({
      mcpServers: { docs: { url: 'https://example.com/mcp' } },
      autoEnableCodemode: false,
    });
    const parsed = parseMcpServers(raw);
    expect(Object.keys(parsed?.servers ?? {})).toEqual(['docs']);
    expect(parsed?.autoEnableCodemode).toBe(false);
  });

  test('throws on malformed JSON', () => {
    expect(() => parseMcpServers('{not json')).toThrow(/Invalid `mcp_servers` JSON/);
  });

  test('rejects non-object roots and mcpServers values', () => {
    expect(() => parseMcpServers('[]')).toThrow(/expected a JSON object/);
    expect(() => parseMcpServers('"nope"')).toThrow(/expected a JSON object/);
    expect(() => parseMcpServers(JSON.stringify({ mcpServers: [] }))).toThrow(
      /`mcpServers` must be a JSON object/
    );
  });

  test('rejects a server without command or url', () => {
    expect(() => parseMcpServers(JSON.stringify({ broken: { type: 'stdio' } }))).toThrow(
      /Invalid MCP server "broken"/
    );
  });

  test('rejects a server that sets both command and url', () => {
    expect(() =>
      parseMcpServers(JSON.stringify({ broken: { command: 'x', url: 'https://x' } }))
    ).toThrow(/Invalid MCP server "broken": both "command" and "url" set/);
  });

  test('rejects a server entry that is not an object', () => {
    expect(() => parseMcpServers(JSON.stringify({ broken: 'not-an-object' }))).toThrow(
      /Invalid MCP server "broken": expected a JSON object/
    );
  });

  test('rejects a non-boolean autoEnableCodemode', () => {
    expect(() =>
      parseMcpServers(
        JSON.stringify({ mcpServers: { docs: { url: 'https://x' } }, autoEnableCodemode: 'yes' })
      )
    ).toThrow(/autoEnableCodemode` must be a boolean/);
  });
});

describe('validateRequiredInputs', () => {
  test('does not throw when both provider and model are non-empty', () => {
    expect(() => validateRequiredInputs('anthropic', 'claude-sonnet-4-5')).not.toThrow();
  });

  test('throws the documented missing-provider message when provider is empty', () => {
    expect(() => validateRequiredInputs('', 'claude-sonnet-4-5')).toThrow(MISSING_PROVIDER_MESSAGE);
  });

  test('throws the documented missing-model message when model is empty', () => {
    expect(() => validateRequiredInputs('anthropic', '')).toThrow(MISSING_MODEL_MESSAGE);
  });

  test('provider validation runs before model validation', () => {
    // Both empty — should see the provider error, not the model one.
    expect(() => validateRequiredInputs('', '')).toThrow(MISSING_PROVIDER_MESSAGE);
  });

  test('error messages mention the documented values', () => {
    expect(MISSING_PROVIDER_MESSAGE).toMatch(/anthropic/);
    expect(MISSING_PROVIDER_MESSAGE).toMatch(/openai/);
    expect(MISSING_PROVIDER_MESSAGE).toMatch(/google/);
    expect(MISSING_MODEL_MESSAGE).toMatch(/claude-sonnet-4-5/);
    expect(MISSING_MODEL_MESSAGE).toMatch(/gpt-4o/);
  });
});

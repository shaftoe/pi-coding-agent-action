import { describe, expect, test } from 'bun:test';
import { SYSTEM_PROMPT } from './prompt';

describe('SYSTEM_PROMPT', () => {
  test('is a non-empty string', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  test('mentions GitHub Actions context', () => {
    expect(SYSTEM_PROMPT).toContain('GitHub Actions');
  });

  test('mentions code review', () => {
    expect(SYSTEM_PROMPT).toContain('code review');
  });

  test('mentions non-interactive nature', () => {
    expect(SYSTEM_PROMPT).toContain('non-interactive');
  });
});

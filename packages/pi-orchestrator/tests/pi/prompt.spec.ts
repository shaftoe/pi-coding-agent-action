/**
 * Tests for platform-aware system prompt generation.
 *
 * Verifies that {@link getSystemPrompt} dynamically reflects the platform
 * the agent is running on (GitHub, Codeberg, Forgejo) instead of always
 * saying "GitHub Actions".
 */

import { describe, expect, test } from 'bun:test';
import { getSystemPrompt, SYSTEM_PROMPT } from '@alexanderfortin/pi-orchestrator';
import type { PlatformType } from '@alexanderfortin/pi-orchestrator';

describe('getSystemPrompt', () => {
  test('defaults to GitHub when no platform is given', () => {
    const prompt = getSystemPrompt();

    expect(prompt).toContain('GitHub Actions CI/CD environment');
    expect(prompt).toContain('a GitHub PR or issue');
  });

  test('returns GitHub prompt for "github" platform', () => {
    const prompt = getSystemPrompt('github');

    expect(prompt).toContain('GitHub Actions CI/CD environment');
    expect(prompt).toContain('a GitHub PR or issue');
    expect(prompt).not.toContain('Forgejo');
    expect(prompt).not.toContain('Codeberg');
  });

  test('returns Forgejo prompt for "forgejo" platform', () => {
    const prompt = getSystemPrompt('forgejo');

    expect(prompt).toContain('Forgejo Actions CI/CD environment');
    expect(prompt).toContain('a Forgejo PR or issue');
    expect(prompt).not.toContain('GitHub');
    expect(prompt).not.toContain('Codeberg');
  });

  test('returns Codeberg prompt for "codeberg" platform', () => {
    const prompt = getSystemPrompt('codeberg');

    expect(prompt).toContain('Codeberg CI/CD environment');
    expect(prompt).toContain('a Codeberg PR or issue');
    expect(prompt).not.toContain('GitHub');
    expect(prompt).not.toContain('Forgejo');
  });

  test('produces a different prompt for each platform', () => {
    const platforms: PlatformType[] = ['github', 'codeberg', 'forgejo'];
    const prompts = platforms.map(p => getSystemPrompt(p));

    // All three prompts should be unique
    expect(new Set(prompts).size).toBe(3);
  });

  test('preserves shared guidance text across all platforms', () => {
    const sharedFragments = [
      'You are a non-interactive assistant running in',
      'You are usually tasked with code reviews and generating code changes.',
      'You will not interact with the user directly.',
      'The output (or error) you generate will be sent back as comment to the user.',
      'Avoid if possible long preambles about what you are going to do to achieve the goal,',
      'focus on the final result instead,',
      'IMPORTANT: Do NOT add any footer, signature, metadata, "View action run" text,',
      'A footer will be appended automatically - only output your actual response content.',
    ];

    for (const platform of ['github', 'codeberg', 'forgejo'] as PlatformType[]) {
      const prompt = getSystemPrompt(platform);
      for (const fragment of sharedFragments) {
        expect(prompt).toContain(fragment);
      }
    }
  });
});

describe('SYSTEM_PROMPT (backward compatibility)', () => {
  test('equals the GitHub platform prompt', () => {
    expect(SYSTEM_PROMPT).toBe(getSystemPrompt('github'));
  });

  test('contains GitHub Actions reference', () => {
    expect(SYSTEM_PROMPT).toContain('GitHub Actions CI/CD environment');
    expect(SYSTEM_PROMPT).toContain('a GitHub PR or issue');
  });
});

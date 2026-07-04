/**
 * Tests for platform-aware prompt generation.
 *
 * Verifies that {@link getSystemPrompt} and the per-tool description/guideline
 * builders dynamically reflect the platform the agent is running on (GitHub,
 * Codeberg, Forgejo) instead of always saying "GitHub".
 *
 * The platform list is derived from {@link SUPPORTED_PLATFORMS} (itself
 * derived from the exhaustive `Record<PlatformType, ...>` in `prompt.ts`)
 * so these tests automatically cover any platform added in the future.
 */

import { describe, expect, test } from 'bun:test';
// Public API (also doubles as a smoke test that the barrel re-exports resolve).
import {
  getSystemPrompt,
  SYSTEM_PROMPT,
  SUPPORTED_PLATFORMS,
} from '@alexanderfortin/pi-orchestrator';
import type { PlatformType } from '@alexanderfortin/pi-orchestrator';
// Internal tool-description builders (kept out of the public barrel).
import {
  getCreatePullRequestDescription,
  getIssueOrPRThreadDescription,
  getIssueOrPRThreadPromptSnippet,
  getPRDiffDescription,
  getCreateReviewDescription,
  getWorkflowRunLogsDescription,
  getCiStatusPromptGuidelines,
  getPRDiffPromptGuidelines,
  getUpdatePullRequestPromptGuidelines,
  getIssueOrPRThreadPromptGuidelines,
} from '../../src/pi/prompt';

/** Display names expected per platform (also enforced by `SUPPORTED_PLATFORMS`). */
const EXPECTED_PRODUCT_NAME: Record<PlatformType, string> = {
  github: 'GitHub',
  codeberg: 'Codeberg',
  forgejo: 'Forgejo',
};

describe('SUPPORTED_PLATFORMS', () => {
  test('covers the expected set of platforms', () => {
    expect(SUPPORTED_PLATFORMS).toContain('github');
    expect(SUPPORTED_PLATFORMS).toContain('codeberg');
    expect(SUPPORTED_PLATFORMS).toContain('forgejo');
  });
});

describe('getSystemPrompt', () => {
  test('defaults to GitHub when no platform is given', () => {
    const prompt = getSystemPrompt();

    expect(prompt).toContain('GitHub Actions CI/CD environment');
    expect(prompt).toContain('a GitHub PR or issue');
  });

  test('returns the correct prompt for every supported platform', () => {
    // Iterating over SUPPORTED_PLATFORMS means a newly added platform is
    // automatically covered here.
    for (const platform of SUPPORTED_PLATFORMS) {
      const prompt = getSystemPrompt(platform);
      const name = EXPECTED_PRODUCT_NAME[platform];

      expect(prompt).toContain(name);
    }
  });

  test('produces a unique prompt per platform', () => {
    const prompts = SUPPORTED_PLATFORMS.map(p => getSystemPrompt(p));

    // As many distinct prompts as there are platforms.
    expect(new Set(prompts).size).toBe(SUPPORTED_PLATFORMS.length);
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

    for (const platform of SUPPORTED_PLATFORMS) {
      const prompt = getSystemPrompt(platform);
      for (const fragment of sharedFragments) {
        expect(prompt).toContain(fragment);
      }
    }
  });

  test('never references a different platform than the one requested', () => {
    for (const platform of SUPPORTED_PLATFORMS) {
      const prompt = getSystemPrompt(platform);
      for (const other of SUPPORTED_PLATFORMS) {
        if (other === platform) {
          continue;
        }
        expect(prompt).not.toContain(EXPECTED_PRODUCT_NAME[other]);
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

/**
 * The tool description / guideline builders must also be platform-aware so
 * the model does not see pervasive "GitHub" references when running on
 * Codeberg or Forgejo (see #365).
 */
describe('platform-aware tool descriptions & guidelines', () => {
  /** String builders that interpolate the product name. */
  const stringBuilders: ((p: PlatformType) => string)[] = [
    getCreatePullRequestDescription,
    getIssueOrPRThreadPromptSnippet,
    getIssueOrPRThreadDescription,
    getPRDiffDescription,
    getCreateReviewDescription,
    getWorkflowRunLogsDescription,
  ];

  /** Array builders whose guidelines reference the platform "context". */
  const arrayBuilders: ((p: PlatformType) => string[])[] = [
    getIssueOrPRThreadPromptGuidelines,
    getUpdatePullRequestPromptGuidelines,
    getPRDiffPromptGuidelines,
    getCiStatusPromptGuidelines,
  ];

  test('string builders reference the requested product name for every platform', () => {
    for (const build of stringBuilders) {
      for (const platform of SUPPORTED_PLATFORMS) {
        const value = build(platform);
        expect(value).toContain(EXPECTED_PRODUCT_NAME[platform]);
      }
      // Sanity: distinct output per platform.
      const outputs = SUPPORTED_PLATFORMS.map(build);
      expect(new Set(outputs).size).toBe(SUPPORTED_PLATFORMS.length);
    }
  });

  test('string builders never mention a different product than requested', () => {
    for (const build of stringBuilders) {
      for (const platform of SUPPORTED_PLATFORMS) {
        const value = build(platform);
        for (const other of SUPPORTED_PLATFORMS) {
          if (other === platform) {
            continue;
          }
          expect(value).not.toContain(EXPECTED_PRODUCT_NAME[other]);
        }
      }
    }
  });

  test('array builders reference the requested product name for every platform', () => {
    for (const build of arrayBuilders) {
      for (const platform of SUPPORTED_PLATFORMS) {
        const value = build(platform);
        // At least one guideline line should mention the product name.
        expect(value.join('\n')).toContain(EXPECTED_PRODUCT_NAME[platform]);
      }
    }
  });

  test('array builders never mention a different product than requested', () => {
    for (const build of arrayBuilders) {
      for (const platform of SUPPORTED_PLATFORMS) {
        const joined = build(platform).join('\n');
        for (const other of SUPPORTED_PLATFORMS) {
          if (other === platform) {
            continue;
          }
          expect(joined).not.toContain(EXPECTED_PRODUCT_NAME[other]);
        }
      }
    }
  });
});

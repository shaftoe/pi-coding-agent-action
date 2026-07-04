/**
 * Tests for platform-aware prompt generation.
 *
 * Verifies that the system prompt and all tool descriptions/guidelines
 * dynamically reflect the platform the agent is running on (GitHub,
 * Codeberg, Forgejo) instead of always saying "GitHub Actions".
 *
 * The supported-platform list is derived from {@link getSupportedPlatforms}
 * (the runtime source of truth in `prompt.ts`) rather than hardcoded here,
 * so these tests automatically cover any platform added in the future.
 */

import { describe, expect, test } from 'bun:test';
import {
  getSystemPrompt,
  getSupportedPlatforms,
  SYSTEM_PROMPT,
} from '@alexanderfortin/pi-orchestrator';
import type { PlatformType } from '@alexanderfortin/pi-orchestrator';
import {
  CREATE_PULL_REQUEST_DESCRIPTION,
  CREATE_REVIEW_DESCRIPTION,
  GET_CI_STATUS_PROMPT_GUIDELINES,
  GET_ISSUE_PR_THREAD_DESCRIPTION,
  GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES,
  GET_ISSUE_PR_THREAD_PROMPT_SNIPPET,
  GET_PR_DIFF_DESCRIPTION,
  GET_PR_DIFF_PROMPT_GUIDELINES,
  GET_WORKFLOW_RUN_LOGS_DESCRIPTION,
  UPDATE_PULL_REQUEST_PROMPT_GUIDELINES,
} from '../../src/pi/prompt';

/** Expected short product name per platform (assertions, not data source). */
const EXPECTED_PRODUCT: Record<PlatformType, string> = {
  github: 'GitHub',
  codeberg: 'Codeberg',
  forgejo: 'Forgejo',
};

/** All product names, used to verify no cross-platform leakage. */
const ALL_PRODUCTS = Object.values(EXPECTED_PRODUCT);

describe('getSupportedPlatforms', () => {
  test('returns every known platform', () => {
    const platforms = getSupportedPlatforms();
    expect(platforms).toContain('github');
    expect(platforms).toContain('codeberg');
    expect(platforms).toContain('forgejo');
  });

  test('returns a non-empty list', () => {
    expect(getSupportedPlatforms().length).toBeGreaterThan(0);
  });
});

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
    const platforms = getSupportedPlatforms();
    const prompts = platforms.map(p => getSystemPrompt(p));

    // Each platform should yield a unique prompt.
    expect(new Set(prompts).size).toBe(platforms.length);
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

    for (const platform of getSupportedPlatforms()) {
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

describe('platform-aware tool descriptions & guidelines', () => {
  // Builders whose output is a single string.
  const stringBuilders: { label: string; build: (p: PlatformType) => string }[] = [
    { label: 'CREATE_PULL_REQUEST_DESCRIPTION', build: p => CREATE_PULL_REQUEST_DESCRIPTION(p) },
    {
      label: 'GET_ISSUE_PR_THREAD_PROMPT_SNIPPET',
      build: p => GET_ISSUE_PR_THREAD_PROMPT_SNIPPET(p),
    },
    { label: 'GET_ISSUE_PR_THREAD_DESCRIPTION', build: p => GET_ISSUE_PR_THREAD_DESCRIPTION(p) },
    { label: 'GET_PR_DIFF_DESCRIPTION', build: p => GET_PR_DIFF_DESCRIPTION(p) },
    { label: 'CREATE_REVIEW_DESCRIPTION', build: p => CREATE_REVIEW_DESCRIPTION(p) },
    {
      label: 'GET_WORKFLOW_RUN_LOGS_DESCRIPTION',
      build: p => GET_WORKFLOW_RUN_LOGS_DESCRIPTION(p),
    },
  ];

  // Builders whose output is an array of guideline strings (joined for checks).
  const arrayBuilders: { label: string; build: (p: PlatformType) => string[] }[] = [
    {
      label: 'GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES',
      build: p => GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES(p),
    },
    {
      label: 'UPDATE_PULL_REQUEST_PROMPT_GUIDELINES',
      build: p => UPDATE_PULL_REQUEST_PROMPT_GUIDELINES(p),
    },
    { label: 'GET_PR_DIFF_PROMPT_GUIDELINES', build: p => GET_PR_DIFF_PROMPT_GUIDELINES(p) },
    { label: 'GET_CI_STATUS_PROMPT_GUIDELINES', build: p => GET_CI_STATUS_PROMPT_GUIDELINES(p) },
  ];

  for (const platform of getSupportedPlatforms()) {
    const product = EXPECTED_PRODUCT[platform];
    const otherProducts = ALL_PRODUCTS.filter(name => name !== product);

    describe(`${platform}`, () => {
      test('string builders reference the active product name', () => {
        for (const { build } of stringBuilders) {
          const text = build(platform);
          expect(text).toContain(product);
          for (const other of otherProducts) {
            expect(text).not.toContain(other);
          }
        }
      });

      test('array guidelines reference the active product name', () => {
        for (const { build } of arrayBuilders) {
          const text = build(platform).join('\n');
          expect(text).toContain(`${product} context`);
          for (const other of otherProducts) {
            expect(text).not.toContain(`${other} context`);
          }
        }
      });
    });
  }

  test('each builder yields a distinct value per platform', () => {
    const platforms = getSupportedPlatforms();
    const allBuilders = [
      ...stringBuilders.map(({ build }) => build),
      ...arrayBuilders.map(
        ({ build }) =>
          (p: PlatformType) =>
            build(p).join('\n')
      ),
    ];
    for (const build of allBuilders) {
      const values = platforms.map(p => build(p));
      expect(new Set(values).size).toBe(platforms.length);
    }
  });

  test('string builders default to GitHub when no platform is given', () => {
    expect(CREATE_PULL_REQUEST_DESCRIPTION()).toContain('GitHub');
    expect(GET_ISSUE_PR_THREAD_PROMPT_SNIPPET()).toContain('GitHub');
    expect(GET_ISSUE_PR_THREAD_DESCRIPTION()).toContain('GitHub');
    expect(GET_PR_DIFF_DESCRIPTION()).toContain('GitHub');
    expect(CREATE_REVIEW_DESCRIPTION()).toContain('GitHub');
    expect(GET_WORKFLOW_RUN_LOGS_DESCRIPTION()).toContain('GitHub Actions');
  });

  test('array guidelines default to GitHub when no platform is given', () => {
    expect(GET_ISSUE_PR_THREAD_PROMPT_GUIDELINES().join('\n')).toContain('GitHub context');
    expect(UPDATE_PULL_REQUEST_PROMPT_GUIDELINES().join('\n')).toContain('GitHub context');
    expect(GET_PR_DIFF_PROMPT_GUIDELINES().join('\n')).toContain('GitHub context');
    expect(GET_CI_STATUS_PROMPT_GUIDELINES().join('\n')).toContain('GitHub context');
  });

  test('create review keeps the pulls.createReview API reference for all platforms', () => {
    for (const platform of getSupportedPlatforms()) {
      expect(CREATE_REVIEW_DESCRIPTION(platform)).toContain('`pulls.createReview`');
    }
  });

  test('workflow run logs keeps the "Actions" runner label for all platforms', () => {
    for (const platform of getSupportedPlatforms()) {
      const product = EXPECTED_PRODUCT[platform];
      expect(GET_WORKFLOW_RUN_LOGS_DESCRIPTION(platform)).toContain(
        `${product} Actions workflow run`
      );
    }
  });

  test('no builder output leaks the GitHub brand on non-GitHub platforms', () => {
    const nonGithub = getSupportedPlatforms().filter(p => p !== 'github');
    const allBuilders: ((p: PlatformType) => string)[] = [
      ...stringBuilders.map(({ build }) => build),
      ...arrayBuilders.map(
        ({ build }) =>
          (p: PlatformType) =>
            build(p).join('\n')
      ),
    ];
    for (const platform of nonGithub) {
      for (const build of allBuilders) {
        expect(build(platform)).not.toContain('GitHub');
      }
    }
  });
});

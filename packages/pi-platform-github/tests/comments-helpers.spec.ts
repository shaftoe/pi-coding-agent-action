/**
 * Unit tests for the pure metadata/footer helpers exported from
 * `packages/pi-platform-github/src/comments.ts`.
 *
 * These complement `comments.spec.ts`, which tests `createFinalComment`
 * end-to-end via the Octokit mock. Each helper here is a pure function
 * over a fake `GitHubModuleDeps` context + `CommentMetadata` object.
 */

import { describe, expect, test } from 'bun:test';
import { Temporal } from '@js-temporal/polyfill';
import type { GitHubModuleDeps } from '@alexanderfortin/pi-platform-github';
import type { CommentMetadata } from '@alexanderfortin/pi-orchestrator';
import {
  buildActionRunUrl,
  buildMetadataFooter,
  formatModelMetadata,
  formatSessionStatsLines,
} from '@alexanderfortin/pi-platform-github/comments';

/** Build a minimal `deps` with the context fields under test. */
function buildDeps(
  overrides: {
    owner?: string;
    repo?: string;
    runId?: number;
    serverUrl?: string;
  } = {}
): GitHubModuleDeps {
  const {
    owner = 'test-owner',
    repo = 'test-repo',
    runId = 12345,
    serverUrl = 'https://github.com',
  } = overrides;
  return {
    octokit: {} as any,
    context: {
      repo: { owner, repo },
      issue: { number: 42 },
      eventName: 'pull_request',
      payload: {},
      serverUrl,
      runId,
      workspace: '/tmp',
    },
    logger: {
      debug: () => {},
      info: () => {},
      warning: () => {},
      notice: () => {},
      error: () => {},
    },
  };
}

function buildMetadata(overrides: Partial<CommentMetadata> = {}): CommentMetadata {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    executionDuration: Temporal.Duration.from({ seconds: 30 }),
    ...overrides,
  };
}

/** Build a complete `SessionStats` object, allowing selective overrides. */
function buildStats(
  overrides: Partial<{
    totalTokens: number;
    cost: number;
    version: string;
    inputTokens: number;
    outputTokens: number;
  }> = {}
): NonNullable<CommentMetadata['sessionStats']> {
  return {
    inputTokens: 50,
    outputTokens: 50,
    totalTokens: 100,
    cost: 0,
    version: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildActionRunUrl
// ---------------------------------------------------------------------------

describe('buildActionRunUrl', () => {
  test('returns the standard Actions URL with all fields populated', () => {
    const url = buildActionRunUrl(buildDeps({ owner: 'me', repo: 'mine', runId: 99 }));
    expect(url).toBe('https://github.com/me/mine/actions/runs/99');
  });

  test('uses the serverUrl when provided (e.g. GHE)', () => {
    const url = buildActionRunUrl(buildDeps({ serverUrl: 'https://ghe.example.com' }));
    expect(url?.startsWith('https://ghe.example.com/')).toBe(true);
  });

  test('falls back to https://github.com when serverUrl is empty', () => {
    const url = buildActionRunUrl(buildDeps({ serverUrl: '' }));
    expect(url?.startsWith('https://github.com/')).toBe(true);
  });

  test('returns undefined when owner is missing', () => {
    expect(buildActionRunUrl(buildDeps({ owner: '' }))).toBeUndefined();
  });

  test('returns undefined when repo is missing', () => {
    expect(buildActionRunUrl(buildDeps({ repo: '' }))).toBeUndefined();
  });

  test('returns undefined when runId is missing (0)', () => {
    expect(buildActionRunUrl(buildDeps({ runId: 0 }))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatModelMetadata
// ---------------------------------------------------------------------------

describe('formatModelMetadata', () => {
  test('returns provider/model when both are present, no thinking level', () => {
    const { thinkingLevel: _, ...metadata } = buildMetadata();
    expect(formatModelMetadata(metadata)).toBe('Model: anthropic/claude-sonnet-4-5');
  });

  test('omits thinking level when set to "off"', () => {
    expect(formatModelMetadata(buildMetadata({ thinkingLevel: 'off' }))).toBe(
      'Model: anthropic/claude-sonnet-4-5'
    );
  });

  test('includes thinking level when set to a non-off value', () => {
    expect(formatModelMetadata(buildMetadata({ thinkingLevel: 'medium' }))).toBe(
      'Model: anthropic/claude-sonnet-4-5 (thinking: medium)'
    );
  });

  test('returns undefined when provider is missing', () => {
    expect(formatModelMetadata(buildMetadata({ provider: '' }))).toBeUndefined();
  });

  test('returns undefined when model is missing', () => {
    expect(formatModelMetadata(buildMetadata({ model: '' }))).toBeUndefined();
  });

  test('returns undefined when both provider and model are missing', () => {
    expect(formatModelMetadata(buildMetadata({ provider: '', model: '' }))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatSessionStatsLines
// ---------------------------------------------------------------------------

describe('formatSessionStatsLines', () => {
  test('returns [] when sessionStats is undefined', () => {
    const { sessionStats: _, ...metadata } = buildMetadata();
    expect(formatSessionStatsLines(metadata)).toEqual([]);
  });

  test('returns Tokens only when cost is 0 and no version', () => {
    const result = formatSessionStatsLines(
      buildMetadata({ sessionStats: buildStats({ totalTokens: 1234, cost: 0, version: '' }) })
    );
    expect(result).toEqual(['Tokens: 1.2K']);
  });

  test('includes Cost line when cost > 0', () => {
    const result = formatSessionStatsLines(
      buildMetadata({ sessionStats: buildStats({ totalTokens: 100, cost: 0.05 }) })
    );
    expect(result).toContain('Cost: $0.05');
  });

  test('normalizes negative cost via Math.abs (ppq.ai convention)', () => {
    const result = formatSessionStatsLines(
      buildMetadata({ sessionStats: buildStats({ totalTokens: 100, cost: -0.12 }) })
    );
    expect(result).toContain('Cost: $0.12');
  });

  test('omits Cost when tiny positive cost rounds to zero at 2 decimals', () => {
    // 0.001 > 0 but toFixed(2) rounds to "0.00" — shared formatCost helper
    // rounds before the threshold check, so the Cost line is omitted.
    const result = formatSessionStatsLines(
      buildMetadata({ sessionStats: buildStats({ totalTokens: 100, cost: 0.001, version: '' }) })
    );
    expect(result).toEqual(['Tokens: 100']);
  });

  test('includes Pi SDK version when present', () => {
    const result = formatSessionStatsLines(
      buildMetadata({ sessionStats: buildStats({ totalTokens: 100, cost: 0, version: '1.2.3' }) })
    );
    expect(result).toContain('Pi SDK v1.2.3');
  });

  test('orders parts: Tokens, Cost, Pi SDK version', () => {
    const result = formatSessionStatsLines(
      buildMetadata({
        sessionStats: buildStats({ totalTokens: 5000, cost: 0.5, version: '9.9.9' }),
      })
    );
    expect(result).toEqual(['Tokens: 5.0K', 'Cost: $0.50', 'Pi SDK v9.9.9']);
  });
});

// ---------------------------------------------------------------------------
// buildMetadataFooter
// ---------------------------------------------------------------------------

describe('buildMetadataFooter', () => {
  test('returns undefined when no action-run URL is buildable', () => {
    const deps = buildDeps({ runId: 0 });
    expect(buildMetadataFooter(deps, buildMetadata())).toBeUndefined();
  });

  test('always starts with the action-run link', () => {
    const footer = buildMetadataFooter(buildDeps(), buildMetadata());
    expect(footer?.startsWith('[View action run](https://github.com/')).toBe(true);
  });

  test('omits model line when metadata is undefined', () => {
    const footer = buildMetadataFooter(buildDeps(), undefined);
    expect(footer).toBe(
      '[View action run](https://github.com/test-owner/test-repo/actions/runs/12345)'
    );
  });

  test('joins parts with " | "', () => {
    const footer = buildMetadataFooter(
      buildDeps(),
      buildMetadata({
        executionDuration: Temporal.Duration.from({ seconds: 5 }),
        sessionStats: buildStats({ totalTokens: 100, cost: 0 }),
      })
    );
    expect(footer).toContain(' | ');
    expect(footer?.split(' | ')[0]).toMatch(/^\[View action run\]/);
  });

  test('includes model + time + tokens when all are present', () => {
    const footer = buildMetadataFooter(
      buildDeps(),
      buildMetadata({
        thinkingLevel: 'high',
        executionDuration: Temporal.Duration.from({ minutes: 2, seconds: 30 }),
        sessionStats: buildStats({ totalTokens: 12_345, cost: 0.15 }),
      })
    );
    expect(footer).toContain('Model: anthropic/claude-sonnet-4-5 (thinking: high)');
    expect(footer).toContain('Time: 2m 30s');
    expect(footer).toContain('Tokens: 12.3K');
    expect(footer).toContain('Cost: $0.15');
  });

  test('includes Action v… when actionVersion is set', () => {
    const footer = buildMetadataFooter(buildDeps(), buildMetadata({ actionVersion: '2.1.0' }));
    expect(footer).toContain('Action v2.1.0');
  });

  test('does not include Action v… when actionVersion is undefined', () => {
    const footer = buildMetadataFooter(buildDeps(), buildMetadata());
    expect(footer).not.toMatch(/Action v/);
  });

  test('omits Time line when executionDuration is undefined', () => {
    const { executionDuration: _, ...withoutDuration } = buildMetadata();
    const footer = buildMetadataFooter(buildDeps(), withoutDuration);
    expect(footer).not.toMatch(/\bTime:/);
  });

  test('uses default serverUrl when context.serverUrl is empty', () => {
    const footer = buildMetadataFooter(buildDeps({ serverUrl: '' }), undefined);
    expect(footer).toContain('https://github.com/test-owner/test-repo/actions/runs/12345');
  });
});

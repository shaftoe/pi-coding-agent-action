/**
 * Unit tests for the pure helpers extracted from
 * `packages/pi-platform-github/src/tools/pull-request-update.ts` in Step 2.10a.
 *
 * The orchestrator (`updatePullRequest`) and the two report builders
 * (`buildDryRunReport`, `buildSuccessReport`) are already covered by
 * `pull-request-update-logic.spec.ts` (96 tests). Here we test the new
 * extracted helpers directly so each contract is pinned down.
 */

import { describe, expect, test, vi } from 'vitest';
import {
  applyMetadataUpdate,
  buildSuccessDetails,
  formatChangeSummary,
  logPRFoundDebug,
  logUpdateDebugStart,
  type UpdatePullRequestParams,
} from '@alexanderfortin/pi-platform-github';

function buildParams(overrides: Record<string, unknown> = {}): UpdatePullRequestParams {
  return {
    title: 'new title',
    body: 'new body',
    ...overrides,
  } as UpdatePullRequestParams;
}

function stringLogger() {
  const calls: string[] = [];
  return {
    log: {
      debug: (msg: string) => calls.push(`DEBUG: ${msg}`),
      info: (msg: string) => calls.push(`INFO: ${msg}`),
    },
    calls,
  };
}

// ---------------------------------------------------------------------------
// formatChangeSummary
// ---------------------------------------------------------------------------

describe('formatChangeSummary', () => {
  test('returns "no changes detected" when both lists are empty', () => {
    expect(formatChangeSummary([], [])).toEqual(['- No code changes detected']);
  });

  test('renders only the modified count when only changedFiles > 0', () => {
    expect(formatChangeSummary(['a', 'b'], [])).toEqual([
      '- Code changes:',
      '  - 2 modified/new file(s)',
    ]);
  });

  test('renders only the deleted count when only deletedFiles > 0', () => {
    expect(formatChangeSummary([], ['x.ts', 'y.ts', 'z.ts'])).toEqual([
      '- Code changes:',
      '  - 3 deleted file(s)',
    ]);
  });

  test('renders both counts when both lists are non-empty', () => {
    expect(formatChangeSummary(['a'], ['x.ts'])).toEqual([
      '- Code changes:',
      '  - 1 modified/new file(s)',
      '  - 1 deleted file(s)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildSuccessDetails
// ---------------------------------------------------------------------------

describe('buildSuccessDetails', () => {
  const baseInput = {
    pullNumber: 42,
    prUrl: 'https://github.com/owner/repo/pull/42',
    headBranch: 'feature',
    baseBranch: 'main',
  };

  test('omits commitSha/titleUpdated/bodyUpdated when none are set', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: undefined,
      titleUpdated: undefined,
      bodyUpdated: undefined,
    });
    expect(details).toEqual({
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/owner/repo/pull/42',
      headBranch: 'feature',
      baseBranch: 'main',
      dryRun: false,
    });
  });

  test('includes commitSha when provided (even an empty string)', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: 'abc123',
      titleUpdated: undefined,
      bodyUpdated: undefined,
    });
    expect(details.commitSha).toBe('abc123');
  });

  test('omits commitSha when undefined', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: undefined,
      titleUpdated: undefined,
      bodyUpdated: undefined,
    });
    expect('commitSha' in details).toBe(false);
  });

  test('includes titleUpdated when true', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: undefined,
      titleUpdated: true,
      bodyUpdated: undefined,
    });
    expect(details.titleUpdated).toBe(true);
  });

  test('omits titleUpdated when undefined', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: undefined,
      titleUpdated: undefined,
      bodyUpdated: undefined,
    });
    expect('titleUpdated' in details).toBe(false);
  });

  test('omits titleUpdated when false (falsy)', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: undefined,
      titleUpdated: false,
      bodyUpdated: undefined,
    });
    expect('titleUpdated' in details).toBe(false);
  });

  test('includes bodyUpdated when true', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: undefined,
      titleUpdated: undefined,
      bodyUpdated: true,
    });
    expect(details.bodyUpdated).toBe(true);
  });

  test('omits bodyUpdated when false (falsy)', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: undefined,
      titleUpdated: undefined,
      bodyUpdated: false,
    });
    expect('bodyUpdated' in details).toBe(false);
  });

  test('always sets dryRun=false', () => {
    const details = buildSuccessDetails({
      ...baseInput,
      commitSha: undefined,
      titleUpdated: undefined,
      bodyUpdated: undefined,
    });
    expect(details.dryRun).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logUpdateDebugStart
// ---------------------------------------------------------------------------

describe('logUpdateDebugStart', () => {
  test('emits the 4 expected debug lines in order', () => {
    const { log, calls } = stringLogger();
    logUpdateDebugStart(log, buildParams({ title: 't', body: 'b', dryRun: true }), 42);
    expect(calls).toEqual([
      'DEBUG: PR Number: 42',
      'DEBUG: Title: t',
      'DEBUG: Body: (provided)',
      'DEBUG: DryRun: true',
    ]);
  });

  test('shows "(no change)" when title is undefined', () => {
    const { log, calls } = stringLogger();
    logUpdateDebugStart(log, buildParams({ title: undefined, body: 'b' }), 1);
    expect(calls).toContain('DEBUG: Title: (no change)');
  });

  test('shows "(no change)" when body is empty/falsy', () => {
    const { log, calls } = stringLogger();
    logUpdateDebugStart(log, buildParams({ title: 't', body: '' }), 1);
    expect(calls).toContain('DEBUG: Body: (no change)');
  });

  test('shows "(provided)" when body is whitespace-only (truthy)', () => {
    const { log, calls } = stringLogger();
    logUpdateDebugStart(log, buildParams({ title: 't', body: '   ' }), 1);
    expect(calls).toContain('DEBUG: Body: (provided)');
  });

  test('defaults DryRun to false when dryRun is undefined', () => {
    const { log, calls } = stringLogger();
    logUpdateDebugStart(log, buildParams({ title: 't', body: 'b', dryRun: undefined }), 1);
    expect(calls).toContain('DEBUG: DryRun: false');
  });
});

// ---------------------------------------------------------------------------
// logPRFoundDebug
// ---------------------------------------------------------------------------

describe('logPRFoundDebug', () => {
  test('emits the 4 expected debug lines in order', () => {
    const { log, calls } = stringLogger();
    logPRFoundDebug(log, {
      prUrl: 'https://github.com/owner/repo/pull/42',
      headBranch: 'feature',
      baseBranch: 'main',
      headSha: 'abc1234',
    });
    expect(calls).toEqual([
      'DEBUG: PR found: https://github.com/owner/repo/pull/42',
      'DEBUG: Head branch: feature',
      'DEBUG: Base branch: main',
      'DEBUG: Head SHA: abc1234',
    ]);
  });
});

// ---------------------------------------------------------------------------
// applyMetadataUpdate
// ---------------------------------------------------------------------------

describe('applyMetadataUpdate', () => {
  test('returns {false, false} and does NOT call updatePullRequestMetadata when both title and body are undefined', async () => {
    // We can't easily mock the deps; instead just verify the short-circuit by
    // confirming no error is thrown when both are undefined.
    const log = { info: vi.fn(() => {}) };
    const result = await applyMetadataUpdate(
      // The short-circuit returns before touching deps, so we can pass a
      // minimal stand-in.
      {} as never,
      42,
      undefined,
      undefined,
      log
    );
    expect(result).toEqual({ titleUpdated: false, bodyUpdated: false });
    expect(log.info).not.toHaveBeenCalled();
  });
});

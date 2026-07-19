/**
 * Unit tests for the pure body builders exported from
 * `packages/pi-orchestrator/src/orchestrator.ts`.
 *
 * These complement `orchestrator.spec.ts`, which tests the full
 * `ActionOrchestrator.execute()` pipeline end-to-end. The body builders
 * here are pure functions over strings, so we can pin down edge cases
 * (empty result, multi-line result, error-without-result) directly.
 */

import { describe, expect, test } from 'vitest';
import { buildSessionErrorBody, buildSessionSuccessBody } from '@alexanderfortin/pi-orchestrator';

// ---------------------------------------------------------------------------
// buildSessionSuccessBody
// ---------------------------------------------------------------------------

describe('buildSessionSuccessBody', () => {
  test('returns the result verbatim when non-empty', () => {
    expect(buildSessionSuccessBody('done!')).toBe('done!');
  });

  test('returns the result verbatim when it contains markdown', () => {
    const result = '## Summary\n\n- made changes\n- updated tests';
    expect(buildSessionSuccessBody(result)).toBe(result);
  });

  test('falls back to the completion message when result is empty', () => {
    expect(buildSessionSuccessBody('')).toBe('✅ Agent session completed');
  });

  test('falls back to the completion message when result is whitespace only', () => {
    // Note: the helper intentionally does NOT trim — it preserves the original
    // behavior of `result || '…'`, which treats whitespace-only strings as
    // truthy and posts them verbatim. We test both cases to document the
    // contract: a single-space result is NOT replaced.
    expect(buildSessionSuccessBody('   ')).toBe('   ');
  });
});

// ---------------------------------------------------------------------------
// buildSessionErrorBody
// ---------------------------------------------------------------------------

describe('buildSessionErrorBody', () => {
  test('returns the error-only body when result is empty', () => {
    expect(buildSessionErrorBody('', 'quota exceeded')).toBe(
      '❌ Agent session ended with error: quota exceeded'
    );
  });

  test('returns the error-only body when result is whitespace', () => {
    // Same contract as buildSessionSuccessBody — whitespace is treated as
    // truthy and the partial-result branch fires. Document the behavior.
    expect(buildSessionErrorBody('   ', 'rate limited')).toBe(
      '   \n\n---\n\n❌ Agent session ended with error: rate limited'
    );
  });

  test('prepends the partial result + separator when result is non-empty', () => {
    const body = buildSessionErrorBody('partial output', 'context length exceeded');
    expect(body).toBe(
      'partial output\n\n---\n\n❌ Agent session ended with error: context length exceeded'
    );
  });

  test('preserves multi-line / markdown in the partial result', () => {
    const result = '## Changes\n\n- fixed bug\n- added tests';
    const body = buildSessionErrorBody(result, 'oops');
    expect(body.startsWith(result)).toBe(true);
    expect(body).toContain('---');
    expect(body).toContain('❌ Agent session ended with error: oops');
  });

  test('renders the error verbatim (no escaping)', () => {
    expect(buildSessionErrorBody('', 'an error with `backticks` and $symbols')).toBe(
      '❌ Agent session ended with error: an error with `backticks` and $symbols'
    );
  });

  test('does not collapse multiple blank lines in the result', () => {
    const body = buildSessionErrorBody('line1\n\n\nline3', 'err');
    expect(body).toContain('line1\n\n\nline3');
  });
});

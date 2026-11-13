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
import {
  buildCollapsedBody,
  buildSessionErrorBody,
  buildSessionSuccessBody,
} from '@alexanderfortin/pi-orchestrator';

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

// ---------------------------------------------------------------------------
// buildCollapsedBody
// ---------------------------------------------------------------------------

describe('buildCollapsedBody', () => {
  test('returns an empty string for no messages', () => {
    expect(buildCollapsedBody([])).toBe('');
  });

  test('returns a single message verbatim without a details block', () => {
    expect(buildCollapsedBody(['final answer'])).toBe('final answer');
  });

  test('folds intermediate messages and leaves only the last one outside', () => {
    const body = buildCollapsedBody(['checking the diff', 'running the tests', '## All green']);
    expect(body).toBe(
      '<details>\n<summary>Intermediate output</summary>\n\n' +
        'checking the diff\n\nrunning the tests\n\n</details>\n\n## All green'
    );
  });

  test('keeps paragraphs intact inside the collapsed block', () => {
    const intermediate = 'first paragraph\n\nsecond paragraph';
    const body = buildCollapsedBody([intermediate, 'done']);
    expect(body).toContain('<summary>Intermediate output</summary>\n\nfirst paragraph');
    expect(body).toContain('second paragraph\n\n</details>');
  });

  test('keeps fenced code blocks renderable inside the collapsed block', () => {
    const body = buildCollapsedBody(['```diff\n-old\n+new\n```', 'applied']);
    expect(body).toContain('<summary>Intermediate output</summary>\n\n```diff');
    expect(body).toContain('```\n\n</details>\n\napplied');
  });

  test('treats the last message as the final output even when it is long markdown', () => {
    const final = '## Report\n\n- item 1\n- item 2\n\n```js\nconsole.log(1);\n```';
    const body = buildCollapsedBody(['checking', final]);
    expect(body.endsWith(final)).toBe(true);
  });
});

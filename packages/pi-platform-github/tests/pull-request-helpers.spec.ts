/**
 * Unit tests for `findInvalidRefPattern`, the pure forbidden-pattern lookup
 * extracted from `validateBranchName` in
 * `packages/pi-platform-github/src/tools/pull-request.ts`.
 *
 * `validateBranchName` itself is already covered comprehensively by
 * `pull-request-logic.spec.ts` (32 tests), which goes through the module
 * export. Here we test the helper directly to pin down its return-value
 * contract (string error message vs null) independently of how the caller
 * consumes it.
 */

import { describe, expect, test } from 'vitest';
import { findInvalidRefPattern } from '@alexanderfortin/pi-platform-github';

describe('findInvalidRefPattern', () => {
  test('returns null when the branch name has no forbidden patterns', () => {
    expect(findInvalidRefPattern('main')).toBeNull();
    expect(findInvalidRefPattern('feature/add-login')).toBeNull();
    expect(findInvalidRefPattern('release/v2.0')).toBeNull();
  });

  test('detects double-dot ("..")', () => {
    expect(findInvalidRefPattern('feature..fix')).toBe(
      'Invalid branch name "feature..fix": contains forbidden pattern ".."'
    );
  });

  test('detects tilde ("~")', () => {
    expect(findInvalidRefPattern('feature~1')).toBe(
      'Invalid branch name "feature~1": contains forbidden pattern "~"'
    );
  });

  test('detects caret ("^")', () => {
    expect(findInvalidRefPattern('feature^1')).toBe(
      'Invalid branch name "feature^1": contains forbidden pattern "^"'
    );
  });

  test('detects colon (":")', () => {
    expect(findInvalidRefPattern('feat:fix')).toBe(
      'Invalid branch name "feat:fix": contains forbidden pattern ":"'
    );
  });

  test('detects backslash ("\\")', () => {
    expect(findInvalidRefPattern('feat\\fix')).toBe(
      'Invalid branch name "feat\\fix": contains forbidden pattern "\\"'
    );
  });

  test('detects space (" ")', () => {
    expect(findInvalidRefPattern('feature fix')).toBe(
      'Invalid branch name "feature fix": contains forbidden pattern " "'
    );
  });

  test('detects question mark ("?")', () => {
    expect(findInvalidRefPattern('feature?')).toBe(
      'Invalid branch name "feature?": contains forbidden pattern "?"'
    );
  });

  test('detects asterisk ("*")', () => {
    expect(findInvalidRefPattern('feature*')).toBe(
      'Invalid branch name "feature*": contains forbidden pattern "*"'
    );
  });

  test('detects open bracket ("[")', () => {
    expect(findInvalidRefPattern('feature[0]')).toBe(
      'Invalid branch name "feature[0]": contains forbidden pattern "["'
    );
  });

  test('detects reflog syntax ("@{")', () => {
    expect(findInvalidRefPattern('feature@{1}')).toBe(
      'Invalid branch name "feature@{1}": contains forbidden pattern "@{"'
    );
  });

  test('returns the first match when multiple forbidden patterns are present', () => {
    // `..` comes before `~` in the INVALID_REF_PATTERNS list
    expect(findInvalidRefPattern('feature..~fix')).toMatch(/forbidden pattern "\.\."/);
  });

  test('does NOT detect edge-only rules (these are handled by other rules)', () => {
    // Leading dot is handled by the dot-edge rule, not by INVALID_REF_PATTERNS.
    // This confirms the helper is only responsible for substring/regex patterns.
    expect(findInvalidRefPattern('.hidden')).toBeNull();
    expect(findInvalidRefPattern('feature.')).toBeNull();
    expect(findInvalidRefPattern('-feature')).toBeNull();
  });

  test('echoes the branch name in the error message', () => {
    const result = findInvalidRefPattern('weird~branch');
    expect(result).toContain('"weird~branch"');
  });
});

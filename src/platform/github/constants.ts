/**
 * @file Shared constants used across the GitHub/Codeberg/Forgejo platform module.
 */

import { FILE_MODE_DIRECTORY, FILE_MODE_EXECUTABLE, FILE_MODE_REGULAR } from '../../git/constants';

// Re-export git file modes for use within the platform module
export { FILE_MODE_REGULAR, FILE_MODE_EXECUTABLE, FILE_MODE_DIRECTORY };

// Reaction types
export const REACTION_TYPE_EYES = 'eyes' as const;

// Validation constants
export const MAX_TITLE_LENGTH = 255;

// Branch naming patterns
export const BRANCH_PREFIX = 'pi/issue' as const;

// GitHub-specific ignore patterns (appended to the universal defaults)
export const GITHUB_IGNORE_PATTERNS = [
  '.github/workflows/*/pi.yml', // Don't include the workflow that runs this action
] as const;

// Default trigger string
export const DEFAULT_TRIGGER = '/pi';

// GitHub max comments limit
export const MAX_COMMENTS = 100;

// GitHub max review comments limit for PR thread
export const MAX_REVIEW_COMMENTS = 50;

// GitHub max diff lines before truncation
export const MAX_DIFF_LINES = 1000;

// GitHub max diff bytes before smart truncation (~50K tokens safety limit)
export const MAX_DIFF_BYTES = 200_000;

/**
 * Default file patterns always excluded from PR diffs.
 *
 * These are common generated/build files that inflate diffs with
 * unreviewable content. They are merged with any user-provided
 * or LLM-provided ignore patterns.
 */
export const DEFAULT_DIFF_IGNORE_PATTERNS = [
  'dist/',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'bun.lock',
  'vendor/',
] as const;

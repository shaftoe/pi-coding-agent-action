/**
 * @file Shared constants used across the GitHub/Codeberg/Forgejo platform module.
 */

import {
  FILE_MODE_DIRECTORY,
  FILE_MODE_EXECUTABLE,
  FILE_MODE_REGULAR,
} from '@alexanderfortin/pi-orchestrator';

// Re-export git file modes for use within the platform module
export { FILE_MODE_REGULAR, FILE_MODE_EXECUTABLE, FILE_MODE_DIRECTORY };

// Reaction types
export const REACTION_TYPE_EYES = 'eyes' as const;

// Validation constants
export const MAX_TITLE_LENGTH = 255;

// Branch naming patterns
export const BRANCH_PREFIX = 'pi/issue' as const;

/**
 * Name of the git remote that points at the agent's fork of the repository.
 *
 * Pull requests are opened from the agent's own fork: branches are pushed
 * to this remote instead of `origin`. It is added to the workspace checkout
 * on first use and reused (URL updated) on subsequent runs.
 */
export const FORK_REMOTE_NAME = 'pi-fork';

// GitHub-specific ignore patterns (appended to the universal defaults)
export const GITHUB_IGNORE_PATTERNS = [
  // Don't include the workflow that runs this action. Note: gitignore `*`
  // does NOT cross `/`, so `*/pi.yml` wouldn't match `.github/workflows/pi.yml`
  // directly — we need the exact path.
  '.github/workflows/pi.yml',
] as const;

// Default trigger string
export const DEFAULT_TRIGGER = '/pi ';

// GitHub max comments limit
export const MAX_COMMENTS = 100;

// GitHub max review comments limit for PR thread
export const MAX_REVIEW_COMMENTS = 50;

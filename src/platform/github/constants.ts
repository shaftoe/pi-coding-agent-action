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

// Cancellation messages
export const CANCELLATION_MESSAGE_CREATE_PR = 'Pull request creation was cancelled';
export const CANCELLATION_MESSAGE_GET_THREAD = 'Thread retrieval was cancelled';
export const CANCELLATION_MESSAGE_UPDATE_PR = 'Pull request update was cancelled';

// GitHub-specific ignore patterns (appended to the universal defaults)
export const GITHUB_IGNORE_PATTERNS = [
  '.github/workflows/*/pi.yml', // Don't include the workflow that runs this action
] as const;

// Default trigger string
export const DEFAULT_TRIGGER = '/pi';

// GitHub max comments limit
export const MAX_COMMENTS = 100;

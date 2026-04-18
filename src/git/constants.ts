/**
 * @file Shared constants used across the git hosting platform module.
 */

// Reaction types
export const REACTION_TYPE_EYES = 'eyes' as const;

// Validation constants
export const MAX_TITLE_LENGTH = 255;

// Git file modes
export const FILE_MODE_REGULAR = '100644' as const; // Regular file, not executable
export const FILE_MODE_EXECUTABLE = '100755' as const; // Executable file
export const FILE_MODE_DIRECTORY = '040000' as const; // Directory

// Branch naming patterns
export const BRANCH_PREFIX = 'pi/issue' as const;

// Cancellation messages
export const CANCELLATION_MESSAGE_CREATE_PR = 'Pull request creation was cancelled';
export const CANCELLATION_MESSAGE_GET_THREAD = 'Thread retrieval was cancelled';
export const CANCELLATION_MESSAGE_UPDATE_PR = 'Pull request update was cancelled';

// Ignore patterns for file scanning
export const IGNORE_PATTERNS = [
  '.git',
  '.github/workflows/*/pi.yml', // Don't include the workflow that runs this action
] as const;

// Default trigger string
export const DEFAULT_TRIGGER = '/pi';

// GitHub max comments limit
export const MAX_COMMENTS = 100;

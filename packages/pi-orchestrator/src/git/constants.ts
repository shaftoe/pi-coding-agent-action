/**
 * @file Platform-agnostic git constants.
 *
 * Defines constants shared across all git hosting platform implementations.
 */

// Git file modes (standard Unix file modes used by git)
export const FILE_MODE_REGULAR = '100644' as const; // Regular file, not executable
export const FILE_MODE_EXECUTABLE = '100755' as const; // Executable file
export const FILE_MODE_DIRECTORY = '040000' as const; // Directory

/**
 * Default ignore patterns that apply to all platforms.
 *
 * These are always added in addition to the repository's `.gitignore`.
 * Platforms can extend this list with platform-specific patterns.
 */
export const DEFAULT_IGNORE_PATTERNS = ['.git'] as const;

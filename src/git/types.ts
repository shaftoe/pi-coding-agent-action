/**
 * @file Platform-agnostic git types and interfaces.
 *
 * Defines types shared across all git hosting platform implementations
 * (GitHub, Codeberg, Forgejo, and future platforms like GitLab/Bitbucket).
 */

/**
 * Logger interface for git operations.
 *
 * Abstracts logging so platform-specific implementations can provide their
 * own adapters without coupling the scanner to any particular logging system.
 */
export interface Logger {
  debug: (msg: string) => void;
  info: (msg: string) => void;
}

/**
 * Git file mode types (standard Unix file modes used by git).
 */
export type FileMode = '100644' | '100755' | '040000';

/**
 * Tree entry for creating Git trees.
 *
 * Setting `sha` to `null` indicates the file should be deleted.
 */
export interface TreeEntry {
  /** Path to the file or directory */
  path: string;
  /** File mode (permissions) */
  mode: FileMode;
  /** Type of tree entry */
  type: 'blob' | 'tree';
  /** SHA of the blob/tree, or `null` to delete the file */
  sha: string | null;
}

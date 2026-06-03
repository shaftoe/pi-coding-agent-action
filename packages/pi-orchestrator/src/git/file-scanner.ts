/**
 * @file Platform-agnostic file change scanning and detection logic.
 *
 * Scans the local repository for files that are new, modified, or deleted
 * compared to a reference set of files from a Git tree. This module contains
 * no platform-specific API calls - platforms provide the reference file map
 * via their own API client and pass it to these functions.
 *
 * Respects .gitignore (including nested .gitignore files) and additional
 * ignore patterns supplied by the caller. Skips binary files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import ignore from 'ignore';
import { DEFAULT_IGNORE_PATTERNS, FILE_MODE_REGULAR } from './constants';
import type { Logger, FileMode } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of scanning for changes in the repository.
 */
export interface ChangeScanResult {
  /** Files that are new or modified */
  changedFiles: {
    path: string;
    content: string;
    mode: FileMode;
  }[];
  /** Files that exist in the reference but were deleted locally */
  deletedFiles: string[];
}

/**
 * Parameters for the directory scan operation.
 */
export interface ScanDirectoryParams {
  /** Absolute path to the directory to scan. */
  dir: string;
  /** Relative path within the repository. */
  relativePath: string;
  /** Map of reference files for comparison. */
  referenceFiles: Map<string, { sha: string; content: string | null }>;
  /** Ignore instance with loaded patterns. */
  ig: ignore.Ignore;
  /** Logger instance for debug output. */
  log: Logger;
}

export interface ScanOptions {
  repoRoot?: string | undefined;
  ignorePatterns?: readonly string[];
}

// ---------------------------------------------------------------------------
// Helper functions (internal)
// ---------------------------------------------------------------------------

/**
 * Check if a file should be ignored based on ignore patterns.
 */
function isFileIgnored(relativePath: string, ig: ignore.Ignore): boolean {
  return ig.ignores(relativePath);
}

/**
 * Read file content, safely handling binary files and read errors.
 */
async function readFileContentSafely(
  fullPath: string,
  relativePath: string,
  log: Logger
): Promise<string | null> {
  try {
    return await fs.readFile(fullPath, 'utf-8');
  } catch (_e) {
    log.debug(`skipping file (likely binary): ${relativePath}`);
    return null;
  }
}

/**
 * Compare local file content with reference file to determine if changed.
 */
function compareFileWithReference(
  localContent: string,
  refFile: { sha: string; content: string | null } | undefined,
  relativePath: string,
  log: Logger
): boolean {
  if (!refFile) {
    log.debug(`new file: ${relativePath}`);
    return true;
  }
  if (refFile.content !== null && refFile.content !== localContent) {
    log.debug(`modified file: ${relativePath}`);
    return true;
  }
  return false;
}

/**
 * Process a single file entry to determine if it has changed.
 */
async function processFileEntry(
  fullPath: string,
  relativePath: string,
  referenceFiles: Map<string, { sha: string; content: string | null }>,
  log: Logger
): Promise<{ path: string; content: string; mode: FileMode } | null> {
  const localContent = await readFileContentSafely(fullPath, relativePath, log);
  if (localContent === null) {
    return null;
  }

  const refFile = referenceFiles.get(relativePath);
  const isChanged = compareFileWithReference(localContent, refFile, relativePath, log);

  if (isChanged) {
    return {
      path: relativePath,
      content: localContent,
      mode: FILE_MODE_REGULAR,
    };
  }

  return null;
}

/**
 * Transform `.gitignore` patterns from a subdirectory so they are expressed
 * as repo-root-relative patterns understood by the root-level `ignore` instance.
 *
 * Git scoping rules (see `gitignore` docs):
 * - If the pattern contains a `/` at the **beginning or middle** (not just
 *   trailing), it is anchored to the directory containing the `.gitignore`.
 * - Otherwise it is a shell glob that matches at **any depth** below that
 *   directory.
 *
 * Negation prefixes (`!`) are preserved after transforming the inner pattern.
 */
function transformGitignoreContent(content: string, dirPath: string): string {
  return content
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      // Preserve empty lines and comments as-is (they are harmless)
      if (!trimmed || trimmed.startsWith('#')) {
        return '';
      }
      return transformPattern(trimmed, dirPath);
    })
    .filter(line => line !== '')
    .join('\n');
}

/**
 * Transform a single gitignore pattern for a subdirectory context.
 */
function transformPattern(pattern: string, dirPath: string): string {
  const isNegation = pattern.startsWith('!');
  const rawPattern = isNegation ? pattern.slice(1) : pattern;

  // Remove leading `/` (anchoring marker) – it will be re-anchored via dirPath
  const unanchored = rawPattern.startsWith('/') ? rawPattern.slice(1) : rawPattern;

  // Determine whether the original pattern had a separator at beginning or middle.
  // A trailing `/` (directory marker) does NOT count as a separator for anchoring.
  const withoutTrailing = rawPattern.endsWith('/') ? rawPattern.slice(0, -1) : rawPattern;
  const hasSeparator = withoutTrailing.startsWith('/') || withoutTrailing.slice(1).includes('/');

  let transformed: string;
  if (hasSeparator) {
    // Pattern is relative to the .gitignore directory → prefix with dirPath
    transformed = `${dirPath}/${unanchored}`;
  } else {
    // Pattern is a glob matching at any depth below the .gitignore directory
    transformed = `${dirPath}/**/${rawPattern}`;
  }

  return isNegation ? `!${transformed}` : transformed;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Recursively scan a directory for files and determine changes.
 *
 * As the scan descends into subdirectories, any `.gitignore` files found are
 * loaded and their patterns are transformed to repo-root-relative form and
 * added to the shared `ignore` instance.  This correctly handles nested
 * `.gitignore` files including negation patterns (e.g. `!keep/this/file.md`).
 *
 * @param params - Parameters controlling the scan operation.
 * @returns Changed files and all encountered files (including gitignored ones
 *          that exist on disk, so deletion detection can distinguish between
 *          "file was deleted" and "file is gitignored but still present").
 */
export async function scanDirectory(params: ScanDirectoryParams): Promise<{
  changedFiles: { path: string; content: string; mode: FileMode }[];
  encounteredFiles: Set<string>;
}> {
  const { dir, relativePath, referenceFiles, ig, log } = params;
  const changedFiles: { path: string; content: string; mode: FileMode }[] = [];
  const encounteredFiles = new Set<string>();

  // Load nested .gitignore if present (root .gitignore is loaded in scanForChanges)
  if (relativePath) {
    try {
      const subGitignorePath = path.join(dir, '.gitignore');
      const subGitignoreContent = await fs.readFile(subGitignorePath, 'utf-8');
      const transformed = transformGitignoreContent(subGitignoreContent, relativePath);
      ig.add(transformed);
      log.debug(`loaded nested .gitignore: ${path.join(relativePath, '.gitignore')}`);
    } catch (_e) {
      // No .gitignore in this subdirectory – that's fine
    }
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativeFilePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

    if (isFileIgnored(relativeFilePath, ig)) {
      log.debug(`ignored: ${relativeFilePath}`);
      continue;
    }

    if (entry.isDirectory()) {
      const subDirResult = await scanDirectory({
        dir: fullPath,
        relativePath: relativeFilePath,
        referenceFiles,
        ig,
        log,
      });
      changedFiles.push(...subDirResult.changedFiles);
      subDirResult.encounteredFiles.forEach(file => encounteredFiles.add(file));
    } else if (entry.isFile()) {
      const fileResult = await processFileEntry(fullPath, relativeFilePath, referenceFiles, log);
      if (fileResult) {
        changedFiles.push(fileResult);
      }
      encounteredFiles.add(relativeFilePath);
    }
  }

  return { changedFiles, encounteredFiles };
}

/**
 * Recursively scan the local repository for files that are new or modified
 * compared to a reference set of files. Also tracks files that have been deleted.
 *
 * Respects `.gitignore` and any additional patterns provided via
 * {@link ScanOptions.ignorePatterns}. Skips binary files.
 *
 * @param referenceFiles - Map of reference file paths to their SHA and content,
 *                         used for change detection. The caller is responsible
 *                         for obtaining this map from the platform's Git API.
 * @param log - Logger for debug output.
 * @param options - Optional scan configuration (repo root, extra ignore patterns).
 * @returns An object containing changed files and deleted files.
 */
export async function scanForChanges(
  referenceFiles: Map<string, { sha: string; content: string | null }>,
  log: Logger,
  options?: ScanOptions
): Promise<ChangeScanResult> {
  log.debug(`scanning local files for changes...`);

  const repoRoot = options?.repoRoot ?? process.cwd();

  const ig = ignore();
  try {
    const gitignoreContent = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf-8');
    ig.add(gitignoreContent);
  } catch (_e) {
    // No .gitignore file, that's fine
  }
  // Add universal defaults
  ig.add(DEFAULT_IGNORE_PATTERNS);
  // Add platform-specific patterns
  if (options?.ignorePatterns) {
    ig.add(options.ignorePatterns);
  }

  // Scan directory recursively
  const { changedFiles, encounteredFiles: localFilesEncountered } = await scanDirectory({
    dir: repoRoot,
    relativePath: '',
    referenceFiles,
    ig,
    log,
  });

  // Detect deleted files by comparing reference files with what we found locally.
  // A file is only considered deleted if it is NOT present on disk.  Files that
  // are matched by a .gitignore pattern but still exist on disk must NOT be
  // removed from the tree – they were simply skipped during scanning.
  const deletedFiles: string[] = [];
  for (const refFilePath of referenceFiles.keys()) {
    if (!localFilesEncountered.has(refFilePath)) {
      // Double-check: is the file actually missing from disk?
      const absolutePath = path.join(repoRoot, refFilePath);
      try {
        await fs.access(absolutePath);
        // File exists on disk but was skipped (e.g. gitignored) – do NOT delete
        log.debug(`skipping deletion of gitignored file that still exists: ${refFilePath}`);
        continue;
      } catch (_e) {
        // File truly does not exist – it was deleted
      }
      deletedFiles.push(refFilePath);
      log.debug(`deleted file: ${refFilePath}`);
    }
  }

  log.debug(
    `found ${changedFiles.length} changed file(s) and ${deletedFiles.length} deleted file(s)`
  );
  return { changedFiles, deletedFiles };
}

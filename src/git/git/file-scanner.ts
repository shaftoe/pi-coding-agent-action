/**
 * @file File change scanning and detection logic.
 *
 * Scans the local repository for files that are new, modified, or deleted
 * compared to a reference set of files from a Git tree.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as github from '@actions/github';
import ignore from 'ignore';
import { getOctokit } from '../octokit';
import { FILE_MODE_REGULAR, IGNORE_PATTERNS } from '../constants';
import { createLogger, FileMode } from './types';

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
 * Fetch blob content from GitHub.
 *
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param sha - Blob SHA.
 * @returns The decoded UTF-8 content, or null if fetching fails.
 */
async function fetchBlobContent(
  owner: string,
  repo: string,
  sha: string,
  log: ReturnType<typeof createLogger>
): Promise<string | null> {
  try {
    const octokit = getOctokit();
    const blob = await octokit.rest.git.getBlob({
      owner,
      repo,
      file_sha: sha,
    });
    const content = Buffer.from(blob.data.content, 'base64').toString('utf-8');
    log.debug(`Fetched blob content: ${sha}`);
    return content;
  } catch (_e) {
    log.debug(`Failed to fetch blob content: ${sha}`);
    return null;
  }
}

/**
 * Build a map of files from a Git tree.
 *
 * Fetches the tree and optionally fetches blob contents for comparison.
 *
 * @param treeSha - SHA of the tree to fetch.
 * @param fetchContents - Whether to fetch blob contents (default: true).
 * @returns Map of path -> { sha, content }.
 */
export async function buildFileMap(
  treeSha: string,
  fetchContents = true,
  log = createLogger()
): Promise<Map<string, { sha: string; content: string | null }>> {
  const octokit = getOctokit();
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;

  log.debug(`fetching tree: ${treeSha}`);

  const tree = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: treeSha,
    recursive: 'true',
  });

  log.debug(`tree contains ${tree.data.tree.length} items`);

  const fileMap = new Map<string, { sha: string; content: string | null }>();

  for (const item of tree.data.tree) {
    if (item.type === 'blob' && item.sha) {
      let content: string | null = null;
      if (fetchContents) {
        content = await fetchBlobContent(owner, repo, item.sha, log);
      }
      fileMap.set(item.path, { sha: item.sha, content });
    }
  }

  log.debug(`built file map with ${fileMap.size} files`);

  return fileMap;
}

/**
 * Check if a file should be ignored based on ignore patterns.
 *
 * @param relativePath - Relative file path to check.
 * @param ig - Ignore instance with loaded patterns.
 * @returns True if the file should be ignored, false otherwise.
 */
function isFileIgnored(relativePath: string, ig: ignore.Ignore): boolean {
  return ig.ignores(relativePath);
}

/**
 * Read file content, safely handling binary files and read errors.
 *
 * @param fullPath - Absolute path to the file.
 * @param relativePath - Relative path for logging.
 * @param log - Logger instance for debug output.
 * @returns File content as string, or null if binary/unreadable.
 */
async function readFileContentSafely(
  fullPath: string,
  relativePath: string,
  log: ReturnType<typeof createLogger>
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
 *
 * @param localContent - Content of the local file.
 * @param refFile - Reference file data, undefined if file is new.
 * @param relativePath - Relative path for logging.
 * @param log - Logger instance for debug output.
 * @returns True if file is new or modified, false otherwise.
 */
function compareFileWithReference(
  localContent: string,
  refFile: { sha: string; content: string | null } | undefined,
  relativePath: string,
  log: ReturnType<typeof createLogger>
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
 *
 * @param fullPath - Absolute path to the file.
 * @param relativePath - Relative path within the repository.
 * @param referenceFiles - Map of reference files for comparison.
 * @param log - Logger instance for debug output.
 * @returns File object if changed, null otherwise.
 */
async function processFileEntry(
  fullPath: string,
  relativePath: string,
  referenceFiles: Map<string, { sha: string; content: string | null }>,
  log: ReturnType<typeof createLogger>
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
  log: ReturnType<typeof createLogger>;
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
 *
 * @param content - Raw `.gitignore` file content.
 * @param dirPath - Repo-root-relative path of the directory that contains the
 *                  `.gitignore` (e.g. `"src/utils"`).
 * @returns Transformed pattern lines ready to be fed to the root `ignore`
 *          instance.
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
 *
 * @param pattern - A single non-empty, non-comment gitignore pattern.
 * @param dirPath - Repo-root-relative directory path.
 * @returns Pattern adjusted to be repo-root-relative.
 */
function transformPattern(pattern: string, dirPath: string): string {
  const isNegation = pattern.startsWith('!');
  const rawPattern = isNegation ? pattern.slice(1) : pattern;

  // Remove leading `/` (anchoring marker) – it will be re-anchored via dirPath
  const unanchored = rawPattern.startsWith('/') ? rawPattern.slice(1) : rawPattern;

  // Determine whether the original pattern had a separator at beginning or middle.
  // A trailing `/` (directory marker) does NOT count as a separator for anchoring.
  const withoutTrailing = rawPattern.endsWith('/') ? rawPattern.slice(0, -1) : rawPattern;
  const hasSeparator =
    withoutTrailing.startsWith('/') || withoutTrailing.slice(1).includes('/');

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
 * Respects `.gitignore` and the additional {@link IGNORE_PATTERNS}. Skips
 * binary files and files larger than {@link MAX_FILE_SIZE_BYTES}.
 *
 * @param referenceFiles - Map of reference file paths to their SHA and content,
 *                         used for change detection.
 * @param log - Logger instance for debug output.
 * @returns An object containing changed files and deleted files.
 */
export async function scanForChanges(
  referenceFiles: Map<string, { sha: string; content: string | null }>,
  log = createLogger()
): Promise<ChangeScanResult> {
  log.debug(`scanning local files for changes...`);

  const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const ig = ignore();
  try {
    const gitignoreContent = await fs.readFile(path.join(repoRoot, '.gitignore'), 'utf-8');
    ig.add(gitignoreContent);
  } catch (_e) {
    // No .gitignore file, that's fine
  }
  // Add additional patterns to always ignore
  ig.add(IGNORE_PATTERNS);

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
        log.debug(
          `skipping deletion of gitignored file that still exists: ${refFilePath}`
        );
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

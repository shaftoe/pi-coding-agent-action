/**
 * @file PR diff fetching.
 *
 * Retrieves the diff for a pull request via the GitHub REST API, with
 * optional line-count truncation. Used by the `get_pr_diff` Pi tool via
 * the platform provider.
 */

import { MAX_DIFF_LINES, MAX_DIFF_BYTES, DEFAULT_DIFF_IGNORE_PATTERNS } from '../constants';
import { getCoreAdapter } from '../index';
import { getOctokit } from '../octokit';

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  getCoreAdapter().debug(msg);
}

/**
 * Check whether a diff file path matches any of the ignore patterns.
 *
 * A pattern matches if it is an exact path or a directory prefix
 * (ending with `/`). For example, `"dist/"` matches any file under
 * `dist/` while `"package-lock.json"` matches only that exact file.
 *
 * @param filePath - The file path from the diff header (e.g. "a/src/foo.ts").
 * @param ignoreFiles - The list of ignore patterns.
 * @returns `true` if the file should be excluded.
 */
export function matchesIgnorePattern(filePath: string, ignoreFiles: string[]): boolean {
  // Strip the leading "a/" or "b/" prefix added by unified diff
  const clean = filePath.replace(/^[ab]\//, '');
  return ignoreFiles.some(pattern => {
    if (pattern.endsWith('/')) {
      // Pattern like "dist/" — any file under that directory matches
      return clean.startsWith(pattern);
    }
    return clean === pattern || clean.startsWith(pattern + '/');
  });
}

/**
 * Filter diff hunks by removing files that match the ignore patterns.
 *
 * Unified diffs separate files with headers like:
 *   diff --git a/path/to/file b/path/to/file
 *
 * This function splits on those boundaries and keeps only the hunks
 * whose file paths do not match any ignore pattern.
 *
 * @param diff - The raw unified diff string.
 * @param ignoreFiles - Patterns of files to exclude.
 * @returns The filtered diff string.
 */
export function filterDiffByIgnoreFiles(diff: string, ignoreFiles: string[]): string {
  if (!ignoreFiles || ignoreFiles.length === 0) {
    return diff;
  }

  const hunkSeparator = 'diff --git ';
  // Split into individual file hunks, preserving the separator
  const hunks = diff.split(hunkSeparator);
  const header = hunks[0]; // May be empty or contain preamble
  const fileHunks = hunks.slice(1);

  const kept: string[] = [];
  for (const hunk of fileHunks) {
    // The first line after "diff --git " is the a/... b/... header
    const firstNewline = hunk.indexOf('\n');
    const headerLine = firstNewline === -1 ? hunk : hunk.slice(0, firstNewline);
    // Extract the "a/path" part from "a/path b/path"
    const match = headerLine.match(/^(a\/.+?)\s+b\//);
    const filePath = match?.[1] ?? headerLine;

    if (!matchesIgnorePattern(filePath, ignoreFiles)) {
      kept.push(hunkSeparator + hunk);
    }
  }

  const filtered = header + kept.join('');
  if (filtered !== diff) {
    debug(`[filterDiffByIgnoreFiles] Filtered diff: ${diff.length} -> ${filtered.length} bytes`);
  }
  return filtered;
}

/**
 * Fetch the diff for a pull request.
 *
 * Retrieves the PR diff via `octokit.rest.pulls.get()` with
 * `mediaType: { format: 'diff' }`. The diff is truncated if it exceeds
 * `maxDiffLines`. Optionally, files matching `ignoreFiles` patterns are
 * stripped from the result before truncation.
 *
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param pullNumber - Pull request number.
 * @param maxDiffLines - Maximum number of diff lines before truncation.
 * @param ignoreFiles - Optional list of file path patterns to exclude.
 * @returns The diff string, or empty string on error.
 */
/**
 * Merge default ignore patterns with caller-provided ones.
 *
 * Defaults are always applied; caller patterns extend them.
 * Duplicates are removed.
 */
function mergeIgnorePatterns(extraPatterns?: string[]): string[] {
  const merged = new Set<string>(DEFAULT_DIFF_IGNORE_PATTERNS);
  if (extraPatterns) {
    for (const p of extraPatterns) {
      merged.add(p);
    }
  }
  return [...merged];
}

/**
 * Smart-truncate a diff by removing the largest file hunks until it fits
 * within a byte budget.
 *
 * Falls back to simple line truncation if hunk-level trimming isn't enough.
 */
function smartTruncate(diff: string, maxBytes: number): string {
  const hunkSeparator = 'diff --git ';
  const hunks = diff.split(hunkSeparator);
  const header = hunks[0];
  const fileHunks = hunks.slice(1);

  if (fileHunks.length <= 1) {
    // Single file – can't remove hunks, just truncate lines
    const lines = diff.split('\n');
    const budget = Math.max(100, Math.floor(maxBytes / 80)); // rough line estimate
    return (
      lines.slice(0, budget).join('\n') +
      `\n... (truncated to fit byte limit, ${lines.length - budget} more lines)`
    );
  }

  // Sort hunks by size ascending – keep smallest, drop largest
  const indexed = fileHunks.map((h, i) => ({ h, i, size: Buffer.byteLength(h, 'utf8') }));
  indexed.sort((a, b) => a.size - b.size);

  const kept: string[] = [];
  let totalBytes = Buffer.byteLength(header ?? '', 'utf8');
  for (const entry of indexed) {
    const hunkBytes = Buffer.byteLength(hunkSeparator + entry.h, 'utf8');
    if (totalBytes + hunkBytes > maxBytes) {
      debug(
        `[smartTruncate] Dropping hunk ${entry.i} (${(hunkBytes / 1024).toFixed(1)}KB) to fit budget`
      );
      continue;
    }
    kept.push(hunkSeparator + entry.h);
    totalBytes += hunkBytes;
  }

  const result = header + kept.join('');
  const droppedCount = fileHunks.length - kept.length;
  if (droppedCount > 0) {
    debug(
      `[smartTruncate] Kept ${kept.length}/${fileHunks.length} files, ` +
        `${(totalBytes / 1024).toFixed(1)}KB total`
    );
  }
  return result;
}

export async function fetchPRDiff(
  owner: string,
  repo: string,
  pullNumber: number,
  maxDiffLines: number = MAX_DIFF_LINES,
  ignoreFiles?: string[]
): Promise<string> {
  try {
    const octokit = getOctokit();
    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: 'diff' },
    });

    let diff = response.data as unknown as string;
    if (!diff) {
      return '';
    }

    // Always merge defaults with caller-provided patterns
    const mergedIgnore = mergeIgnorePatterns(ignoreFiles);
    diff = filterDiffByIgnoreFiles(diff, mergedIgnore);

    // Byte-size guard: smart-truncate oversized diffs even after filtering
    const byteSize = Buffer.byteLength(diff, 'utf8');
    if (byteSize > MAX_DIFF_BYTES) {
      debug(
        `[fetchPRDiff] Diff is ${(byteSize / 1024).toFixed(1)}KB, applying smart truncation`
      );
      diff = smartTruncate(diff, MAX_DIFF_BYTES);
    }

    const lines = diff.split('\n');
    if (lines.length > maxDiffLines) {
      return (
        lines.slice(0, maxDiffLines).join('\n') +
        `\n... (truncated at ${maxDiffLines} lines, ${lines.length - maxDiffLines} more)`
      );
    }

    return diff;
  } catch (_e) {
    debug(`[fetchPRDiff] Failed to fetch PR diff, continuing`);
    return '';
  }
}

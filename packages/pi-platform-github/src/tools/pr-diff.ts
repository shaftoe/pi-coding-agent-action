/**
 * @file PR diff fetching.
 *
 * Retrieves the diff for a pull request via the GitHub REST API, with
 * optional line-count truncation. Used by the `get_pr_diff` Pi tool via
 * the platform provider.
 */

import type { GitHubModuleDeps } from '../types';

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
 * @param deps - Module dependencies (for logging).
 * @param diff - The raw unified diff string.
 * @param ignoreFiles - Patterns of files to exclude.
 * @returns The filtered diff string.
 */
export function filterDiffByIgnoreFiles(
  deps: GitHubModuleDeps,
  diff: string,
  ignoreFiles: string[]
): string {
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
    deps.logger.debug(
      `[filterDiffByIgnoreFiles] Filtered diff: ${diff.length} -> ${filtered.length} bytes`
    );
  }
  return filtered;
}

/**
 * Fetch the diff for a pull request.
 *
 * Retrieves the PR diff via `octokit.rest.pulls.get()` with
 * `mediaType: { format: 'diff' }`. Optionally, files matching
 * `ignoreFiles` patterns are stripped from the result.
 *
 * Note: line-count and byte truncation is handled by the calling tool,
 * not here.
 *
 * @param deps - Module dependencies.
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param pullNumber - Pull request number.
 * @param ignoreFiles - Optional list of file path patterns to exclude.
 * @returns The diff string, or empty string if the PR has no diff.
 */
export async function fetchPRDiff(
  deps: GitHubModuleDeps,
  owner: string,
  repo: string,
  pullNumber: number,
  ignoreFiles?: string[]
): Promise<string> {
  const response = await deps.octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: { format: 'diff' },
  });

  let diff = response.data as unknown as string;
  if (!diff) {
    return '';
  }

  // Filter out ignored files
  if (ignoreFiles && ignoreFiles.length > 0) {
    diff = filterDiffByIgnoreFiles(deps, diff, ignoreFiles);
  }

  return diff;
}

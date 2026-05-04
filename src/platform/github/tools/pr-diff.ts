/**
 * @file PR diff fetching.
 *
 * Retrieves the diff for a pull request via the GitHub REST API, with
 * optional line-count truncation. Used by the `get_pr_diff` Pi tool via
 * the platform provider.
 */

import { MAX_DIFF_LINES } from '../constants';
import { getCoreAdapter } from '../index';
import { getOctokit } from '../octokit';

/**
 * Debug logging helper.
 */
function debug(msg: string): void {
  getCoreAdapter().debug(msg);
}

/**
 * Fetch the diff for a pull request.
 *
 * Retrieves the PR diff via `octokit.rest.pulls.get()` with
 * `mediaType: { format: 'diff' }`. The diff is truncated if it exceeds
 * `maxDiffLines`.
 *
 * @param owner - Repository owner.
 * @param repo - Repository name.
 * @param pullNumber - Pull request number.
 * @param maxDiffLines - Maximum number of diff lines before truncation.
 * @returns The diff string, or empty string on error.
 */
export async function fetchPRDiff(
  owner: string,
  repo: string,
  pullNumber: number,
  maxDiffLines: number = MAX_DIFF_LINES
): Promise<string> {
  try {
    const octokit = getOctokit();
    const response = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
      mediaType: { format: 'diff' },
    });

    const diff = response.data as unknown as string;
    if (!diff) {
      return '';
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

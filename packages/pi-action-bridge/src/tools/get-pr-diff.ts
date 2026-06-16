/**
 * @file `get_pr_diff` tool — read-only fetch of a PR diff.
 *
 * Thin wrapper over `provider.getPRDiff()` (an *existing* PR — no
 * chicken-and-egg, unlike `/handoff` which uses the local pre-push diff).
 * When no `pull_number` is given, auto-resolves the PR linked to the current
 * git branch (§3.5 / §2.2). Truncation is applied here because the provider's
 * `fetchPRDiff` returns the raw diff; the shared `truncateDiff` helper is
 * reused (§2.9) so the budget matches the orchestrator's `get_pr_diff` tool
 * (1000 lines / 100 KB).
 */

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
// Pure helpers (not tool factories) — §2.9 endorses sharing these.
import {
  truncateDiff,
  mergeIgnoreFiles,
} from '@alexanderfortin/pi-orchestrator/pi/tools/get-pr-diff';
import type { Bridge } from '../bridge.js';

/** Bridge-local details (mirrors the orchestrator's GetPRDiffDetails shape). */
export interface GetPRDiffDetails {
  pull_number: number;
  lines: number;
  truncated: boolean;
  truncated_reason?: 'bytes' | 'lines';
}

/** Default truncation budget — matches the orchestrator's `get_pr_diff` tool. */
const DEFAULT_MAX_LINES = 1000;
const DEFAULT_MAX_BYTES = 102_400;

const schema = Type.Object({
  owner: Type.Optional(
    Type.String({
      description: 'Repository owner. Defaults to the current repo (from the git remote).',
    })
  ),
  repo: Type.Optional(
    Type.String({
      description: 'Repository name. Defaults to the current repo (from the git remote).',
    })
  ),
  pull_number: Type.Optional(
    Type.Integer({
      description: 'PR number. Omit to auto-resolve the PR linked to the current git branch.',
    })
  ),
  max_lines: Type.Optional(
    Type.Integer({ description: `Maximum diff lines (default: ${DEFAULT_MAX_LINES}).` })
  ),
  ignore_files: Type.Optional(
    Type.Array(Type.String(), {
      description: 'File path patterns (substring match) to exclude from the diff.',
    })
  ),
});

/**
 * Create the `get_pr_diff` tool bound to a {@link Bridge}.
 */
export function getPRDiffToolFactory(bridge: Bridge) {
  return defineTool({
    name: 'get_pr_diff',
    label: 'Get PR Diff',
    description:
      'Fetch the diff of an existing pull request (truncated to fit context). ' +
      'When pull_number is omitted, resolves the PR linked to the current git branch. Read-only.',
    parameters: schema,
    execute: async (
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      _ctx
    ): Promise<{
      content: { type: 'text'; text: string }[];
      details: GetPRDiffDetails;
    }> => {
      const owner = params.owner ?? bridge.context.repo.owner;
      const repo = params.repo ?? bridge.context.repo.repo;

      let pullNumber = params.pull_number;
      pullNumber ??= await bridge.resolveCurrentPR();
      if (!pullNumber) {
        return {
          content: [
            {
              type: 'text',
              text: 'No pull_number given, and no open PR is linked to the current branch.',
            },
          ],
          details: { pull_number: 0, lines: 0, truncated: false },
        };
      }

      // No default ignore patterns from the bridge config in Phase 2; only
      // caller-provided ones. mergeIgnoreFiles dedupes (and returns undefined
      // when empty, so the provider omits the filter).
      const ignoreFiles = mergeIgnoreFiles([], params.ignore_files ?? []);

      const diff = await bridge.provider.getPRDiff(owner, repo, pullNumber, ignoreFiles);

      if (!diff) {
        return {
          content: [
            {
              type: 'text',
              text: `No diff available for PR #${pullNumber}. This may not be a pull request, or the diff is empty.`,
            },
          ],
          details: { pull_number: pullNumber, lines: 0, truncated: false },
        };
      }

      const maxLines = params.max_lines ?? DEFAULT_MAX_LINES;
      const truncated = truncateDiff(diff, maxLines, DEFAULT_MAX_BYTES);

      const details: GetPRDiffDetails = {
        pull_number: pullNumber,
        lines: truncated.text.split('\n').length,
        truncated: truncated.truncated,
      };
      if (truncated.truncatedReason) {
        details.truncated_reason = truncated.truncatedReason;
      }

      return {
        content: [
          {
            type: 'text',
            text: `PR #${pullNumber} Diff:\n\`\`\`diff\n${truncated.text}\n\`\`\``,
          },
        ],
        details,
      };
    },
  });
}

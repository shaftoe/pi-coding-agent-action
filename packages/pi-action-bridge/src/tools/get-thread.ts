/**
 * @file `get_thread` tool — read-only fetch of an issue/PR thread.
 *
 * Thin wrapper over `provider.getIssueOrPRThread()`. The bridge-specific
 * value-add: when no `issue_number` is given, it auto-resolves the PR linked
 * to the current git branch (§3.5 / §2.2 — dynamic, no caching), so the agent
 * can say "show me the thread" and get the current PR without knowing its
 * number. Output is formatted via the shared `formatThreadAsText` helper so
 * the local agent sees the exact same format the CI agent produces.
 */

import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
// Pure helper (not a tool factory) — §2.9 endorses sharing these. Keeps local
// + CI output formats identical.
import { formatThreadAsText } from '@alexanderfortin/pi-orchestrator/pi/tools/common';
import type { GetIssueOrPRThreadParams } from '@alexanderfortin/pi-platform-github';
import type { Bridge } from '../bridge.js';

/** Bridge-local details (lighter than the full thread — the text carries it). */
export interface GetThreadDetails {
  issue_number: number;
  found: boolean;
  is_pull_request?: boolean;
  state?: string;
  comment_count?: number;
}

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
  issue_number: Type.Optional(
    Type.Integer({
      description:
        'Issue or PR number. Omit to auto-resolve the PR linked to the current git branch.',
    })
  ),
  max_comments: Type.Optional(
    Type.Integer({
      description: 'Maximum comments to fetch (default: provider limit).',
    })
  ),
});

/**
 * Create the `get_thread` tool bound to a {@link Bridge}.
 *
 * The factory closes over the bridge (provider + git/Octokit for branch→PR
 * resolution); the SDK's `execute` `ctx` is ignored (it carries no provider).
 */
export function getThreadToolFactory(bridge: Bridge) {
  return defineTool({
    name: 'get_thread',
    label: 'Get Issue/PR Thread',
    description:
      'Fetch the full thread (metadata + comments + review comments) for a GitHub issue or PR. ' +
      'When issue_number is omitted, resolves the PR linked to the current git branch. Read-only.',
    parameters: schema,
    execute: async (
      _toolCallId,
      params,
      _signal,
      _onUpdate,
      _ctx
    ): Promise<{
      content: { type: 'text'; text: string }[];
      details: GetThreadDetails;
    }> => {
      const owner = params.owner ?? bridge.context.repo.owner;
      const repo = params.repo ?? bridge.context.repo.repo;

      let issueNumber = params.issue_number;
      issueNumber ??= await bridge.resolveCurrentPR();
      if (!issueNumber) {
        return {
          content: [
            {
              type: 'text',
              text: 'No issue/PR number given, and no open PR is linked to the current branch.',
            },
          ],
          details: { issue_number: 0, found: false },
        };
      }

      const providerParams: GetIssueOrPRThreadParams = { owner, repo, issue_number: issueNumber };
      if (params.max_comments !== undefined) {
        providerParams.max_comments = params.max_comments;
      }

      const result = await bridge.provider.getIssueOrPRThread(providerParams);
      if (!result) {
        return {
          content: [{ type: 'text', text: `Issue/PR #${issueNumber} not found.` }],
          details: { issue_number: issueNumber, found: false },
        };
      }

      return {
        content: [{ type: 'text', text: formatThreadAsText(result) }],
        details: {
          issue_number: result.number,
          found: true,
          is_pull_request: result.is_pull_request,
          state: result.state,
          comment_count: result.comments.length + result.review_comments.length,
        },
      };
    },
  });
}

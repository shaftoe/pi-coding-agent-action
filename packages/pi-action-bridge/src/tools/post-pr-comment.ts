/**
 * @file `post_pr_comment` tool — posts a top-level comment to a PR via Octokit.
 *
 * Replaces the `/handoff` prompt's `gh pr comment` shell-out. PRs share the
 * issues comment endpoint, so this works for pull requests directly and across
 * every supported forge (GitHub / GHES / Codeberg / Forgejo / Gitea) for free,
 * via {@link createOctokit}.
 *
 * The orchestration is split from the I/O so {@link postPrComment} can be
 * tested with an injected {@link PostCommentFn} fake (no Octokit in the test
 * path).
 */
import { Type } from 'typebox';
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { createOctokitPostComment } from '../octokit';
import type { PostCommentFn, PostPrCommentDetails } from '../types';
import { ownerField, prNumberField, repoField, resolveServerUrl, serverUrlField } from './common';
import { PREFER_STRICT_JSON_SCHEMA } from '@alexanderfortin/pi-orchestrator/pi/tools/schema';

/**
 * Post a comment, returning structured details (or an aborted sentinel).
 *
 * @param deps.postComment - comment-posting strategy (octokit in prod, fake in tests).
 * @param signal           - agent abort signal, threaded into the Octokit request.
 */
export async function postPrComment(
  deps: { postComment: PostCommentFn },
  params: {
    serverUrl: string;
    owner: string;
    repo: string;
    number: number;
    body: string;
  },
  signal?: AbortSignal
): Promise<PostPrCommentDetails> {
  if (signal?.aborted) {
    return {
      id: 0,
      owner: params.owner,
      repo: params.repo,
      number: params.number,
      html_url: '',
      created_at: '',
      cancelled: true,
    };
  }
  return deps.postComment(params, signal);
}

/**
 * Render the result as concise text for the LLM.
 *
 * Deterministic so `/handoff` can rely on the shape; on abort it reports that
 * explicitly instead of a URL.
 */
export function summarizePostComment(details: PostPrCommentDetails): string {
  if (details.cancelled) {
    return `Comment on ${details.owner}/${details.repo}#${details.number} was not posted (aborted).`;
  }
  return `Posted comment ${details.id} on ${details.owner}/${details.repo}#${details.number}: ${details.html_url}`;
}

const paramsSchema = Type.Object(
  {
    owner: ownerField,
    repo: repoField,
    number: prNumberField('Pull request (or issue) number to comment on.'),
    body: Type.String({ minLength: 1, description: 'Markdown body of the comment.' }),
    server_url: serverUrlField,
  },
  { additionalProperties: false }
);

/**
 * The `post_pr_comment` tool definition.
 *
 * Takes explicit `owner`/`repo`/`number` (resolved by `/handoff` from
 * `detect_pull_request` or the user's argument). No `gh` dependency: the PR
 * number is a typebox `Integer`, so there is no shell-injection surface.
 */
export const postPrCommentTool: ToolDefinition<typeof paramsSchema, PostPrCommentDetails> = {
  name: 'post_pr_comment',
  label: 'Post PR Comment',
  description:
    'Post a top-level comment to a GitHub pull request (or issue) via the REST API. Works across GitHub, GitHub Enterprise, Codeberg, Forgejo and Gitea. PRs share the issues comment endpoint, so this posts to the pull request directly.',
  promptSnippet: 'Post a comment to a pull request via the REST API',
  promptGuidelines: [
    'Use post_pr_comment for /handoff (and anywhere you need to leave a comment on a PR). Prefer it over shelling out to `gh`.',
    'Resolve owner/repo/number via detect_pull_request when the user does not pass an explicit PR number.',
  ],
  parameters: paramsSchema,
  constrainedSampling: PREFER_STRICT_JSON_SCHEMA,
  async execute(
    _toolCallId: string,
    params: {
      owner: string;
      repo: string;
      number: number;
      body: string;
      server_url: string | null;
    },
    signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback<PostPrCommentDetails> | undefined,
    _ctx: ExtensionContext
  ): Promise<AgentToolResult<PostPrCommentDetails>> {
    const details = await postPrComment(
      { postComment: createOctokitPostComment() },
      {
        serverUrl: resolveServerUrl(params.server_url),
        owner: params.owner,
        repo: params.repo,
        number: params.number,
        body: params.body,
      },
      signal
    );
    return {
      content: [{ type: 'text', text: summarizePostComment(details) }],
      details,
    };
  },
};

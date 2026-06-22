/**
 * @file `read_pr_thread` tool — reads a PR/issue thread via Octokit.
 *
 * Replaces the `/pickup` prompt's `gh pr view --json` shell-out. Returns
 * metadata + issue-level comments across every supported forge (GitHub / GHES
 * / Codeberg / Forgejo / Gitea) for free, via {@link createOctokit}. Inline
 * review comments are intentionally excluded (see {@link NormalizedThread}).
 *
 * The orchestration is split from the I/O so {@link readPrThread} can be
 * tested with an injected {@link ReadThreadFn} fake (no Octokit in the test
 * path).
 */
import { Type } from 'typebox';
import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { createOctokitReadThread, DEFAULT_MAX_THREAD_COMMENTS } from '../octokit';
import type { NormalizedThread, ReadPrThreadDetails, ReadThreadFn } from '../types';
import { ownerField, prNumberField, repoField, resolveServerUrl, serverUrlField } from './common';

/** Per-comment body cap in the text summary (full bodies stay in `details`). */
const MAX_COMMENT_BODY_CHARS = 2000;

/**
 * Read a thread, returning structured details (or an aborted sentinel).
 *
 * @param deps.readThread - thread-reading strategy (octokit in prod, fake in tests).
 * @param signal          - agent abort signal, threaded into the Octokit requests.
 */
export async function readPrThread(
  deps: { readThread: ReadThreadFn },
  params: {
    serverUrl: string;
    owner: string;
    repo: string;
    number: number;
    maxComments?: number;
  },
  signal?: AbortSignal
): Promise<ReadPrThreadDetails> {
  if (signal?.aborted) {
    return {
      owner: params.owner,
      repo: params.repo,
      thread: emptyThread(params.number),
      cancelled: true,
    };
  }
  const thread = await deps.readThread(params, signal);
  return { owner: params.owner, repo: params.repo, thread };
}

function emptyThread(number: number): NormalizedThread {
  return {
    number,
    title: '',
    state: 'open',
    draft: false,
    body: '',
    author: '',
    head_branch: null,
    base_branch: null,
    updated_at: '',
    comments: [],
  };
}

/**
 * Render the thread as text for the LLM.
 *
 * Includes the comment bodies (capped per-comment) so `/pickup` can locate the
 * last `/pi 🤖 Handoff` marker directly from the tool output. The full,
 * untruncated comment bodies are available in the structured `details`.
 */
export function summarizeThread(details: ReadPrThreadDetails): string {
  if (details.cancelled) {
    return `Thread ${details.owner}/${details.repo}#${details.thread.number} was not read (aborted).`;
  }

  const { thread } = details;
  const head = thread.head_branch ?? '(issue)';
  const base = thread.base_branch ?? '-';
  const label = thread.draft ? 'draft' : thread.state;
  // `draft` is already conveyed by the `[draft]` label above; don't repeat it
  // in the branch info (it previously read `head: x → main, draft`).
  const branchInfo = thread.head_branch ? ` (head: ${head} → ${base})` : '';
  const header =
    `#${thread.number} "${thread.title}" [${label}] in ${details.owner}/${details.repo}${branchInfo}\n` +
    `by @${thread.author || 'unknown'}, updated ${thread.updated_at || '(unknown)'}`;

  const body = thread.body?.trim();
  const bodyBlock = body ? `\n\nBody:\n${body}` : '';

  const comments = thread.comments;
  const commentBlock =
    comments.length > 0
      ? `\n\nComments (${comments.length}, oldest first):\n` +
        comments
          .map(
            (c, i) =>
              `${i + 1}. @${c.author} (${c.author_type}, ${c.created_at || 'unknown'}):\n` +
              truncate(c.body, MAX_COMMENT_BODY_CHARS)
          )
          .join('\n\n')
      : '\n\n(No comments.)';

  return `${header}${bodyBlock}${commentBlock}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n… (truncated; full body in tool details)`;
}

const paramsSchema = Type.Object({
  owner: ownerField,
  repo: repoField,
  number: prNumberField('Pull request (or issue) number to read.'),
  max_comments: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description: `Maximum comments to return (default ${DEFAULT_MAX_THREAD_COMMENTS}).`,
    })
  ),
  server_url: serverUrlField,
});

/**
 * The `read_pr_thread` tool definition.
 *
 * Takes explicit `owner`/`repo`/`number` (resolved by `/pickup` from
 * `detect_pull_request` or the user's argument). No `gh` dependency: the PR
 * number is a typebox `Integer`, so there is no shell-injection surface.
 */
export const readPrThreadTool: ToolDefinition<typeof paramsSchema, ReadPrThreadDetails> = {
  name: 'read_pr_thread',
  label: 'Read PR Thread',
  description:
    'Read a GitHub pull request (or issue) thread — metadata plus issue-level comments — via the REST API. Works across GitHub, GitHub Enterprise, Codeberg, Forgejo and Gitea. Returns the comment bodies so the agent can summarise status and find handoff markers.',
  promptSnippet: 'Read a pull request thread (title, body, comments) via the REST API',
  promptGuidelines: [
    'Use read_pr_thread for /pickup instead of shelling out to `gh pr view`.',
    'Resolve owner/repo/number via detect_pull_request when the user does not pass an explicit PR number.',
    'The last comment whose body starts with `/pi 🤖 Handoff` is the most recent handoff; summarise its Done/Next sections.',
  ],
  parameters: paramsSchema,
  async execute(
    _toolCallId: string,
    params: {
      owner: string;
      repo: string;
      number: number;
      max_comments?: number;
      server_url?: string;
    },
    signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback<ReadPrThreadDetails> | undefined,
    _ctx: ExtensionContext
  ): Promise<AgentToolResult<ReadPrThreadDetails>> {
    const details = await readPrThread(
      { readThread: createOctokitReadThread() },
      {
        serverUrl: resolveServerUrl(params.server_url),
        owner: params.owner,
        repo: params.repo,
        number: params.number,
        ...(params.max_comments !== undefined ? { maxComments: params.max_comments } : {}),
      },
      signal
    );
    return {
      content: [{ type: 'text', text: summarizeThread(details) }],
      details,
    };
  },
};

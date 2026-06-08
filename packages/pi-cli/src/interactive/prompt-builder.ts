/**
 * @file Prompt builder for issue/PR-aware CLI runs.
 *
 * Enriches the user's instruction with full thread context (title, body,
 * comments, review comments) so the agent has the same "memory" it would
 * have when running in the GitHub Action.
 *
 * Thread comments are the agent's persistent memory — every prior agent
 * response and user comment is included so the agent can continue work
 * seamlessly.
 */

import type { PlatformProvider, IssueOrPRThread } from '@alexanderfortin/pi-orchestrator';

/**
 * Options for building an interactive prompt.
 */
export interface PromptBuilderOptions {
  /** The issue or PR number to target. */
  issueNumber: number;
  /** Override the owner/repo (defaults to context values). */
  owner?: string | undefined;
  repo?: string | undefined;
  /** User instruction. If omitted, a default continuation instruction is used. */
  instruction?: string | undefined;
  /** Include the PR diff in the prompt (PRs only). Default: true. */
  includeDiff?: boolean;
  /** Include CI status in the prompt (PRs only). Default: false. */
  includeCI?: boolean;
  /** Maximum number of comments to include. Default: 100. */
  maxComments?: number;
}

/**
 * Build a prompt enriched with issue/PR thread context.
 *
 * Fetches the full thread (title, body, comments, review comments) and
 * constructs a prompt that includes all of this context plus the user's
 * instruction. The thread serves as the agent's "memory" — it can see
 * everything that happened in prior runs (whether triggered by CLI or
 * GitHub Action).
 *
 * @param provider - Platform provider for API access.
 * @param options - Prompt builder options.
 * @returns The enriched prompt string.
 * @throws Error if the issue/PR cannot be found.
 */
export async function buildIssuePrompt(
  provider: PlatformProvider,
  options: PromptBuilderOptions
): Promise<string> {
  const threadParams: {
    issue_number: number;
    max_comments: number;
    owner?: string;
    repo?: string;
  } = {
    issue_number: options.issueNumber,
    max_comments: options.maxComments ?? 100,
  };
  if (options.owner !== undefined) {
    threadParams.owner = options.owner;
  }
  if (options.repo !== undefined) {
    threadParams.repo = options.repo;
  }

  const thread = await provider.getIssueOrPRThread(threadParams);

  if (!thread) {
    throw new Error(
      `Issue/PR #${options.issueNumber} not found. ` +
        `Check the number and your repository access.`
    );
  }

  return formatThreadAsPrompt(thread, options.instruction);
}

/**
 * Build a prompt enriched with PR context including diff and CI status.
 *
 * Extends {@link buildIssuePrompt} with PR-specific data: the diff and
 * optionally CI status for failing checks.
 *
 * @param provider - Platform provider for API access.
 * @param options - Prompt builder options.
 * @param owner - Repository owner (for diff fetch).
 * @param repo - Repository name (for diff fetch).
 * @returns The enriched prompt string.
 */
export async function buildPRPrompt(
  provider: PlatformProvider,
  options: PromptBuilderOptions,
  owner: string,
  repo: string
): Promise<string> {
  // Start with the base thread prompt
  let prompt = await buildIssuePrompt(provider, options);

  // Append diff if requested (default for PRs)
  if (options.includeDiff !== false) {
    try {
      const diff = await provider.getPRDiff(owner, repo, options.issueNumber);
      if (diff && diff.trim().length > 0) {
        prompt += `\n\n---\n\nCurrent PR diff:\n\`\`\`diff\n${diff}\n\`\`\``;
      }
    } catch (e) {
      // Diff fetch failure is non-fatal — the agent can still work
      // with thread context alone.
      const msg = e instanceof Error ? e.message : String(e);
      // Append a note but don't throw
      prompt += `\n\n[Note: Could not fetch PR diff: ${msg}]`;
    }
  }

  // Append CI status if requested
  if (options.includeCI === true) {
    try {
      const ciStatus = await provider.getCIStatus({ pull_number: options.issueNumber });
      const failed = ciStatus.details.workflow_runs.filter(r => r.conclusion === 'failure');
      const inProgress = ciStatus.details.workflow_runs.filter(r => r.status === 'in_progress');

      if (failed.length > 0) {
        prompt += '\n\n---\n\n**CI Status: ❌ Failing**\n';
        for (const run of failed) {
          prompt += `- ${run.name}: ${run.conclusion} (${run.html_url})\n`;
        }
        prompt += '\nPlease check the failing checks and fix the issues.';
      } else if (inProgress.length > 0) {
        prompt += '\n\n---\n\n**CI Status: 🔄 In Progress**\n';
        for (const run of inProgress) {
          prompt += `- ${run.name}: ${run.status}\n`;
        }
      } else {
        prompt += '\n\n---\n\n**CI Status: ✅ All checks passing**\n';
      }
    } catch {
      // CI status fetch failure is non-fatal
    }
  }

  return prompt;
}

/**
 * Format an {@link IssueOrPRThread} into a prompt string.
 *
 * Includes title, body, all comments (with author type labels), and
 * review comments for PRs. The user's instruction is appended at the end.
 *
 * @param thread - The fetched thread data.
 * @param instruction - User instruction (optional).
 * @returns Formatted prompt string.
 */
export function formatThreadAsPrompt(thread: IssueOrPRThread, instruction?: string): string {
  const parts: string[] = [];

  // Header
  const kind = thread.is_pull_request ? 'PR' : 'Issue';
  parts.push(`${kind} #${thread.number}: ${thread.title}`);

  // State
  parts.push(`State: ${thread.state}`);

  // Labels
  if (thread.labels.length > 0) {
    parts.push(`Labels: ${thread.labels.join(', ')}`);
  }

  // PR-specific metadata
  if (thread.is_pull_request) {
    if (thread.head_branch && thread.base_branch) {
      parts.push(`Branch: ${thread.head_branch} → ${thread.base_branch}`);
    }
  }

  // Body
  if (thread.body) {
    parts.push(`\nDescription:\n${thread.body}`);
  }

  // Comments (the agent's "memory")
  if (thread.comments.length > 0) {
    parts.push('\nThread comments:');
    for (const comment of thread.comments) {
      const author = comment.author_type === 'bot' ? `[Agent] ${comment.author}` : comment.author;
      const marker = comment.is_triggering_comment ? ' ⚡' : '';
      parts.push(`\n@${author}${marker}:\n${comment.body}`);
    }
  }

  // Review comments (PR only)
  if (thread.review_comments && thread.review_comments.length > 0) {
    parts.push('\nReview comments (inline):');
    for (const rc of thread.review_comments) {
      const location = rc.line !== null ? `${rc.path}:${rc.line}` : rc.path;
      parts.push(`\n@${rc.author} (${location}):\n${rc.body}`);
    }
  }

  // User instruction
  if (instruction) {
    parts.push(`\n\nComment/Instruction:\n${instruction}`);
  } else {
    parts.push('\n\nInstruction: ' + 'Continue working on this based on the thread context above.');
  }

  return parts.join('\n');
}

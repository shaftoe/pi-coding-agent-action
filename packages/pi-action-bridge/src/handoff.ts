/**
 * @file `/handoff` command — the sole write path (§2.1, §2.7).
 *
 * Orchestration that runs deterministically and delegates exactly one LLM step:
 *   parse args → guard (tui + model) → dirty-tree check (abort if dirty) →
 *   resolve branch → PR (create vs update) → gather session context
 *   (compaction-aware) → fetch LOCAL diff + truncate → one `complete()` call
 *   for Done/Next prose + PR title → push → create/update PR (gets author) →
 *   passive account-mismatch check → HITL review (`ctx.ui.editor`) →
 *   post `/pi` comment.
 *
 * The only LLM-authored content is the Done/Next prose + the one-line PR title.
 * Everything order-critical is TS. See CONSTITUTION §2.1 for the full rationale.
 *
 * Note on the step numbering in the doc: the steps are listed in true execution
 * order (data dependencies force it — `complete()` needs the diff+context; the
 * PR title comes from `complete()`; the mismatch check needs the PR create
 * response). This file follows that order.
 */

import { complete, type Message } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  convertToLlm,
  serializeConversation,
  BorderedLoader,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import { truncateDiff } from '@alexanderfortin/pi-orchestrator/pi/tools/get-pr-diff';
import type { Bridge } from './bridge.js';
import {
  detectDefaultBranch,
  findOpenPR,
  getLocalDiff,
  isCleanWorkingTree,
  createPR,
  updatePR,
  pushBranch,
  postHandoffComment,
} from './pull-request.js';

/** Same truncation budget as the read-only `get_pr_diff` tool (review pass 11). */
const DIFF_MAX_LINES = 1000;
const DIFF_MAX_BYTES = 102_400;

/**
 * Unique boundary separating the handoff prose from review-only content in
 * the editor prefill. Distinctive (never model-emitted) so a Markdown
 * horizontal rule (`---`) in the prose can't be mistaken for it — that
 * earlier split-on-`---` bug silently truncated `## Next` when the draft or
 * user included a rule between sections.
 */
export const REVIEW_FOOTER_BOUNDARY = '\n\n── review-only below (not posted) ──\n';

/** Review-only footer appended after the boundary in the editor prefill. */
export const REVIEW_FOOTER =
  '(Edit the Done/Next prose above. Save to post, or cancel to abort without commenting. The branch + PR are already pushed.)';

/**
 * The system prompt for the one-shot `complete()` call. The exact output format
 * is an implementation detail iterated against real model output (review pass
 * 11, finding 2) — fail-soft: if the response doesn't parse, the raw output is
 * dumped into the editor for the human to clean up.
 */
const HANDOFF_DRAFT_PROMPT = `You are drafting a handoff comment that transfers work from a local Pi session to a remote CI agent. The CI agent reads this as a normal \`/pi\` invocation and continues the work.

Given:
- The git diff of the feature branch (what's been changed)
- A serialized summary of the local session (what was attempted, decided, and tried)
- The developer's goal

Write a handoff in EXACTLY this format (no preamble, no trailing prose):

TITLE
<one-line PR title, imperative mood, ≤72 chars>

## Done
- <concise bullet per completed unit of work, grounded in the diff>

## Next
<2-4 sentences or bullets describing what remains, weaving in any developer guidance naturally>

Rules:
- The TITLE line is first, alone, then a blank line, then the headings.
- "Done" must be derivable from the diff — do not claim work that isn't there.
- "Next" is what the CI agent should do next, written as instructions to it.
- No version fields, no JSON, no HTML comments (they get stripped).`;

/** Parse the `complete()` response into { title, handoff } or return raw for fail-soft. */
export function parseDraft(raw: string): { title: string; handoff: string } | { raw: string } {
  const text = raw.trim();
  // Expected: "TITLE\n\n## Done\n...\n\n## Next\n..."
  const titleMatch = /^([^\n]+)\n+## Done\b/s.exec(text);
  if (!titleMatch?.[1]) {
    return { raw };
  }
  const title = titleMatch[1].trim().slice(0, 72);
  // The handoff body is everything from "## Done" onward.
  const handoffStart = text.indexOf('## Done');
  if (handoffStart < 0) {
    return { raw };
  }
  const handoff = text.slice(handoffStart).trim();
  return { title, handoff };
}

/**
 * Strip a leading `-y`/`--yes` flag from the args and return the remaining
 * goal text, trimmed. `-y add tests` → `add tests`; `add tests` → `add tests`.
 *
 * Without this, the flag leaked into the LLM goal (e.g. `## Goal\n-y add tests`).
 * Exported for unit testing.
 */
export function extractGoal(args: string): string {
  return args.replace(/^\s*(-y|--yes)\b\s*/, '').trim();
}

/** Build the final `/pi` comment body from the reviewed handoff prose. */
export function buildCommentBody(handoff: string): string {
  return `/pi 🤖 Handoff from local session\n\n${handoff}`;
}

/**
 * Decide what to post after the (optional) review step. Pure — the
 * skip/cancel/post branching lives here so it's unit-testable.
 *
 * This exists because the earlier inline logic conflated "review skipped"
 * (`-y`, `prefill = null`) with "review cancelled" (editor returned
 * `undefined`) via a single `null`, so `-y` matched the cancel guard and the
 * comment was never posted.
 */
export type PostDecision = { kind: 'post'; text: string } | { kind: 'cancelled' };

export function decidePost(opts: {
  skipReview: boolean;
  handoffProse: string;
  /** The edited text, or `undefined` when the user cancelled the editor. */
  editorResult: string | undefined;
}): PostDecision {
  // -y: post the drafted prose directly; no review step, so no footer/mismatch
  // note was ever appended — nothing to strip.
  if (opts.skipReview) {
    return { kind: 'post', text: opts.handoffProse };
  }
  if (opts.editorResult === undefined) {
    return { kind: 'cancelled' };
  }
  return { kind: 'post', text: stripReviewOnlySections(opts.editorResult) };
}

/**
 * The `/handoff` command handler. Registered by the extension factory; closes
 * over the {@link Bridge} built at `session_start`.
 */
export function registerHandoffCommand(pi: ExtensionAPI, bridge: Bridge): void {
  pi.registerCommand('handoff', {
    description:
      'Push branch, open/update the PR, and post a /pi handoff comment for the CI agent. ' +
      'Flags: -y/--yes to skip review and auto-post. Read the diff + session, draft Done/Next, ' +
      'human-review the draft, then post.',
    handler: async (args, ctx) => {
      await runHandoff(args, ctx, bridge);
    },
  });
}

/**
 * Injectable seams for {@link runHandoff}, so its control flow (the review /
 * cancel / post decision, and the one-shot `complete()` draft) is testable
 * without a TUI, network, or real model. The defaults use the real
 * implementations; tests override `draft`.
 */
export interface HandoffDeps {
  /** Generate the handoff draft (default: {@link runComplete}). */
  draft?: (ctx: ExtensionCommandContext, userPrompt: string) => Promise<string | null>;
}

/** The orchestration, separated so it's testable in isolation. */
// fallow-ignore-next-line complexity
export async function runHandoff(
  args: string,
  ctx: ExtensionCommandContext,
  bridge: Bridge,
  deps: HandoffDeps = {}
): Promise<void> {
  const skipReview = /^\s*(-y|--yes)\b/.test(args);
  const goal = extractGoal(args);

  // --- Guard: TUI mode + model available (§2.1 step 2) ---
  if (ctx.mode !== 'tui') {
    ctx.ui.notify('/handoff requires interactive (TUI) mode.', 'error');
    return;
  }
  if (!ctx.model) {
    ctx.ui.notify('No model selected — /handoff needs one to draft the summary.', 'error');
    return;
  }

  const cwd = bridge.context.workspace;
  const owner = bridge.context.repo.owner;
  const repo = bridge.context.repo.repo;
  const octokit = bridge.octokit;

  // --- Dirty-tree check (§2.1 step 3, Q7): abort, never mutate ---
  if (!(await isCleanWorkingTree(cwd))) {
    ctx.ui.notify(
      'Working tree is dirty — commit or stash first, then re-run /handoff.',
      'warning'
    );
    return;
  }

  // --- Resolve branch + existing PR (§2.1 step 4) ---
  const branch = await bridge.getCurrentBranch();
  if (!branch) {
    ctx.ui.notify('No current branch (detached HEAD?) — checkout a branch first.', 'warning');
    return;
  }
  const existingPR = await findOpenPR(octokit, owner, repo, branch);

  // --- Gather session context, compaction-aware (§2.1 step 5) ---
  // getBranch() returns the full lineage including pre-compaction entries;
  // feeding that naively duplicates against the compaction summary. We slice
  // to the last compaction boundary (keeps [compaction, ...entries from
  // firstKeptEntryId onward]) — mirrors the SDK's getHandoffMessages() helper.
  const conversationText = gatherConversationForDraft(ctx);

  // --- Local diff base (§2.1 step 6, fixed) ---
  // On an update, use the PR's ACTUAL base branch — read from the PR we just
  // found (no extra API call), never guessed. Guessing via detectDefaultBranch
  // trusts the local `origin/HEAD` symbolic-ref, which can be stale (it once
  // pointed at a retired `v1` branch and produced an empty diff + a misleading
  // "no diff against origin/v1" message). Only the create path (no existing
  // PR) falls back to detecting the repo's default branch.
  const base = existingPR ? existingPR.base : await detectDefaultBranch(cwd, octokit, owner, repo);
  const rawDiff = await getLocalDiff(cwd, base);
  if (!rawDiff) {
    ctx.ui.notify(
      `No diff against origin/${base}. Run \`git fetch origin ${base}\` and ensure your branch has commits.`,
      'warning'
    );
    return;
  }
  const diff = truncateDiff(rawDiff, DIFF_MAX_LINES, DIFF_MAX_BYTES).text;

  // --- One-shot model call (§2.1 step 7) ---
  const userPrompt = `## Goal\n${goal || 'Continue the work on this branch.'}\n\n## Diff\n\`\`\`diff\n${diff}\n\`\`\`\n\n## Session\n${conversationText}`;

  // `complete()` (and the auth resolution inside runComplete) can throw; catch
  // it like every other operation (push, PR, comment) so the user gets a clear
  // message instead of an unhandled rejection.
  let draft: string | null;
  try {
    draft = await (deps.draft ?? runComplete)(ctx, userPrompt);
  } catch (e) {
    ctx.ui.notify(`Handoff draft failed: ${(e as Error).message}`, 'error');
    return;
  }
  if (!draft) {
    ctx.ui.notify('Handoff draft cancelled or empty.', 'info');
    return;
  }
  const parsed = parseDraft(draft);

  // --- Push (§2.1 step 8) ---
  ctx.ui.setStatus('pi-handoff', 'Pushing branch…');
  try {
    await pushBranch(cwd);
  } catch (e) {
    ctx.ui.setStatus('pi-handoff', undefined);
    ctx.ui.notify(`Push failed: ${(e as Error).message}`, 'error');
    return;
  }
  ctx.ui.setStatus('pi-handoff', undefined);

  // --- Create / update PR (§2.1 step 9) — gets authorLogin for step 10 ---
  const hasTitle = 'title' in parsed;
  const title = hasTitle ? parsed.title : `Update ${branch}`;
  let prNumber: number;
  let authorLogin: string;
  try {
    if (existingPR) {
      const r = await updatePR(octokit, {
        owner,
        repo,
        number: existingPR.number,
        // Only pass title if we parsed one; undefined → omit on update.
        ...(hasTitle ? { title } : {}),
        head: branch,
        base,
      });
      prNumber = r.number;
      authorLogin = r.authorLogin;
    } else {
      const r = await createPR(octokit, {
        owner,
        repo,
        title: title ?? branch,
        head: branch,
        base,
      });
      prNumber = r.number;
      authorLogin = r.authorLogin;
    }
  } catch (e) {
    ctx.ui.notify(
      `PR create/update failed: ${(e as Error).message}. Re-run /handoff (push already happened; idempotent).`,
      'error'
    );
    return;
  }

  // --- Passive account-mismatch check (§2.1 step 10, Q3) ---
  const localIdentity = await bridge.getLocalGitIdentity();
  const mismatchNote =
    localIdentity && authorLogin !== 'unknown' && localIdentity !== authorLogin
      ? `\n\nℹ️ PR will be authored by \`${authorLogin}\`; commits are by \`${localIdentity}\`.`
      : '';

  // --- Review step (§2.1 step 11) + post decision ---
  // -y skips the editor; otherwise open it with prose + mismatch note + footer.
  // The decision (post/cancel) is a pure function (`decidePost`) so the skip /
  // cancel / post branching is unit-tested — it once conflated `null` here,
  // silently never posting on `-y` (the comment is the whole point).
  const handoffProse = 'handoff' in parsed ? parsed.handoff : parsed.raw;
  const editorResult = skipReview
    ? undefined
    : await ctx.ui.editor(
        `Review handoff${existingPR ? ' (update)' : ''} → PR #${prNumber}`,
        `${handoffProse}${mismatchNote}${REVIEW_FOOTER_BOUNDARY}${REVIEW_FOOTER}`
      );

  const decision = decidePost({ skipReview, handoffProse, editorResult });
  if (decision.kind === 'cancelled') {
    // Cancelled — push/PR happened, but no comment. Idempotent on retry.
    ctx.ui.notify(
      `Cancelled. Branch + PR #${prNumber} are up; no handoff comment posted. Re-run /handoff to retry.`,
      'info'
    );
    return;
  }

  // --- Post the /pi comment (§2.1 step 12) ---
  const body = buildCommentBody(decision.text);
  try {
    await postHandoffComment(octokit, { owner, repo, issueNumber: prNumber, body });
  } catch (e) {
    ctx.ui.notify(
      `Posting handoff comment failed: ${(e as Error).message}. PR #${prNumber} is open; post manually via \`gh pr comment ${prNumber} --body ...\`.`,
      'error'
    );
    return;
  }

  ctx.ui.notify(`Handoff posted on PR #${prNumber}.`, 'info');
}

/**
 * Map a session entry to an LLM message, or undefined if the entry doesn't
 * carry conversation content. Mirrors the SDK example's `entryToMessage`.
 */
function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
  if (entry.type === 'message') {
    return entry.message;
  }
  if (entry.type === 'compaction') {
    return {
      role: 'compactionSummary',
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    };
  }
  return undefined;
}

/**
 * Gather the session conversation for the draft, compaction-aware.
 *
 * `getBranch()` returns the full lineage including pre-compaction entries;
 * we slice from the last compaction boundary so the draft sees the current
 * context without duplicating pre-compaction messages against the summary.
 * Mirrors `examples/extensions/handoff.ts`'s `getHandoffMessages()`.
 */
function gatherConversationForDraft(ctx: ExtensionCommandContext): string {
  const branch = ctx.sessionManager.getBranch();
  let compactionIndex = -1;
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i]?.type === 'compaction') {
      compactionIndex = i;
      break;
    }
  }
  const entries = compactionIndex < 0 ? branch : branch.slice(compactionIndex);
  const messages = entries.map(entryToMessage).filter((m): m is AgentMessage => m !== undefined);
  return serializeConversation(convertToLlm(messages));
}

/** Run the one-shot `complete()` call with a loader. Returns the raw text or null (aborted). */
async function runComplete(
  ctx: ExtensionCommandContext,
  userPrompt: string
): Promise<string | null> {
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
  if (!auth.ok || !auth.apiKey) {
    throw new Error(auth.ok ? `No API key for ${ctx.model!.provider}` : auth.error);
  }

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const loader = new BorderedLoader(tui, theme, 'Drafting handoff…');
    loader.onAbort = () => done(null);

    const userMessage: Message = {
      role: 'user',
      content: [{ type: 'text', text: userPrompt }],
      timestamp: Date.now(),
    };

    complete(
      ctx.model!,
      { systemPrompt: HANDOFF_DRAFT_PROMPT, messages: [userMessage] },
      {
        apiKey: auth.apiKey!,
        ...(auth.headers ? { headers: auth.headers } : {}),
        signal: loader.signal,
      }
    )
      .then(response => {
        if (response.stopReason === 'aborted') {
          done(null);
          return;
        }
        const text = response.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text)
          .join('\n');
        done(text || null);
      })
      .catch(err => {
        ctx.ui.notify(`Handoff draft failed: ${(err as Error).message}`, 'error');
        done(null);
      });

    return loader;
  });
}

/**
 * Strip review-only sections (mismatch note + footer) from the posted body.
 *
 * Splits on the unique {@link REVIEW_FOOTER_BOUNDARY} (not a bare `---`, which
 * is a valid Markdown horizontal rule and would truncate legitimate prose that
 * uses one) and drops the `ℹ️` account-mismatch note line.
 */
export function stripReviewOnlySections(text: string): string {
  const withoutFooter = text.split(REVIEW_FOOTER_BOUNDARY)[0] ?? text;
  return withoutFooter
    .split('\n')
    .filter(line => !line.trim().startsWith('ℹ️'))
    .join('\n')
    .trim();
}

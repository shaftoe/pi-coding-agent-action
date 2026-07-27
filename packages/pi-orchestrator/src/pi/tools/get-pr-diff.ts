/**
 * @file get_pr_diff tool definition.
 *
 * Structure:
 *   - Pure helpers (`mergeIgnoreFiles`, `truncateDiffByBytes`,
 *     `truncateDiffByLines`, `truncateDiff`) — exported so they can be
 *     unit-tested directly. None of them touch the platform provider or
 *     any external state.
 *   - `resolvePRParams` — bridges tool params + platform context into
 *     the {owner, repo, pullNumber} triple. Already extracted (Step 2.3).
 *   - `getPRDiffToolFactory` — the entry point. Wires the tool definition,
 *     delegates the truncation math to the helpers above.
 */

import { Type, Static } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  GET_PR_DIFF_PROMPT_SNIPPET,
  GET_PR_DIFF_PROMPT_GUIDELINES,
  GET_PR_DIFF_DESCRIPTION,
  GET_PR_DIFF_PARAM_OWNER_DESCRIPTION,
  GET_PR_DIFF_PARAM_REPO_DESCRIPTION,
  GET_PR_DIFF_PARAM_PULL_NUMBER_DESCRIPTION,
  GET_PR_DIFF_PARAM_MAX_LINES_DESCRIPTION,
  GET_PR_DIFF_PARAM_IGNORE_FILES_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_GET_PR_DIFF } from './constants';
import { nullable, STRICT_JSON_SCHEMA } from './schema';
import { withCancellation } from './tool-execution';
import type { PlatformProvider } from '../../platform';
import type { DiffConfig } from '../../types';

/**
 * Schema for the get_pr_diff tool.
 */
const getPRDiffSchema = Type.Object(
  {
    owner: nullable(
      Type.String({
        description: GET_PR_DIFF_PARAM_OWNER_DESCRIPTION,
      })
    ),
    repo: nullable(
      Type.String({
        description: GET_PR_DIFF_PARAM_REPO_DESCRIPTION,
      })
    ),
    pull_number: nullable(
      Type.Integer({
        description: GET_PR_DIFF_PARAM_PULL_NUMBER_DESCRIPTION,
      })
    ),
    max_lines: nullable(
      Type.Integer({
        description: GET_PR_DIFF_PARAM_MAX_LINES_DESCRIPTION,
      })
    ),
    ignore_files: nullable(
      Type.Array(
        Type.String({
          description: GET_PR_DIFF_PARAM_IGNORE_FILES_DESCRIPTION,
        }),
        {
          description: GET_PR_DIFF_PARAM_IGNORE_FILES_DESCRIPTION,
        }
      )
    ),
  },
  { additionalProperties: false }
);

type GetPRDiffToolParams = Static<typeof getPRDiffSchema>;

interface GetPRDiffDetails {
  pull_number: number;
  lines: number;
  truncated: boolean;
  truncated_reason?: 'bytes' | 'lines';
  ignored_files?: string[];
  cancelled?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Merge default + caller-provided ignore patterns into a single deduped
 * list. Returns `undefined` when both inputs are empty (so callers can
 * omit the field from their `details` payload).
 */
export function mergeIgnoreFiles(
  defaultIgnore: string[],
  callerIgnore: string[]
): string[] | undefined {
  const merged = [...new Set([...defaultIgnore, ...callerIgnore])];
  return merged.length > 0 ? merged : undefined;
}

/** Marker appended to byte-truncated diffs. */
const BYTE_TRUNCATION_MARKER = (maxBytes: number) => `\n... (truncated at ${maxBytes} bytes)`;

/**
 * Truncate a diff to fit within `maxBytes`, walking back to a UTF-8
 * character boundary and then snapping to the last newline so we never
 * cut mid-line. Returns `{ text, truncated }`; `truncated` is `false`
 * when no truncation was needed.
 */
// fallow-ignore-next-line complexity
export function truncateDiffByBytes(
  diff: string,
  maxBytes: number
): {
  text: string;
  truncated: boolean;
} {
  if (Buffer.byteLength(diff, 'utf8') <= maxBytes) {
    return { text: diff, truncated: false };
  }

  const marker = BYTE_TRUNCATION_MARKER(maxBytes);
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const budget = maxBytes - markerBytes;
  const buf = Buffer.from(diff, 'utf8');
  let cutAt = Math.min(budget, buf.length);

  // Walk back to a safe UTF-8 boundary (never split a continuation byte).
  while (cutAt > 0 && ((buf[cutAt] ?? 0) & 0xc0) === 0x80) {
    cutAt--;
  }

  let sliced = buf.subarray(0, cutAt).toString('utf8');
  // Snap to the last newline so we don't cut mid-line.
  const lastNewline = sliced.lastIndexOf('\n');
  if (lastNewline > 0) {
    sliced = sliced.slice(0, lastNewline);
  }

  return { text: sliced + marker, truncated: true };
}

/**
 * Truncate a diff to at most `maxLines` lines, replacing the tail with
 * a "... (truncated at N lines, M more)" marker. Returns
 * `{ text, truncated }`; `truncated` is `false` when no truncation was
 * needed.
 */
export function truncateDiffByLines(
  diff: string,
  maxLines: number
): {
  text: string;
  truncated: boolean;
} {
  const lines = diff.split('\n');
  if (lines.length <= maxLines) {
    return { text: diff, truncated: false };
  }
  const remaining = lines.length - maxLines;
  return {
    text:
      lines.slice(0, maxLines).join('\n') +
      `\n... (truncated at ${maxLines} lines, ${remaining} more)`,
    truncated: true,
  };
}

/**
 * Result of running the diff-truncation pipeline.
 */
export interface TruncateDiffResult {
  text: string;
  truncated: boolean;
  truncatedReason?: 'bytes' | 'lines';
}

/**
 * Run the diff-truncation pipeline.
 *
 * Strategy: byte-budget first (catches minified single-line blobs), then
 * line-budget. Line truncation is skipped when byte truncation already
 * fired because the byte limit is the tighter constraint and already
 * snapped to a newline boundary.
 */
export function truncateDiff(diff: string, maxLines: number, maxBytes: number): TruncateDiffResult {
  const byteResult = truncateDiffByBytes(diff, maxBytes);
  if (byteResult.truncated) {
    return { text: byteResult.text, truncated: true, truncatedReason: 'bytes' };
  }
  const lineResult = truncateDiffByLines(diff, maxLines);
  if (lineResult.truncated) {
    return { text: lineResult.text, truncated: true, truncatedReason: 'lines' };
  }
  return { text: diff, truncated: false };
}

// ---------------------------------------------------------------------------
// Param resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the owner, repo, and pull number from params or platform context.
 */
// fallow-ignore-next-line complexity
export function resolvePRParams(
  params: GetPRDiffToolParams,
  provider: PlatformProvider
): { owner: string; repo: string; pullNumber: number } | undefined {
  const ctx = provider.getContext();

  const owner = params.owner ?? ctx.repo.owner;
  const repo = params.repo ?? ctx.repo.repo;
  const pullNumber = params.pull_number ?? ctx.issue.number;

  if (!owner || !repo || !pullNumber) {
    return undefined;
  }

  return { owner, repo, pullNumber };
}

// ---------------------------------------------------------------------------
// Result construction + execution (extracted for testability)
// ---------------------------------------------------------------------------

/** Result returned by the get_pr_diff tool handler. */
interface GetPRDiffResult {
  content: { type: 'text'; text: string }[];
  details: GetPRDiffDetails;
}

/**
 * Build a uniform tool result: a single text content block paired with
 * details. Collapses the three identical `{ content, details }` shapes the
 * handler emits across its resolve / no-diff / success branches.
 */
function diffToolResult(text: string, details: GetPRDiffDetails): GetPRDiffResult {
  return { content: [{ type: 'text', text }], details };
}

/**
 * Run the get_pr_diff handler logic: resolve → fetch → truncate → render.
 *
 * Extracted from {@link getPRDiffToolFactory} so the flow is a named,
 * directly-testable function (mirroring the file's other exported helpers).
 * The factory now only wires the tool definition and delegates here.
 *
 * @returns A text-content result; never throws for normal outcomes (missing
 *          params, empty diff) — only provider/network errors propagate.
 */
export async function executeGetPRDiff(
  params: GetPRDiffToolParams,
  provider: PlatformProvider,
  config?: DiffConfig
): Promise<GetPRDiffResult> {
  const resolved = resolvePRParams(params, provider);

  if (!resolved) {
    return diffToolResult(
      'Could not resolve PR: owner, repo, or pull_number missing and no PR context available.',
      { pull_number: 0, lines: 0, truncated: false }
    );
  }

  const { owner, repo, pullNumber } = resolved;

  const ignoreFiles = mergeIgnoreFiles(config?.diffIgnorePatterns ?? [], params.ignore_files ?? []);

  const diff = await provider.getPRDiff(owner, repo, pullNumber, ignoreFiles);

  if (!diff) {
    return diffToolResult(
      `No diff available for PR #${pullNumber}. This may not be a pull request, or the diff is empty.`,
      { pull_number: pullNumber, lines: 0, truncated: false }
    );
  }

  const maxLines = params.max_lines ?? config?.diffMaxLines ?? 1000;
  const maxBytes = config?.diffMaxBytes ?? 102_400;
  const truncated = truncateDiff(diff, maxLines, maxBytes);

  const details: GetPRDiffDetails = {
    pull_number: pullNumber,
    lines: truncated.text.split('\n').length,
    truncated: truncated.truncated,
    ...(truncated.truncatedReason ? { truncated_reason: truncated.truncatedReason } : {}),
  };
  if (ignoreFiles) {
    details.ignored_files = ignoreFiles;
  }

  return diffToolResult(`PR #${pullNumber} Diff:\n\`\`\`diff\n${truncated.text}\n\`\`\``, details);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Create the get_pr_diff tool definition bound to a platform provider.
 *
 * @param provider - The platform provider for PR diff operations.
 * @param config - Optional diff configuration (max lines, max bytes, default ignore patterns).
 * @returns The tool definition.
 */
export function getPRDiffToolFactory(provider: PlatformProvider, config?: DiffConfig) {
  return defineTool({
    name: 'get_pr_diff',
    label: 'Get PR Diff',
    description: GET_PR_DIFF_DESCRIPTION(provider.type),
    promptSnippet: GET_PR_DIFF_PROMPT_SNIPPET,
    promptGuidelines: GET_PR_DIFF_PROMPT_GUIDELINES(provider.type),
    parameters: getPRDiffSchema,
    constrainedSampling: STRICT_JSON_SCHEMA,
    execute: withCancellation<GetPRDiffToolParams, GetPRDiffDetails, GetPRDiffToolParams>({
      cancellationMessage: CANCELLATION_MESSAGE_GET_PR_DIFF,
      cancellationDetails: {
        pull_number: 0,
        lines: 0,
        truncated: false,
      },
      prepareParams: params => params,
      execute: params => executeGetPRDiff(params, provider, config),
    }),
  });
}

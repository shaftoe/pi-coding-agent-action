/**
 * @file CLI-side PlatformContext construction.
 *
 * Builds a {@link PlatformContext} from CLI args. The CLI has no real
 * CI/CD event payload — it uses sentinel values (`issue.number: 0`,
 * `payload: {}`, `eventName: 'cli'`) that the existing platform provider
 * code already defends against:
 *
 * - `addReaction()` no-ops when `payload.comment?.id` is missing.
 * - `createComment()` no-ops when `issue.number` is falsy.
 * - `getStartTimeFromContext()` returns `undefined` for unknown event names.
 * - `getContextType()` returns `undefined` for unknown event names, which
 *   also disables prompt enrichment.
 *
 * This lets M1 ship with no library change. A future milestone may promote
 * `'cli'` to a first-class event name in `pi-platform-github/src/context-utils.ts`
 * if explicit handling is needed.
 */

import type { PlatformContext } from '@alexanderfortin/pi-orchestrator';

/** Sentinel event name used by the CLI. Documented above. */
export const CLI_EVENT_NAME = 'cli';

/**
 * Result of parsing a `--repo owner/repo` flag.
 */
export interface RepoRef {
  owner: string;
  repo: string;
}

/**
 * Validation regex for a `--repo owner/repo` flag.
 *
 * Allows alphanumerics, dashes, underscores, dots, in both segments —
 * covers GitHub user/org names (incl. orgs with dots like `foo.config`)
 * and repo names with the same character set. Each segment must be at
 * least one character.
 */
const REPO_PATTERN = /^([\w.-]+)\/([\w.-]+)$/;

/**
 * Parse a `owner/repo` string into a {@link RepoRef}.
 *
 * @throws Error on malformed input with a message that names the offending
 *         value and shows the expected format.
 */
export function parseRepoFlag(raw: string): RepoRef {
  const match = REPO_PATTERN.exec(raw);
  if (!match) {
    throw new Error(
      `Invalid --repo value '${raw}'. Expected format: 'owner/repo' (e.g. 'shaftoe/pi-coding-agent-action').`
    );
  }
  const [, owner, repo] = match;
  if (!owner || !repo) {
    // Defensive — REPO_PATTERN guarantees non-empty captures, but noUncheckedIndexedAccess
    // forces us to convince the compiler.
    throw new Error(`Invalid --repo value '${raw}': owner or repo segment is empty.`);
  }
  return { owner, repo };
}

/**
 * Arguments used to build a CLI {@link PlatformContext}.
 */
export interface CliContextArgs {
  /** Repository owner + name. */
  repo: RepoRef;
  /** Working directory for the agent. */
  workspace: string;
  /** Server URL (e.g. `https://github.com`). */
  serverUrl: string;
  /** Git user name to attribute commits to (Co-authored-by trailers). Optional. */
  actor?: string;
  /** Current HEAD commit SHA. Optional. */
  sha?: string;
}

/**
 * Build a {@link PlatformContext} for CLI use.
 *
 * See file header for the rationale behind the sentinel values.
 */
export function buildPlatformContext(args: CliContextArgs): PlatformContext {
  return {
    repo: args.repo,
    issue: { number: 0 },
    eventName: CLI_EVENT_NAME,
    payload: {},
    serverUrl: args.serverUrl,
    runId: process.pid,
    workspace: args.workspace,
    ...(args.actor !== undefined ? { actor: args.actor } : {}),
    ...(args.sha !== undefined ? { sha: args.sha } : {}),
  };
}

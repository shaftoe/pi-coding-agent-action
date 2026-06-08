/**
 * @file CLI configuration gathering.
 *
 * Assembles a {@link PiConfig} from CLI args + the resolved provider token.
 * Mirrors `packages/pi-action/src/adapters/config.ts` (the GitHub Action's
 * equivalent), with CLI-specific defaults.
 *
 * M1 scope: only the subset of PiConfig fields needed to run a free-form
 * prompt end-to-end. M2 will add the full flag matrix (extensions,
 * thinking level, diff limits, exports, etc.).
 */

import type { PiConfig } from '@alexanderfortin/pi-orchestrator';
import { CLI_DEFAULT_SYSTEM_PROMPT } from './pi/default-system-prompt.js';
import { CLI_INTERACTIVE_SYSTEM_PROMPT } from './interactive/interactive-system-prompt.js';

/**
 * Arguments collected by the `run` command's commander setup.
 *
 * Kept as a plain interface (not commander's typed Option values) so it's
 * trivial to construct in tests.
 */
export interface CliRunArgs {
  /** Positional prompt argument. */
  prompt: string;
  /** LLM provider id (e.g. 'anthropic'). */
  provider: string;
  /** LLM model id (e.g. 'claude-sonnet-4-5'). */
  model: string;
  /** Working directory. Defaults to process.cwd() in the caller. */
  cwd: string;
}

/**
 * Build a {@link PiConfig} from CLI args + the resolved provider token.
 *
 * M1 only sets the fields strictly required by the orchestrator. Optional
 * fields default to the same values the action uses, except:
 *
 * - `systemPrompt` is set to {@link CLI_DEFAULT_SYSTEM_PROMPT} (terminal-tuned).
 * - `loadBuiltinExtensions` is `true` (M2 will add the `--load-builtin-extensions` flag).
 * - `thinkingLevel` is `'off'` (M2 will add `--thinking`).
 * - `exportSessionHtml`/`exportSessionJsonl` are both `false` (M2 will add flags).
 * - `packageDir` is intentionally omitted — the CLI runs from a normal
 *   node_modules layout, so the SDK resolves its own package directory.
 */
export function gatherCliConfig(args: CliRunArgs, providerToken: string): PiConfig {
  return {
    provider: args.provider,
    model: args.model,
    token: providerToken,
    thinkingLevel: 'off',
    promptInput: args.prompt,
    loadBuiltinExtensions: true,
    exportSessionHtml: false,
    exportSessionJsonl: false,
    autoCompaction: false,
    systemPrompt: CLI_DEFAULT_SYSTEM_PROMPT,
    cwd: args.cwd,
  };
}

/**
 * Arguments for interactive (issue/PR-aware) commands.
 *
 * Extends the basic run args with a pre-built prompt (enriched with
 * thread context) and a `postComment` flag that controls whether
 * the response is posted as a GitHub comment.
 */
export interface InteractiveConfigArgs {
  /** Pre-built prompt (already enriched with thread context). */
  prompt: string;
  /** LLM provider id (e.g. 'anthropic'). */
  provider: string;
  /** LLM model id (e.g. 'claude-sonnet-4-5'). */
  model: string;
  /** Working directory. Defaults to process.cwd() in the caller. */
  cwd: string;
  /** Whether to post the response as a GitHub comment. Default: true. */
  postComment?: boolean;
}

/**
 * Build a {@link PiConfig} for interactive (issue/PR-aware) commands.
 *
 * Uses the interactive system prompt (which tells the agent about
 * mixed CLI/GitHub mode and thread-as-memory) instead of the
 * free-form prompt.
 */
export function gatherInteractiveConfig(
  args: InteractiveConfigArgs,
  providerToken: string
): PiConfig {
  return {
    provider: args.provider,
    model: args.model,
    token: providerToken,
    thinkingLevel: 'off',
    promptInput: args.prompt,
    loadBuiltinExtensions: true,
    exportSessionHtml: false,
    exportSessionJsonl: false,
    autoCompaction: false,
    systemPrompt: CLI_INTERACTIVE_SYSTEM_PROMPT,
    cwd: args.cwd,
  };
}

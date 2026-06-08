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
 *   node_modules layout, so the SDK resolves its own package directory
 *   via the now-exported `getPackageDir()`.
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

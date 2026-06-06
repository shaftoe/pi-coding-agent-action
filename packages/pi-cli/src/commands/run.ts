/**
 * @file `pi-cli run` command implementation.
 *
 * Wires together: argv parsing → token resolution → Octokit + platform
 * provider construction → orchestrator execution → output rendering.
 *
 * Mirrors the structure of `packages/pi-action/src/run.ts` but without
 * the GitHub-Actions-specific bits (`@actions/core`, `@actions/github`,
 * `PI_PACKAGE_DIR`, workflow log commands).
 */

import { ActionOrchestrator } from '@alexanderfortin/pi-orchestrator';
import { createGitHubPlatformProvider, detectPlatform } from '@alexanderfortin/pi-platform-github';
import { CliGitAdapter } from '../adapters/git-adapter.js';
import { CliLogger, type LogLevel } from '../adapters/logger.js';
import { CliOutputSink } from '../adapters/output-sink.js';
import { createCliPiAgent } from '../adapters/pi-agent.js';
import { resolveGitHubToken, resolveProviderToken, PROVIDER_ENV_VARS } from '../auth.js';
import { buildPlatformContext, parseRepoFlag } from '../context.js';
import { gatherCliConfig } from '../config.js';
import { createCliOctokit } from '../octokit.js';

/**
 * Parsed flags for the `run` command (commander-shaped, see {@link
 * makeRunCommand}).
 */
export interface RunCommandArgs {
  prompt: string;
  repo: string;
  provider: string;
  model: string;
  cwd: string;
  serverUrl: string;
  verbose: boolean;
  quiet: boolean;
}

/**
 * Resolve the {@link LogLevel} from --verbose / --quiet flags.
 *
 * Mutually exclusive: if both are set, throws. This is enforced at the
 * command level (commander doesn't natively support mutex options).
 */
export function resolveLogLevel(args: Pick<RunCommandArgs, 'verbose' | 'quiet'>): LogLevel {
  if (args.verbose && args.quiet) {
    throw new Error('Flags --verbose and --quiet are mutually exclusive.');
  }
  if (args.verbose) {
    return 'debug';
  }
  if (args.quiet) {
    return 'error';
  }
  return 'warning';
}

/**
 * Run the `pi-cli run` command end-to-end.
 *
 * Two error classes:
 *
 * 1. **Setup errors** (token missing, repo bad, --verbose+--quiet mutex):
 *    thrown before the orchestrator runs; propagate to `main()`'s outer
 *    catch which prints a ✖ line and sets `process.exitCode = 1`.
 *
 * 2. **Orchestrator errors** (LLM failure, network): the orchestrator
 *    catches them internally, calls `outputSink.setFailed()`, then
 *    re-throws. We catch and swallow the re-throw (the orchestrator
 *    already reported via the output sink), then flush in `finally`
 *    which renders the error and sets `process.exitCode = 1`. This
 *    avoids the double-printed ✖ line reported in review item #1.
 */
// fallow-ignore-next-line complexity
export async function runCommand(args: RunCommandArgs): Promise<void> {
  const level = resolveLogLevel(args);
  const logger = new CliLogger(level);
  const outputSink = new CliOutputSink();

  // --- Auth (setup error if missing) ----------------------------------
  // Validate --provider against the known env-var table BEFORE hitting
  // resolveGitHubToken/resolveProviderToken. This way a typo in
  // --provider (e.g. 'anthrpic') fails fast with a clear message
  // instead of first asking for both tokens. (Review item #11.)
  const providerEnvVar = PROVIDER_ENV_VARS[args.provider];
  if (!providerEnvVar) {
    throw new Error(
      `Unknown provider '${args.provider}'. ` +
        `Check the supported list at https://docs.pi.dev/providers.`
    );
  }

  const githubToken = resolveGitHubToken();
  const providerToken = resolveProviderToken(args.provider);

  // --- Octokit + platform provider (setup error if --repo bad) --------
  const repo = parseRepoFlag(args.repo);
  const octokit = createCliOctokit(githubToken, args.serverUrl);
  const platformContext = buildPlatformContext({
    repo,
    workspace: args.cwd,
    serverUrl: args.serverUrl,
  });
  const platformType = detectPlatform(args.serverUrl);
  const provider = createGitHubPlatformProvider({
    octokit,
    context: platformContext,
    logger,
    platformType,
  });
  const git = new CliGitAdapter(provider);

  // --- Config + orchestrator -------------------------------------------
  const config = gatherCliConfig(
    {
      prompt: args.prompt,
      provider: args.provider,
      model: args.model,
      cwd: args.cwd,
    },
    providerToken
  );

  const orchestrator = new ActionOrchestrator(
    config,
    logger,
    outputSink,
    git,
    createCliPiAgent,
    provider
  );

  // catch+swallow + finally: see method header — orchestrator re-throws
  // after calling setFailed; we absorb the throw and let flush() render.
  try {
    await orchestrator.execute();
  } catch {
    // Swallow — orchestrator already reported via outputSink.setFailed().
  } finally {
    outputSink.flush('stdout');
  }
}

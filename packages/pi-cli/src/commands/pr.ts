/**
 * @file `pi-cli pr` command implementation.
 *
 * Runs the agent against a specific GitHub pull request, providing full
 * thread context, the PR diff, and optionally CI status. The agent's
 * response is output to stdout and optionally posted as a comment on the PR.
 *
 * This enables the "continue in CLI after CI" workflow:
 * 1. Agent creates PR (from CLI or Action)
 * 2. CI triggers and fails
 * 3. Developer runs `pi-cli pr <number> --repo <repo> --ci-aware "fix the CI"`
 * 4. Agent reads thread, sees CI failures, fixes and pushes
 */

import { ActionOrchestrator } from '@alexanderfortin/pi-orchestrator';
import {
  createGitHubPlatformProvider,
  detectPlatform,
  isKnownServerUrl,
} from '@alexanderfortin/pi-platform-github';
import { CliGitAdapter } from '../adapters/git-adapter.js';
import { CliLogger } from '../adapters/logger.js';
import { CliOutputSink } from '../adapters/output-sink.js';
import { createCliPiAgent } from '../adapters/pi-agent.js';
import { resolveGitHubToken, resolveProviderToken, PROVIDER_ENV_VARS } from '../auth.js';
import { parseRepoFlag, type RepoRef } from '../context.js';
import { gatherInteractiveConfig } from '../config.js';
import { createCliOctokit } from '../octokit.js';
import { resolveLogLevel } from './run.js';
import { buildInteractiveContext } from '../interactive/context-builder.js';
import { buildPRPrompt } from '../interactive/prompt-builder.js';
import {
  detectRepoFromGitRemote,
  detectHeadSha,
  detectGitUser,
} from '../interactive/git-detection.js';

/**
 * Parsed flags for the `pr` command.
 */
export interface PRCommandArgs {
  /** PR number. */
  number: number;
  /** Repository (owner/repo). Optional — auto-detected from git remote. */
  repo?: string | undefined;
  /** LLM provider id. */
  provider: string;
  /** LLM model id. */
  model: string;
  /** Optional instruction override. */
  instruction?: string | undefined;
  /** Working directory. Defaults to process.cwd(). */
  cwd: string;
  /** Server URL. Default: https://github.com. */
  serverUrl: string;
  /** Post response as comment on the PR. Default: true. */
  postComment: boolean;
  /** Include PR diff in context. Default: true. */
  includeDiff: boolean;
  /** Include CI status in context. Default: true. */
  ciAware: boolean;
  /** Maximum comments to fetch from thread. Default: 100. */
  maxComments: number;
  /** Verbose logging. */
  verbose: boolean;
  /** Quiet mode. */
  quiet: boolean;
}

/**
 * Resolve the --repo flag or auto-detect from git remote.
 *
 * @throws Error if neither --repo nor git remote detection succeeds.
 */
function resolveRepo(repoFlag: string | undefined, cwd: string): RepoRef {
  if (repoFlag !== undefined && repoFlag !== '') {
    return parseRepoFlag(repoFlag);
  }

  const detected = detectRepoFromGitRemote(cwd);
  if (!detected) {
    throw new Error(
      'Could not auto-detect repository from git remote. ' +
        'Use --repo owner/repo to specify the target repository.'
    );
  }
  return detected;
}

/**
 * Run the `pi-cli pr` command.
 *
 * Fetches the PR thread + diff + CI status, builds an enriched prompt,
 * and runs the agent with full context.
 */
export async function prCommand(args: PRCommandArgs): Promise<void> {
  const level = resolveLogLevel(args);
  const logger = new CliLogger(level);
  const outputSink = new CliOutputSink();

  // --- Validate provider -----------------------------------------------
  const providerEnvVar = PROVIDER_ENV_VARS[args.provider];
  if (!providerEnvVar) {
    throw new Error(
      `Unknown provider '${args.provider}'. ` +
        `Check the supported list at https://docs.pi.dev/providers.`
    );
  }

  // --- Auth ------------------------------------------------------------
  const githubToken = resolveGitHubToken();
  const providerToken = resolveProviderToken(args.provider);

  // --- Resolve repo ----------------------------------------------------
  const repo = resolveRepo(args.repo, args.cwd);

  // --- Build platform context ------------------------------------------
  const octokit = createCliOctokit(githubToken, args.serverUrl);
  const platformType = detectPlatform(args.serverUrl);

  if (!isKnownServerUrl(args.serverUrl)) {
    logger.warning(`Unrecognized git host '${args.serverUrl}'; assuming GitHub-compatible API.`);
  }

  // Detect extra git info
  const sha = detectHeadSha(args.cwd);
  const actor = detectGitUser(args.cwd);

  const platformContext = buildInteractiveContext({
    repo,
    issueOrPRNumber: args.number,
    isPR: true,
    workspace: args.cwd,
    serverUrl: args.serverUrl,
    actor,
    sha,
  });

  const provider = createGitHubPlatformProvider({
    octokit,
    context: platformContext,
    logger,
    platformType,
  });

  // --- Build enriched prompt ------------------------------------------
  const prompt = await buildPRPrompt(
    provider,
    {
      issueNumber: args.number,
      owner: repo.owner,
      repo: repo.repo,
      instruction: args.instruction,
      includeDiff: args.includeDiff,
      includeCI: args.ciAware,
      maxComments: args.maxComments,
    },
    repo.owner,
    repo.repo
  );

  logger.info(`Targeting PR #${args.number} in ${repo.owner}/${repo.repo}`);

  // --- Config + orchestrator -------------------------------------------
  const config = gatherInteractiveConfig(
    {
      prompt,
      provider: args.provider,
      model: args.model,
      cwd: args.cwd,
      postComment: args.postComment,
    },
    providerToken
  );

  const git = new CliGitAdapter(provider);

  const orchestrator = new ActionOrchestrator(
    config,
    logger,
    outputSink,
    git,
    createCliPiAgent,
    provider
  );

  try {
    await orchestrator.execute();
  } catch {
    // Swallow — orchestrator already reported via outputSink.setFailed().
  } finally {
    outputSink.flush('stdout');
  }
}

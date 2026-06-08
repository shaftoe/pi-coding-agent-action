/**
 * @file `pi-cli issue` command implementation.
 *
 * Runs the agent against a specific GitHub issue, providing full thread
 * context (title, body, all comments) as the agent's memory. The agent's
 * response is output to stdout and optionally posted as a comment on the issue.
 *
 * This is the core of the mixed CLI/GitHub workflow: the developer invokes
 * the CLI locally, but the agent operates with the same context and
 * capabilities as when triggered by the GitHub Action. Thread comments
 * serve as persistent memory across CLI and Action invocations.
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
import { buildInteractiveContext, detectIsPR } from '../interactive/context-builder.js';
import { buildIssuePrompt } from '../interactive/prompt-builder.js';
import {
  detectRepoFromGitRemote,
  detectHeadSha,
  detectGitUser,
} from '../interactive/git-detection.js';

/**
 * Parsed flags for the `issue` command.
 */
export interface IssueCommandArgs {
  /** Issue or PR number. */
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
  /** Post response as comment on the issue. Default: true. */
  postComment: boolean;
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
 * Run the `pi-cli issue` command.
 *
 * Fetches the issue thread, builds an enriched prompt, and runs the
 * agent with full context.
 */
export async function issueCommand(args: IssueCommandArgs): Promise<void> {
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
    isPR: false, // will be corrected below if it's actually a PR
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

  // --- Check if it's actually a PR ------------------------------------
  let isPR = false;
  try {
    isPR = await detectIsPR(octokit, repo.owner, repo.repo, args.number);
  } catch {
    // If we can't detect, treat as issue
  }

  // Rebuild context if it's actually a PR
  const finalContext = isPR
    ? buildInteractiveContext({
        repo,
        issueOrPRNumber: args.number,
        isPR: true,
        workspace: args.cwd,
        serverUrl: args.serverUrl,
        actor,
        sha,
      })
    : platformContext;

  // Rebuild provider with corrected context
  const finalProvider = isPR
    ? createGitHubPlatformProvider({
        octokit,
        context: finalContext,
        logger,
        platformType,
      })
    : provider;

  // --- Build enriched prompt ------------------------------------------
  const prompt = await buildIssuePrompt(finalProvider, {
    issueNumber: args.number,
    owner: repo.owner,
    repo: repo.repo,
    instruction: args.instruction,
    maxComments: args.maxComments,
  });

  logger.info(`Targeting ${isPR ? 'PR' : 'Issue'} #${args.number} in ${repo.owner}/${repo.repo}`);

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

  const git = new CliGitAdapter(finalProvider);

  const orchestrator = new ActionOrchestrator(
    config,
    logger,
    outputSink,
    git,
    createCliPiAgent,
    finalProvider
  );

  try {
    await orchestrator.execute();
  } catch {
    // Swallow — orchestrator already reported via outputSink.setFailed().
  } finally {
    outputSink.flush('stdout');
  }
}

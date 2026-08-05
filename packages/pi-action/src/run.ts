/**
 * @file GitHub Action entry point.
 *
 * Orchestrates the action by creating adapters, gathering configuration,
 * and passing them to the ActionOrchestrator which handles the complete
 * execution flow.
 */

import * as path from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { bedrockProviderModule } from '@earendil-works/pi-ai/bedrock-provider';
import { setBedrockProviderModule } from '@earendil-works/pi-ai/compat';
import { ActionOrchestrator } from '@alexanderfortin/pi-orchestrator';
import { RealCoreAdapter } from './adapters/core-adapter';
import { RealGitAdapter } from './adapters/git-adapter';
import { createRealPiAgent } from './adapters/pi-agent-adapter';
import { gatherActionsConfig } from './adapters/config';
import { ActionsOutputSink } from './adapters/output-sink';
import {
  createGitHubPlatformProvider,
  parsePlatformType,
  apiBaseUrlFromServerUrl,
} from '@alexanderfortin/pi-platform-github';
import { resolveServerUrl } from './server-url';

/**
 * Configure the Pi SDK's package directory for the bundled action.
 *
 * When the action runs from its bundled `dist/index.js`, the SDK's
 * `getPackageDir()` walks up from `__dirname` and finds the action's
 * `package.json` instead of the SDK's. The build script copies the SDK's
 * export-html assets into `dist/pi-sdk/`. Setting `PI_PACKAGE_DIR` tells
 * the SDK where to find those assets — it's the SDK's documented escape
 * hatch for bundled deployments.
 *
 * This is always needed here because `run.ts` is only executed as the
 * bundled action entry point. Library/CLI/other consumers never go
 * through this path.
 */
function ensurePackageDirOverride(): void {
  process.env.PI_PACKAGE_DIR = path.join(__dirname, 'pi-sdk');
}

/**
 * Statically register the bedrock provider so it works in the bundled action.
 *
 * The pi-ai SDK lazily loads provider implementations through a
 * variable-specifier dynamic `import()` — deliberately hidden from bundlers
 * so that heavy Node-only SDKs (e.g. AWS) aren't pulled into browser/binary
 * builds. esbuild cannot follow a non-literal specifier, so the bedrock
 * implementation is **not** inlined into `dist/index.js`. At runtime the
 * lazy wrapper resolves `import("./bedrock-converse-stream.js")` relative
 * to `dist/index.js`, but that file doesn't exist — causing
 * `Cannot find module '.../dist/bedrock-converse-stream.js'`.
 *
 * `setBedrockProviderModule()` is the SDK's escape hatch for bundled
 * environments: registering a statically imported module makes the lazy
 * wrapper skip the dynamic import entirely. This mirrors the SDK's own Bun
 * binary build (`bun/register-bedrock.js`).
 */
function ensureBedrockProviderRegistered(): void {
  setBedrockProviderModule(bedrockProviderModule);
}

/**
 * Run the Pi coding agent end-to-end.
 *
 * Creates real adapters for Core, Git platform, and Pi agent, gathers
 * configuration from GitHub Action inputs, and passes them to the
 * orchestrator which handles the execution flow.
 *
 * @throws Rethrows any error from the orchestrator.
 */
// fallow-ignore-next-line complexity
export async function run() {
  // Set PI_PACKAGE_DIR once at startup so the SDK's getPackageDir()
  // resolves to the bundled assets in dist/pi-sdk/.
  ensurePackageDirOverride();

  // Register the bedrock provider statically so the SDK's lazy-loading
  // mechanism doesn't try to dynamically import a non-existent file.
  ensureBedrockProviderRegistered();

  const coreAdapter = new RealCoreAdapter();
  const config = gatherActionsConfig();
  const outputSink = new ActionsOutputSink();

  // Resolve the platform type early — it's needed for both the Octokit API
  // base URL derivation (below) and the platform provider.
  const platformType = parsePlatformType(coreAdapter.getInput('platform'), raw =>
    coreAdapter.warning(
      `Unknown platform "${raw}"; falling back to github. ` +
        'Valid values are github, codeberg, forgejo (or gitea).'
    )
  );

  // Create Octokit from the github_token input.
  //
  // For Forgejo/Codeberg we explicitly derive the API base URL from the
  // runner-advertised server URL (ensuring the /api/v1 prefix is present).
  // @actions/github's getOctokit() falls back to GITHUB_API_URL, which is
  // reliable on GitHub but may be missing or misconfigured (no /api/v1) on
  // some Forgejo runner versions — leading to 404s on every REST call.
  //
  // We use the runner-advertised server URL (github.context.serverUrl), not
  // the server_url *override*, because the API must be reachable from inside
  // the runner — the override is for externally-visible permalinks only.
  //
  // For GitHub (including GHES) we let getOctokit use GITHUB_API_URL as-is.
  const runnerServerUrl = resolveServerUrl(undefined, github.context.serverUrl);
  const apiBaseUrl =
    platformType === 'forgejo' || platformType === 'codeberg'
      ? apiBaseUrlFromServerUrl(runnerServerUrl, platformType)
      : undefined;
  const octokit = github.getOctokit(
    coreAdapter.getInput('github_token'),
    apiBaseUrl ? { baseUrl: apiBaseUrl } : {}
  );

  // Build PlatformContext from the @actions/github singleton
  const githubCtx = github.context as { actor?: string; sha?: string };

  // When pr_number is provided (e.g. workflow_dispatch), override the
  // issue number so all downstream tools target the specified PR.
  const prNumber = config.prNumber;
  const issueNumber = prNumber ?? github.context.issue.number;

  // Build the payload, injecting a pull_request stub when pr_number is set
  // so that isPR() and getContextType() work without event-specific context.
  const payload = { ...(github.context.payload as Record<string, unknown>) };
  if (prNumber) {
    payload.pull_request = payload.pull_request ?? { number: prNumber };
  }

  // Resolve the effective server URL. The `server_url` input overrides the
  // runner-advertised `GITHUB_SERVER_URL` (via `github.context.serverUrl`) —
  // useful on self-hosted runners where the advertised URL is only reachable
  // from inside the host network. Falls back to github.com.
  //
  // The baseline is derived through the same helper so both sides of the
  // "override active" comparison are trailing-slash-normalized identically —
  // a raw `github.context.serverUrl` comparison would log a false positive
  // when the advertised URL has a trailing slash (and a false negative when
  // an equivalent override differs only by a trailing slash).
  const serverUrlInput = coreAdapter.getInput('server_url');
  const serverUrl = resolveServerUrl(serverUrlInput, github.context.serverUrl);
  const baselineServerUrl = resolveServerUrl(undefined, github.context.serverUrl);
  if (serverUrl !== baselineServerUrl) {
    coreAdapter.info(
      `[run] server_url override active: using ${serverUrl} (runner advertises ${baselineServerUrl})`
    );
  }

  const platformContext = {
    repo: github.context.repo,
    issue: { number: issueNumber },
    eventName: github.context.eventName,
    payload,
    serverUrl,
    runId: github.context.runId,
    runNumber: github.context.runNumber,
    workspace: process.env.GITHUB_WORKSPACE ?? process.cwd(),
    ...(githubCtx.actor !== undefined ? { actor: githubCtx.actor } : {}),
    ...(githubCtx.sha !== undefined ? { sha: githubCtx.sha } : {}),
  };

  // Create the platform provider with explicit deps (no singletons)
  const triggerValue = coreAdapter.getInput('trigger');
  const branchNameTemplate = coreAdapter.getInput('branch_name_template');
  const platformProvider = createGitHubPlatformProvider({
    octokit,
    context: platformContext,
    logger: coreAdapter,
    platformType,
    ...(triggerValue ? { trigger: triggerValue } : {}),
    ...(branchNameTemplate ? { branchNameTemplate } : {}),
  });

  // Create the git adapter with explicit deps.
  // platformType is threaded through so the footer URL builder
  // (buildActionRunUrl) can pick the correct URL format for the
  // target platform (e.g. Forgejo/Codeberg job-level URLs).
  const gitAdapter = new RealGitAdapter(coreAdapter, octokit, platformContext, platformType);

  const orchestrator = new ActionOrchestrator(
    config,
    coreAdapter, // CoreAdapter extends Logger
    outputSink,
    gitAdapter,
    createRealPiAgent,
    platformProvider
  );

  await orchestrator.execute();
}

run().catch(error => {
  // Safety net – the orchestrator should have already called core.setFailed,
  // but ensure the action is always marked as failed on any unhandled error.
  console.error('Unhandled error in run():', error);
  core.setFailed(`Unhandled error: ${error instanceof Error ? error.message : String(error)}`);
});

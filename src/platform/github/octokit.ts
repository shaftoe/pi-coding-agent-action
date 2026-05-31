/**
 * @file Shared Octokit client singleton.
 *
 * Provides a lazily-initialised GitHub REST API client (`Octokit`) that is
 * shared across all modules in the `github/` directory.
 *
 * The Octokit instance can be set externally via the module context
 * (decoupled from `@actions/github`), or lazily created from the
 * `@actions/github` singleton as a fallback.
 */

import * as github from '@actions/github';
import { getCoreAdapter, getModuleOctokit } from './index';

/** Cached Octokit instance (created once on first call to {@link getOctokit}). */
let _octokit: ReturnType<typeof github.getOctokit> | undefined;

/**
 * Get the shared Octokit client instance.
 *
 * Returns the externally-injected Octokit if available (set via the module
 * context through `createGitHubPlatformProvider(deps)`). Otherwise creates one
 * from the `@actions/github` singleton using the `github_token` action input.
 *
 * @returns An authenticated Octokit client.
 */
export function getOctokit(): ReturnType<typeof github.getOctokit> {
  // Prefer externally-injected Octokit from module context
  try {
    const injected = getModuleOctokit();
    _octokit = injected;
    return _octokit;
  } catch {
    // No injected Octokit — fall through to legacy creation
  }

  _octokit ??= github.getOctokit(getCoreAdapter().getInput('github_token'));
  return _octokit;
}

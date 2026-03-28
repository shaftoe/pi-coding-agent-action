/**
 * @file Shared Octokit client singleton.
 *
 * Provides a lazily-initialised GitHub REST API client (`Octokit`) that is
 * shared across all modules in the `github/` directory. The client reads the
 * `github_token` action input on first access.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';

/** Cached Octokit instance (created once on first call to {@link getOctokit}). */
let _octokit: ReturnType<typeof github.getOctokit> | undefined;

/**
 * Get the shared Octokit client instance.
 *
 * On the first call the client is created using the `github_token` action input.
 * Subsequent calls return the cached instance.
 *
 * @returns An authenticated {@link Octokit} client.
 */
export function getOctokit() {
  _octokit ??= github.getOctokit(core.getInput('github_token'));
  return _octokit;
}

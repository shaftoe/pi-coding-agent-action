/**
 * @file Shared context accessor for the GitHub platform module.
 *
 * Provides a unified `getGitHubContext()` function that returns the
 * platform context injected via `createGitHubPlatformProvider()`,
 * falling back to the `@actions/github` singleton for backward
 * compatibility.
 *
 * This decouples the platform module from the `@actions/github`
 * global singleton while maintaining full backward compatibility.
 */

import * as github from '@actions/github';
import { getModulePlatformContext } from './index';

/**
 * GitHub context type matching @actions/github's context shape.
 */
export type GitHubContext = typeof github.context;

/**
 * Get the current GitHub context.
 *
 * Returns the injected platform context if available (set via
 * `createGitHubPlatformProvider(deps)`), otherwise falls back
 * to the `@actions/github` singleton.
 *
 * @returns The GitHub context object.
 */
export function getGitHubContext(): GitHubContext {
  try {
    const pc = getModulePlatformContext();
    // PlatformContext has the same shape as GitHubContext but with looser payload typing.
    // Cast through unknown to bridge the gap.
    return pc as unknown as GitHubContext;
  } catch {
    return github.context;
  }
}

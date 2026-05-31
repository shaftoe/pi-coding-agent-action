/**
 * @file GitHub/Codeberg/Forgejo module barrel export.
 *
 * Re-exports public symbols used by consumers outside the github/ module.
 * Internal implementation details are not exported from this barrel file.
 *
 * Supports GitHub, Codeberg, and self-hosted Forgejo instances.
 */

import type { CoreAdapter, Logger } from '../../types';
import type { PlatformContext } from '../types';

type OctokitInstance = ReturnType<typeof import('@actions/github').getOctokit>;

/**
 * GitHub module context manager.
 *
 * Encapsulates the CoreAdapter instance used throughout the github module.
 * This class provides a centralized, explicit way to manage the module's
 * dependencies with proper initialization validation.
 *
 * Design rationale:
 * - The github module functions are called by Pi tools, which don't have
 *   access to the CoreAdapter through normal DI chains
 * - Setting the context once at initialization is simpler than threading
 *   CoreAdapter through every function call
 * - Explicit initialization checks prevent silent failures from using
 *   uninitialized state
 * - The reset() method enables clean test isolation
 */
class GitHubModuleContext {
  private _coreAdapter: CoreAdapter | undefined;
  private _octokit: OctokitInstance | undefined;
  private _platformContext: PlatformContext | undefined;

  /**
   * Set the CoreAdapter for the github module.
   *
   * Must be called before any github functions that require logging or
   * input retrieval. Typically called once during Action initialization.
   *
   * @param core - The CoreAdapter instance to use.
   * @throws {Error} If called with undefined adapter.
   */
  setCoreAdapter(core: CoreAdapter): void {
    if (core === undefined) {
      throw new Error('CoreAdapter must be a valid instance, not undefined');
    }
    this._coreAdapter = core;
  }

  /**
   * Get the CoreAdapter for the github module.
   *
   * @returns The CoreAdapter instance.
   * @throws {Error} If the context has not been initialized.
   */
  getCoreAdapter(): CoreAdapter {
    if (!this._coreAdapter) {
      throw new Error(
        'GitHub module context not initialized. ' +
          'Call setCoreAdapter() before using github functions. ' +
          'In tests, use resetModuleContext() to set a test adapter.'
      );
    }
    return this._coreAdapter;
  }

  /**
   * Get the Logger for the github module.
   *
   * Returns the CoreAdapter (which extends Logger) if set.
   *
   * @returns The Logger instance.
   * @throws {Error} If the context has not been initialized.
   */
  getLogger(): Logger {
    return this.getCoreAdapter();
  }

  /**
   * Set the Octokit instance for the github module.
   *
   * @param octokit - The Octokit instance to use.
   */
  setOctokit(octokit: OctokitInstance): void {
    this._octokit = octokit;
  }

  /**
   * Get the Octokit instance for the github module.
   *
   * @returns The Octokit instance.
   * @throws {Error} If the Octokit has not been initialized.
   */
  getOctokit(): OctokitInstance {
    if (!this._octokit) {
      throw new Error(
        'GitHub module Octokit not initialized. ' +
          'Call setOctokit() before using github API functions.'
      );
    }
    return this._octokit;
  }

  /**
   * Set the platform context for the github module.
   *
   * @param ctx - The PlatformContext to use.
   */
  setPlatformContext(ctx: PlatformContext): void {
    this._platformContext = ctx;
  }

  /**
   * Get the platform context for the github module.
   *
   * @returns The PlatformContext.
   * @throws {Error} If the platform context has not been initialized.
   */
  getPlatformContext(): PlatformContext {
    if (!this._platformContext) {
      throw new Error(
        'GitHub module platform context not initialized. ' +
          'Call setPlatformContext() before using github context functions.'
      );
    }
    return this._platformContext;
  }

  /**
   * Check if the context has been initialized.
   *
   * @internal Used for testing purposes.
   */
  isInitialized(): boolean {
    return this._coreAdapter !== undefined;
  }

  /**
   * Reset the module context, optionally providing a new adapter.
   *
   * Used primarily in tests to ensure clean isolation between test cases.
   * After calling this, you can either provide a test adapter or call
   * setCoreAdapter() with a new instance.
   *
   * @param core - Optional new CoreAdapter instance to set after reset.
   * @internal Exported for testing purposes only.
   */
  reset(core?: CoreAdapter): void {
    this._coreAdapter = core;
    this._octokit = undefined;
    this._platformContext = undefined;
  }
}

/**
 * Singleton instance of the github module context.
 */
const moduleContext = new GitHubModuleContext();

/**
 * Set the CoreAdapter for the github module.
 *
 * Called by RealGitAdapter constructor during Action initialization.
 * Tests can inject a mock CoreAdapter for unit testing.
 *
 * @param core - The CoreAdapter instance to use.
 * @throws {Error} If called with undefined adapter.
 */
export function setCoreAdapter(core: CoreAdapter): void {
  moduleContext.setCoreAdapter(core);
}

/**
 * Get the CoreAdapter for the github module.
 *
 * @returns The CoreAdapter instance.
 * @throws {Error} If the module context has not been initialized.
 * @internal Exported for internal use within the github module.
 */
export function getCoreAdapter(): CoreAdapter {
  return moduleContext.getCoreAdapter();
}

/**
 * Set the Octokit instance for the github module.
 *
 * @param octokit - The Octokit instance to use.
 */
export function setOctokit(octokit: OctokitInstance): void {
  moduleContext.setOctokit(octokit);
}

/**
 * Get the Octokit instance for the github module.
 *
 * @returns The Octokit instance.
 * @throws {Error} If the Octokit has not been initialized.
 */
export function getModuleOctokit() {
  return moduleContext.getOctokit();
}

/**
 * Set the platform context for the github module.
 *
 * @param ctx - The PlatformContext to use.
 */
export function setPlatformContext(ctx: PlatformContext): void {
  moduleContext.setPlatformContext(ctx);
}

/**
 * Get the platform context for the github module.
 *
 * @returns The PlatformContext.
 * @throws {Error} If the platform context has not been initialized.
 */
export function getModulePlatformContext(): PlatformContext {
  return moduleContext.getPlatformContext();
}

/**
 * Reset the github module context.
 *
 * Clears the module-level CoreAdapter, Octokit, and PlatformContext.
 * Used in tests to ensure clean isolation between test cases.
 *
 * @param core - Optional new CoreAdapter instance to set after reset.
 * @internal Exported for testing purposes only.
 */
export function resetModuleContext(core?: CoreAdapter): void {
  moduleContext.reset(core);
}

/**
 * Check if the github module context has been initialized.
 *
 * @returns True if setCoreAdapter() has been called.
 * @internal Exported for testing purposes only.
 */
export function isModuleContextInitialized(): boolean {
  return moduleContext.isInitialized();
}

// Context extraction functions (used by run.ts)
export {
  getPrompt,
  getStartTimeFromContext,
  getIssueOrPullRequestContext,
  isPR,
  getContextType,
} from './context';

// Shared types
export {
  type IssueOrPRThread,
  type IssueOrPullRequestContext,
  type ThreadComment,
  type ReviewComment,
  type GetIssueOrPRThreadParams,
} from './types';

// Reaction management functions (used by run.ts)
export { addReaction, deleteReaction, type CreateReactionType } from './reactions';

// Comment creation functions (used by run.ts)
export { createFinalComment } from './comments';

// Tool implementations (used by git-adapter and provider)
export {
  createPullRequest,
  type CreatePullRequestParams,
  type CreatePullRequestDetails,
} from './tools/pull-request';

export {
  updatePullRequest,
  type UpdatePullRequestParams,
  type UpdatePullRequestDetails,
} from './tools/pull-request-update';

export {
  createReview,
  validateCreateReviewParams,
  type CreateReviewParams,
  type CreateReviewDetails,
  type ReviewInlineComment,
} from './tools/review';

// Thread and diff fetching (used by provider and tools)
export { getIssueOrPRThread } from './tools/thread';
export { fetchPRDiff } from './tools/pr-diff';

// CI/CD status
export {
  getCIStatus,
  type GetCIStatusParams,
  type GetCIStatusDetails,
  type CheckRunResult,
  type WorkflowRunResult,
} from './tools/get-ci-status';

// Workflow run logs
export {
  getWorkflowRunLogs,
  type GetWorkflowRunLogsParams,
  type GetWorkflowRunLogsDetails,
  type JobLog,
} from './tools/get-workflow-run-logs';

// Platform provider (used by platform/index.ts)
export { detectPlatform, createGitHubPlatformProvider } from './provider';

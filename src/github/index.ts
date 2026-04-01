/**
 * @file GitHub module barrel export.
 *
 * Re-exports public symbols used by consumers outside the github/ module.
 * Internal implementation details are not exported from this barrel file.
 */

import type { CoreAdapter } from '../types';

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
  }
}

/**
 * Singleton instance of the GitHub module context.
 */
const moduleContext = new GitHubModuleContext();

/**
 * Set the CoreAdapter for the github module.
 *
 * Called by RealGitHubAdapter constructor during Action initialization.
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
 * Reset the GitHub module context.
 *
 * Clears the module-level CoreAdapter. Used in tests to ensure clean
 * isolation between test cases. After resetting, you should either:
 * 1. Call setCoreAdapter() with a new adapter instance
 * 2. Pass a test adapter directly to this function
 *
 * @param core - Optional new CoreAdapter instance to set after reset.
 * @internal Exported for testing purposes only.
 */
export function resetModuleContext(core?: CoreAdapter): void {
  moduleContext.reset(core);
}

/**
 * Check if the GitHub module context has been initialized.
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
  getIssueOrPRThread,
  getStartTimeFromContext,
  type IssueOrPRThread,
} from './context';

// Reaction management functions (used by run.ts)
export { addReaction, deleteReaction, type CreateReactionType } from './reactions';

// Comment creation functions (used by run.ts)
export { createFinalComment } from './comments';

// Pull request creation functions (used by pi/tools/create-pr.ts)
export {
  createPullRequest,
  type CreatePullRequestParams,
  type CreatePullRequestDetails,
} from './pull-request';

// Pull request update functions (used by pi/tools/update-pr.ts)
export {
  updatePullRequest,
  type UpdatePullRequestParams,
  type UpdatePullRequestDetails,
} from './pull-request-update';

// Cancellation messages (used by pi/tools)
export {
  CANCELLATION_MESSAGE_CREATE_PR,
  CANCELLATION_MESSAGE_GET_THREAD,
  CANCELLATION_MESSAGE_UPDATE_PR,
} from './constants';

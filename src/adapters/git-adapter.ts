/**
 * @file Real implementation of GitAdapter using git hosting platform module.
 *
 * Provides the production implementation for GitHub operations.
 */

import { Temporal } from '@js-temporal/polyfill';
import {
  addReaction,
  deleteReaction,
  createFinalComment,
  getPrompt,
  setCoreAdapter,
  getStartTimeFromContext,
  type CreateReactionType,
} from '../platform/github';
import type { GitAdapter, CommentMetadata, CoreAdapter } from '../types';

/**
 * Production adapter for git hosting platform operations.
 *
 * Wraps the git module to provide a testable interface for platform
 * operations (reactions, comments, prompts). Supports GitHub, Codeberg,
 * and self-hosted Forgejo instances.
 */
export class RealGitAdapter implements GitAdapter {
  constructor(private readonly core: CoreAdapter) {
    // Set the module-level CoreAdapter for use by github functions and Pi tools
    setCoreAdapter(core);
  }

  async addReaction() {
    return addReaction();
  }

  async deleteReaction(reaction: CreateReactionType | undefined) {
    await deleteReaction(reaction);
  }

  async createFinalComment(body: string, metadata: CommentMetadata): Promise<void> {
    await createFinalComment(body, metadata);
  }

  async getPrompt(inputPrompt?: string): Promise<string | undefined> {
    return getPrompt(inputPrompt);
  }

  getStartTime(): Temporal.Instant | undefined {
    return getStartTimeFromContext();
  }
}

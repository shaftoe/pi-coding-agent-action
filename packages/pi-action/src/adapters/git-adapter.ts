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
  getStartTimeFromContext,
  type GitHubModuleDeps,
} from '@alexanderfortin/pi-platform-github';
import type {
  GitAdapter,
  CommentMetadata,
  CoreAdapter,
  PlatformType,
} from '@alexanderfortin/pi-orchestrator';

/**
 * Production adapter for git hosting platform operations.
 *
 * Wraps the git module to provide a testable interface for platform
 * operations (reactions, comments, prompts). Supports GitHub, Codeberg,
 * and self-hosted Forgejo instances.
 */
export class RealGitAdapter implements GitAdapter {
  private readonly deps: GitHubModuleDeps;

  constructor(
    private readonly core: CoreAdapter,
    octokit: GitHubModuleDeps['octokit'],
    context: GitHubModuleDeps['context'],
    platformType?: PlatformType
  ) {
    this.deps = {
      octokit,
      context,
      logger: core,
      ...(platformType !== undefined ? { platformType } : {}),
    };
  }

  async addReaction() {
    return addReaction(this.deps);
  }

  async deleteReaction(reaction: unknown) {
    await deleteReaction(this.deps, reaction as Parameters<typeof deleteReaction>[1]);
  }

  async createFinalComment(body: string, metadata: CommentMetadata): Promise<void> {
    await createFinalComment(this.deps, body, metadata);
  }

  async getPrompt(inputPrompt?: string): Promise<string | undefined> {
    return getPrompt(this.deps, inputPrompt);
  }

  getStartTime(): Temporal.Instant | undefined {
    return getStartTimeFromContext(this.deps);
  }
}

/**
 * @file CLI-side {@link GitAdapter} implementation.
 *
 * Thin proxy around a {@link PlatformProvider} — currently a near-exact
 * duplicate of `packages/pi-action/src/adapters/git-adapter.ts`. The two
 * are intentionally not shared yet; promoting a common helper into
 * `pi-orchestrator` is RFC §11.1, scheduled for M3 once we have two
 * concrete instances to design the shared signature against.
 */

import { Temporal } from '@js-temporal/polyfill';
import type {
  CommentMetadata,
  GitAdapter,
  PlatformProvider,
} from '@alexanderfortin/pi-orchestrator';

/**
 * CLI implementation of {@link GitAdapter}.
 *
 * Delegates every method to the injected platform provider. The provider
 * already implements all of these — the adapter exists so the
 * orchestrator's `GitAdapter` interface stays decoupled from
 * `PlatformProvider`'s concrete shape.
 */
export class CliGitAdapter implements GitAdapter {
  constructor(private readonly provider: PlatformProvider) {}

  async addReaction() {
    return this.provider.addReaction();
  }

  async deleteReaction(reaction: unknown) {
    await this.provider.deleteReaction(reaction);
  }

  async createFinalComment(body: string, metadata: CommentMetadata): Promise<void> {
    await this.provider.createFinalComment(body, metadata);
  }

  async getPrompt(inputPrompt?: string): Promise<string | undefined> {
    return this.provider.getPrompt(inputPrompt);
  }

  getStartTime(): Temporal.Instant | undefined {
    return this.provider.getStartTime();
  }
}

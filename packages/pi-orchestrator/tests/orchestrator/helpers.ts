/**
 * Shared helpers for `orchestrator.spec.ts`.
 *
 * Wraps the most repetitive mock-setup and assertion patterns:
 *   - `setAgentRunResult` / `setAgentRunError` → swap `mockPiAgent.run`
 *   - `setAddReactionReturn` → swap `mockGit.addReaction` and return the
 *     reaction object for later `deleteReaction` assertions
 *   - `getFinalCommentCall` → read the first `[text, metadata]` call
 *   - `expectFactoryCalledWith` → assert `mockPiFactory` received an
 *     `objectContaining` matcher plus the `core` / `provider` args
 */

import { expect, mock } from 'bun:test';
import type { CreateReactionType, GitAdapter, PiAgent } from '@alexanderfortin/pi-orchestrator';

export interface AgentRunOverrides {
  result?: string;
  sessionStats?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

/** Configure the agent's `run` mock to resolve with the given overrides. */
export function setAgentRunResult(agent: PiAgent, overrides: AgentRunOverrides = {}) {
  const fn = mock(async () => ({
    result: overrides.result ?? '',
    sessionStats: overrides.sessionStats ?? undefined,
    error: overrides.error ?? undefined,
  }));
  (agent as any).run = fn;
  return fn;
}

/** Configure the agent's `run` mock to throw `error`. */
export function setAgentRunError(agent: PiAgent, error: unknown) {
  const fn = mock(async () => {
    throw error;
  });
  (agent as any).run = fn;
  return fn;
}

/**
 * Configure the agent's `getSessionStats` mock to return the given stats.
 *
 * Used to simulate partial usage recovered from a `PiAgent` after `run`
 * rejected (e.g. the underlying `prompt()` threw mid-turn).
 */
export function setAgentGetSessionStats(
  agent: PiAgent,
  sessionStats: Record<string, unknown> | undefined
) {
  const fn = mock(() => sessionStats);
  (agent as any).getSessionStats = fn;
  return fn;
}

/**
 * Configure `git.addReaction` to resolve with the given reaction shape.
 * Returns the reaction for later `deleteReaction` assertions.
 */
export function setAddReactionReturn(git: GitAdapter, id: number): CreateReactionType {
  const reaction = { data: { id } } as CreateReactionType;
  (git as any).addReaction = mock(async () => reaction);
  return reaction;
}

/**
 * Read the first `createFinalComment` call as `[text, metadata]`.
 * Throws when the mock has not been called.
 */
export function getFinalCommentCall(git: GitAdapter): [string, Record<string, unknown>] {
  const calls = (git.createFinalComment as any).mock.calls;
  if (!calls || calls.length === 0) {
    throw new Error('getFinalCommentCall: createFinalComment was never called');
  }
  return calls[0] as [string, Record<string, unknown>];
}

/**
 * Assert that `mockPiFactory` was called with an `objectContaining(matcher)`
 * (or `not.objectContaining(matcher)` when `opts.not` is true) plus the
 * expected `core` and `provider` positional args.
 */
export function expectFactoryCalledWith(
  factory: unknown,
  core: unknown,
  provider: unknown,
  matcher: Record<string, unknown>,
  opts: { not?: boolean } = {}
): void {
  const wrapped = opts.not
    ? expect.not.objectContaining(matcher)
    : expect.objectContaining(matcher);
  expect(factory).toHaveBeenCalledWith(wrapped, core, provider);
}

/**
 * Shared helpers for `tests/pi/agent-logic.spec.ts`.
 *
 * Eliminates the repeated mock-session construction across the `Agent.run`
 * test cases. The mock-session shape (with `getSessionStats` / `prompt` /
 * `subscribe` / `state.messages`) was duplicated in five call sites.
 */

import type { Agent } from '@alexanderfortin/pi-orchestrator';

/** Minimal shape matching the SDK's session object used by `Agent.run`. */
export interface MockSession {
  getSessionStats: () => {
    tokens: { input: number; output: number; total: number };
    cost: number;
  };
  prompt: () => Promise<void>;
  subscribe: () => void;
  state: {
    messages: Record<string, unknown>[];
  };
}

export interface MockSessionOptions {
  /** Token counts and cost returned by `getSessionStats()`. */
  stats?: { input?: number; output?: number; total?: number; cost?: number };
  /** Messages array for `state.messages`. */
  messages: MockSession['state']['messages'];
}

/** Build a mock session with the given stats + messages. */
export function buildMockSession(options: MockSessionOptions): MockSession {
  const input = options.stats?.input ?? 100;
  const output = options.stats?.output ?? 50;
  const total = options.stats?.total ?? input + output;
  const cost = options.stats?.cost ?? 0.001;

  return {
    getSessionStats: () => ({ tokens: { input, output, total }, cost }),
    prompt: async () => {},
    subscribe: () => {},
    state: { messages: options.messages },
  };
}

/** Inject `session` into an Agent instance (mirrors `agent['session'] = ...`). */
export function injectMockSession(agent: InstanceType<typeof Agent>, session: MockSession): void {
  (agent as unknown as { session: MockSession }).session = session;
}

/** Standard "user said hello" message used by many test cases. */
export const userHelloMessage = { role: 'user', content: 'Hello', timestamp: 0 };

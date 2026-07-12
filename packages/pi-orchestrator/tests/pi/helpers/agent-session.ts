/**
 * Shared helpers for `tests/pi/agent-logic.spec.ts`.
 *
 * Eliminates the repeated mock-session construction across the `Agent.run`
 * test cases. The mock-session shape (with `getSessionStats` / `prompt` /
 * `subscribe` / `state.messages`) was duplicated in five call sites.
 *
 * The mock session dispatches `agent_end` and `agent_settled` events during
 * `prompt()` so that the Agent's event-based error capture and
 * `onPromptComplete` routing (via `agent_settled`) work correctly in tests.
 */

import type { Agent } from '@alexanderfortin/pi-orchestrator';

/** A session event that the mock can dispatch. */
export interface MockSessionEvent {
  type: string;
  messages?: Record<string, unknown>[];
  willRetry?: boolean;
  [key: string]: unknown;
}

/** Minimal shape matching the SDK's session object used by `Agent.run`. */
export interface MockSession {
  getSessionStats: () => {
    tokens: { input: number; output: number; total: number };
    cost: number;
  };
  prompt: () => Promise<void>;
  subscribe: (listener: (event: MockSessionEvent) => void) => void;
  state: {
    messages: Record<string, unknown>[];
  };
}

export interface MockSessionOptions {
  /** Token counts and cost returned by `getSessionStats()`. */
  stats?: { input?: number; output?: number; total?: number; cost?: number };
  /** Messages array for `state.messages` and the `agent_end` event payload. */
  messages: MockSession['state']['messages'];
  /**
   * When true, `prompt()` does NOT dispatch `agent_end` / `agent_settled`
   * events. Use this for sessions whose `prompt` throws or is overridden
   * after construction.
   */
  suppressEvents?: boolean;
}

/**
 * Build a mock session with the given stats + messages.
 *
 * The mock session dispatches `agent_end` (with the messages payload) and
 * `agent_settled` events when `prompt()` is called, mirroring the real SDK
 * session lifecycle. This lets the Agent's event-based error capture and
 * `onPromptComplete` routing work in tests.
 *
 * Destructures `options.stats` once (with defaults) instead of four `?.` /
 * `??` chains, keeping cyclomatic complexity under Fallow's threshold.
 */
export function buildMockSession(options: MockSessionOptions): MockSession {
  const { input = 100, output = 50, total, cost = 0.001 } = options.stats ?? {};
  let listener: ((event: MockSessionEvent) => void) | undefined;

  return {
    getSessionStats: () => ({
      tokens: { input, output, total: total ?? input + output },
      cost,
    }),
    prompt: async () => {
      if (!options.suppressEvents && listener) {
        listener({
          type: 'agent_end',
          messages: options.messages,
          willRetry: false,
        });
        listener({ type: 'agent_settled' });
      }
    },
    subscribe: (cb: (event: MockSessionEvent) => void) => {
      listener = cb;
    },
    state: { messages: options.messages },
  };
}

/**
 * Inject `session` into an Agent instance (mirrors `agent['session'] = ...`).
 *
 * Also wires the mock session's subscribe channel to the event handler that
 * was registered during `ready()`, so that `agent_end` / `agent_settled`
 * events dispatched by the mock's `prompt()` reach the Agent's handler.
 */
export function injectMockSession(agent: InstanceType<typeof Agent>, session: MockSession): void {
  // Connect the agent's session event handler (registered during ready())
  // to the mock session's subscribe channel.
  const handler = (agent as unknown as { sessionEventHandler?: (event: MockSessionEvent) => void })
    .sessionEventHandler;
  if (handler) {
    session.subscribe(handler);
  }
  (agent as unknown as { session: MockSession }).session = session;
}

/** Standard "user said hello" message used by many test cases. */
export const userHelloMessage = { role: 'user', content: 'Hello', timestamp: 0 };

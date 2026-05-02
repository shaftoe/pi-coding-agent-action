/**
 * @file Common patterns and utilities for tool execution.
 *
 * Provides reusable patterns for tool cancellation handling and parameter
 * validation to reduce duplication across tool definitions.
 */

import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent';

/**
 * Result of a cancelled tool execution.
 */
export interface CancellationResult<TDetails> {
  content: { type: 'text'; text: string }[];
  details: TDetails & { cancelled: true };
}

/**
 * Helper type to extract non-undefined values from a type.
 */
type NonUndefined<T> = T extends undefined ? never : T;

/**
 * Configuration for tool execution with cancellation.
 */
export interface ToolExecutionConfig<TParams, TDetails, TResult> {
  /** The cancellation message to return when signal.aborted is true. */
  cancellationMessage: string;
  /** The cancellation details template (merged with cancelled: true). */
  cancellationDetails: Omit<TDetails, 'cancelled'>;
  /** Function that validates and transforms tool parameters into execution params. */
  prepareParams: (params: TParams) => TResult;
  /** Function that executes the actual operation. */
  execute: (params: TResult) => Promise<AgentToolResult<TDetails>>;
}

/**
 * Create a cancellation result with the standard structure.
 *
 * @param cancellationMessage - The message to return in the content.
 * @param cancellationDetails - The base details to include (cancelled: true is added automatically).
 * @returns A tool result indicating cancellation.
 */
export function createCancellationResult<TDetails>(
  cancellationMessage: string,
  cancellationDetails: Omit<TDetails, 'cancelled'>
): CancellationResult<TDetails> {
  return {
    content: [{ type: 'text' as const, text: cancellationMessage }],
    details: { ...cancellationDetails, cancelled: true } as TDetails & { cancelled: true },
  };
}

/**
 * Create a tool execute function with built-in cancellation handling.
 *
 * Wraps the provided execution logic with a cancellation check at the start.
 * If the signal is aborted, returns a cancellation result. Otherwise, delegates
 * to the prepareParams and execute functions.
 *
 * @param config - Configuration for the tool execution.
 * @returns An execute function compatible with defineTool.
 *
 * @example
 * ```typescript
 * const executeTool = withCancellation({
 *   cancellationMessage: CANCELLATION_MESSAGE_CREATE_PR,
 *   cancellationDetails: { pullRequestNumber: 0, pullRequestUrl: '', ... },
 *   prepareParams: (params) => {
 *     const { title, body, base, dryRun } = params;
 *     const prParams: CreatePullRequestParams = { title };
 *     if (body !== undefined) prParams.body = body;
 *     if (base !== undefined) prParams.base = base;
 *     if (dryRun !== undefined) prParams.dryRun = dryRun;
 *     return prParams;
 *   },
 *   execute: (prParams) => createPullRequest(prParams),
 * });
 *
 * export const createPRTool = defineTool({
 *   name: 'create_pull_request',
 *   // ... other properties
 *   execute: executeTool,
 * });
 * ```
 */
export function withCancellation<TParams, TDetails, TResult>(
  config: ToolExecutionConfig<TParams, TDetails, TResult>
) {
  return async (
    _toolCallId: string,
    params: TParams,
    signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
    _ctx: ExtensionContext
  ): Promise<AgentToolResult<TDetails>> => {
    if (signal?.aborted) {
      return createCancellationResult(config.cancellationMessage, config.cancellationDetails);
    }

    const executionParams = config.prepareParams(params);
    return config.execute(executionParams);
  };
}

/**
 * Helper to build an object from optional parameters.
 *
 * Filters out undefined values from the provided object, creating a new
 * object with only the defined properties. This is useful when building
 * parameter objects for API calls where undefined values should be omitted.
 *
 * @param params - Object with potentially undefined properties.
 * @returns A new object with only defined properties.
 *
 * @example
 * ```typescript
 * const result = buildParams({
 *   title: 'My Title',
 *   body: undefined,
 *   dryRun: false,
 * });
 * // result = { title: 'My Title', dryRun: false }
 * ```
 */
export function buildParams<T extends Record<string, unknown>>(
  params: T
): Partial<Record<keyof T, NonUndefined<T[keyof T]>>> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<Record<keyof T, NonUndefined<T[keyof T]>>>;
}

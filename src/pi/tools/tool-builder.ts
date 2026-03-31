/**
 * @file Tool builder factory to reduce duplication in tool definitions.
 */

import { TSchema, Static } from '@sinclair/typebox';
import type { ToolDefinition, AgentToolResult } from '@mariozechner/pi-coding-agent';

/**
 * Configuration for building a tool with cancellation handling.
 */
export interface ToolConfig<TSchemaType extends TSchema, TDetails> {
  /** Tool name (e.g., 'create_pull_request') */
  name: string;
  /** Human-readable label */
  label: string;
  /** Tool description */
  description: string;
  /** Prompt snippet for AI */
  promptSnippet: string;
  /** Prompt guidelines for AI */
  promptGuidelines: string[];
  /** TypeBox schema for parameters */
  parameters: TSchemaType;
  /** Cancellation message to display when aborted */
  cancellationMessage: string;
  /** Cancellation details object */
  cancellationDetails: TDetails;
  /** Execute function that performs the actual work */
  execute: (params: Static<TSchemaType>) => Promise<AgentToolResult<TDetails>>;
}

/**
 * Builds a ToolDefinition with common cancellation handling.
 *
 * This factory function reduces duplication across tool definitions by:
 * - Handling signal abort checks consistently
 * - Returning properly structured cancellation responses
 * - Delegating execution logic to a simple function
 *
 * @template TSchemaType - The TypeBox schema type
 * @template TDetails - The details type returned by the tool
 * @param config - Tool configuration
 * @returns A complete ToolDefinition
 */
export function buildTool<TSchemaType extends TSchema, TDetails>(
  config: ToolConfig<TSchemaType, TDetails>
): ToolDefinition {
  return {
    name: config.name,
    label: config.label,
    description: config.description,
    promptSnippet: config.promptSnippet,
    promptGuidelines: config.promptGuidelines,
    // @ts-expect-error - TypeBox Symbol property not recognized by TypeScript
    parameters: config.parameters,

    async execute(
      _toolCallId,
      params,
      signal,
      _onUpdate,
      _ctx
    ): Promise<AgentToolResult<TDetails>> {
      // Check for cancellation
      if (signal?.aborted) {
        return {
          content: [{ type: 'text' as const, text: config.cancellationMessage }],
          details: { ...config.cancellationDetails, cancelled: true },
        } as AgentToolResult<TDetails>;
      }

      return await config.execute(params as Static<TSchemaType>);
    },
  };
}

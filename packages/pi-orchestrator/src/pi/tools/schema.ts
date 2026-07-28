/**
 * @file TypeBox schema helpers for strict JSON-schema tool definitions.
 *
 * Our custom tools opt into provider-side strict JSON-schema sampling via
 * {@link PREFER_STRICT_JSON_SCHEMA}. Both OpenAI and Anthropic strict mode require
 * the tool parameter schema to:
 *
 * 1. Set `additionalProperties: false` on every object, and
 * 2. List **every** property in `required` — optional properties are not
 *    allowed. Optional fields must instead be modelled as a required-but-
 *    nullable union (`type: ["string", "null"]`, emitted by TypeBox as
 *    `anyOf: [{type:"string"}, {type:"null"}]`).
 *
 * The SDK passes the TypeBox schema to the provider as-is (it does **not**
 * transform optionals into nullables), so the strict-compatible shape must be
 * authored here. `nullable()` makes that mechanical and consistent.
 *
 * See the Pi SDK "Constrained Sampling for Tools" docs.
 */

import { Type, type TSchema } from 'typebox';

/**
 * Wrap a schema in a required-but-nullable union.
 *
 * Produces `anyOf: [<schema>, { type: "null" }]`, which OpenAI and Anthropic
 * strict modes accept for optional fields. The resulting property is **required**
 * (it appears in the object's `required` array); callers should treat a `null`
 * value as "absent" at the tool boundary (e.g. via the `isPresent()` guard).
 *
 * @param schema - The inner TypeBox schema (e.g. `Type.String()`).
 * @returns A nullable union schema usable directly as an object property.
 *
 * @example
 * ```typescript
 * const schema = Type.Object({
 *   title: Type.String(),
 *   body: nullable(Type.String()),   // required, but `string | null`
 * }, { additionalProperties: false });
 * ```
 */
export function nullable<T extends TSchema>(schema: T) {
  return Type.Union([schema, Type.Null()]);
}

/**
 * Request provider-side strict JSON-schema enforcement for a tool.
 *
 * The constant name reflects the configured `strict: 'prefer'` (not
 * `'require'`): models/providers without strict-mode support fall back to
 * normal tool calling instead of failing the request. On strict-capable models
 * (OpenAI GPT-5 family, Anthropic Claude, Bedrock Converse, Mistral, Gemini 3)
 * the provider enforces the JSON schema server-side, reducing malformed
 * tool-call arguments.
 *
 * Pair with `additionalProperties: false` and {@link nullable} optionals so the
 * schema is strict-compatible; otherwise strict-capable providers reject the
 * request.
 */
export const PREFER_STRICT_JSON_SCHEMA = {
  type: 'json_schema',
  strict: 'prefer',
} as const;

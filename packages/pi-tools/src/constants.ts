/**
 * @file Constants for pi tool definitions.
 *
 * Contains cancellation messages and other constants used by tool definitions.
 * These are presentation-layer concerns specific to how the Pi agent communicates
 * tool outcomes to the LLM.
 */

// Cancellation messages returned when a tool's abort signal is triggered
export const CANCELLATION_MESSAGE_CREATE_PR = 'Pull request creation was cancelled';
export const CANCELLATION_MESSAGE_GET_THREAD = 'Thread retrieval was cancelled';
export const CANCELLATION_MESSAGE_UPDATE_PR = 'Pull request update was cancelled';

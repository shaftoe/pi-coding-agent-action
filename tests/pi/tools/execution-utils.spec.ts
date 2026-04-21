/**
 * Tests for tool execution utilities.
 *
 * Tests the shared utilities used across tool definitions for cancellation
 * handling and parameter building.
 */

import { describe, expect, test } from 'bun:test';
import type { ExtensionContext } from '@mariozechner/pi-coding-agent';
// Import directly from source file using namespace import to work around bun test module resolution
import * as ToolExecution from '../../../src/pi/tools/tool-execution';

const { withCancellation, createCancellationResult, buildParams } = ToolExecution;

// Minimal mock ExtensionContext for tool execute signature (v0.68.0+)
const mockCtx = {
  ui: {},
  hasUI: false,
  cwd: '/tmp',
  sessionManager: {},
  modelRegistry: {},
  model: undefined,
  isIdle: () => true,
  signal: undefined,
  abort: () => {},
  hasPendingMessages: () => false,
  shutdown: () => {},
  getContextUsage: () => undefined,
  compact: () => {},
  getSystemPrompt: () => '',
} as unknown as ExtensionContext;

describe('tool-execution utilities', () => {
  describe('createCancellationResult', () => {
    test('handles empty cancellationDetails', () => {
      const result = createCancellationResult('Cancelled', {});

      expect(result.details).toEqual({
        cancelled: true,
      });
    });
  });

  describe('withCancellation', () => {
    test('returns cancellation result when signal is aborted', async () => {
      const mockSignal = new AbortController();
      mockSignal.abort();

      const execute = withCancellation<Record<string, never>, Record<string, unknown>, Record<string, unknown>>(
        {
          cancellationMessage: 'Test cancelled',
          cancellationDetails: { id: 0, name: 'Cancelled' },
          prepareParams: (params) => params,
          execute: async () => {
            throw new Error('Should not be called');
          },
        }
      );

      const result = await execute('tool-call-id', {}, mockSignal.signal, undefined, mockCtx);

      expect(result.content).toEqual([{ type: 'text', text: 'Test cancelled' }]);
      expect(result.details).toEqual({
        id: 0,
        name: 'Cancelled',
        cancelled: true,
      });
    });

    test('calls prepareParams with original params', async () => {
      const mockPrepareParams = (params: { value: number }) => ({
        processed: params.value * 2,
      });

      const mockExecute = async (params: { processed: number }) => ({
        content: [{ type: 'text' as const, text: `Result: ${params.processed}` }],
        details: { result: params.processed },
      });

      const execute = withCancellation<{ value: number }, { result: number }, { processed: number }>({
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 0 },
        prepareParams: mockPrepareParams,
        execute: mockExecute,
      });

      const result = await execute('tool-call-id', { value: 21 }, undefined, undefined, mockCtx);

      expect(result.content).toEqual([{ type: 'text', text: 'Result: 42' }]);
      expect(result.details).toEqual({ result: 42 });
    });

    test('calls execute with prepared params', async () => {
      const mockExecute = async (params: { transformed: string }) => ({
        content: [{ type: 'text' as const, text: params.transformed }],
        details: { output: params.transformed },
      });

      const execute = withCancellation<
        { value: string },
        { output: string },
        { transformed: string }
      >({
        cancellationMessage: 'Cancelled',
        cancellationDetails: { output: '' },
        prepareParams: (params) => ({ transformed: params.value.toUpperCase() }),
        execute: mockExecute,
      });

      const result = await execute('tool-call-id', { value: 'hello' }, undefined, undefined, mockCtx);

      expect(result.content).toEqual([{ type: 'text', text: 'HELLO' }]);
      expect(result.details).toEqual({ output: 'HELLO' });
    });

    test('handles undefined signal', async () => {
      const mockExecute = async () => ({
        content: [{ type: 'text' as const, text: 'Success' }],
        details: {},
      });

      const execute = withCancellation<
        Record<string, never>,
        Record<string, unknown>,
        Record<string, unknown>
      >({
        cancellationMessage: 'Cancelled',
        cancellationDetails: {},
        prepareParams: (params) => params,
        execute: mockExecute,
      });

      // Should not throw and should execute normally
      const result = await execute('tool-call-id', {}, undefined, undefined, mockCtx);

      expect(result.content).toEqual([{ type: 'text', text: 'Success' }]);
    });

    test('propagates execution errors', async () => {
      const mockExecute = async () => {
        throw new Error('Execution failed');
      };

      const execute = withCancellation<
        Record<string, never>,
        Record<string, unknown>,
        Record<string, unknown>
      >({
        cancellationMessage: 'Cancelled',
        cancellationDetails: {},
        prepareParams: (params) => params,
        execute: mockExecute,
      });

      await expect(execute('tool-call-id', {}, undefined, undefined, mockCtx)).rejects.toThrow('Execution failed');
    });

    test('signal.aborted check happens before prepareParams', async () => {
      const mockSignal = new AbortController();
      mockSignal.abort();

      const mockPrepareParams = () => {
        throw new Error('Should not be called');
      };

      const mockExecute = async () => {
        throw new Error('Should not be called');
      };

      const execute = withCancellation<
        Record<string, never>,
        Record<string, unknown>,
        Record<string, unknown>
      >({
        cancellationMessage: 'Cancelled',
        cancellationDetails: {},
        prepareParams: mockPrepareParams,
        execute: mockExecute,
      });

      // Should return cancellation result without calling prepareParams or execute
      const result = await execute('tool-call-id', {}, mockSignal.signal, undefined, mockCtx);

      expect((result.details as { cancelled: boolean }).cancelled).toBe(true);
    });
  });

  describe('buildParams', () => {
    test('filters out undefined values', () => {
      const result = buildParams({
        title: 'My Title',
        body: undefined,
        dryRun: false,
      });

      expect(result).toEqual({
        title: 'My Title',
        dryRun: false,
      });
      expect('body' in result).toBe(false);
    });

    test('keeps all defined values', () => {
      const result = buildParams({
        a: 1,
        b: 'two',
        c: true,
        d: null,
      });

      expect(result).toEqual({
        a: 1,
        b: 'two',
        c: true,
        d: null,
      });
    });

    test('handles empty object', () => {
      const result = buildParams({});

      expect(result).toEqual({});
    });

    test('handles all undefined values', () => {
      const result = buildParams({
        a: undefined,
        b: undefined,
        c: undefined,
      });

      expect(result).toEqual({});
    });

    test('preserves zero and empty string', () => {
      const result = buildParams({
        count: 0,
        name: '',
        active: false,
      });

      expect(result).toEqual({
        count: 0,
        name: '',
        active: false,
      });
    });

    test('handles nested objects', () => {
      const result = buildParams({
        title: 'Test',
        metadata: undefined,
        options: { a: 1, b: 2 },
      });

      expect(result).toEqual({
        title: 'Test',
        options: { a: 1, b: 2 },
      });
    });

    test('type inference works correctly', () => {
      const input = {
        required: 'value',
        optional1: undefined,
        optional2: 123,
      };

      const result = buildParams(input);

      // TypeScript should infer that 'required' and 'optional2' are present
      // but 'optional1' is not
      expect(result.required).toBe('value');
      expect(result.optional2).toBe(123);
      expect('optional1' in result).toBe(false);
    });

    test('handles arrays correctly', () => {
      const result = buildParams({
        tags: ['tag1', 'tag2'],
        undefinedTags: undefined,
      });

      expect(result).toEqual({
        tags: ['tag1', 'tag2'],
      });
    });

    test('preserves functions', () => {
      const mockFn = () => 'test';

      const result = buildParams({
        callback: mockFn,
        undefinedCallback: undefined,
      });

      expect(result.callback).toBe(mockFn);
      expect('undefinedCallback' in result).toBe(false);
    });
  });
});

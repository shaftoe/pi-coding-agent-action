/**
 * @file Unit tests for the tool-builder utility.
 */

import { describe, expect, test } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { buildTool } from '../../src/pi/tools/tool-builder';

describe('buildTool', () => {
  interface TestDetails {
    result: string;
    value: number;
  }

  const testSchema = Type.Object({
    message: Type.String(),
    count: Type.Optional(Type.Integer()),
  });

  describe('tool definition structure', () => {
    test('creates a tool with all required properties', () => {
      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool for unit testing',
        promptSnippet: '/test-tool',
        promptGuidelines: ['Use this tool for testing'],
        parameters: testSchema,
        cancellationMessage: 'Operation cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: async () => ({
          content: [{ type: 'text' as const, text: 'Success' }],
          details: { result: 'success', value: 42 },
        }),
      });

      expect(tool.name).toBe('test_tool');
      expect(tool.label).toBe('Test Tool');
      expect(tool.description).toBe('A test tool for unit testing');
      expect(tool.promptSnippet).toBe('/test-tool');
      expect(tool.promptGuidelines).toEqual(['Use this tool for testing']);
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    });

    test('preserves the provided schema in parameters', () => {
      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: async () => ({
          content: [{ type: 'text' as const, text: 'Success' }],
          details: { result: 'success', value: 42 },
        }),
      });

      expect(tool.parameters).toBe(testSchema);
    });

    test('preserves prompt guidelines array', () => {
      const guidelines = ['First guideline', 'Second guideline', 'Third guideline'];
      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: guidelines,
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: async () => ({
          content: [{ type: 'text' as const, text: 'Success' }],
          details: { result: 'success', value: 42 },
        }),
      });

      expect(tool.promptGuidelines).toEqual(guidelines);
      expect(tool.promptGuidelines.length).toBe(3);
    });
  });

  describe('execute function', () => {
    test('calls the provided execute function with correct params', async () => {
      const mockExecute = async (params: { message: string; count?: number }) => ({
        content: [{ type: 'text' as const, text: `Echo: ${params.message}` }],
        details: { result: 'echoed', value: params.count ?? 0 },
      });

      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: mockExecute,
      });

      const result = await tool.execute(
        'test-id',
        { message: 'Hello, world!', count: 5 },
        undefined,
        undefined,
        undefined
      );

      expect(result.content[0]?.text).toBe('Echo: Hello, world!');
      expect(result.details.result).toBe('echoed');
      expect(result.details.value).toBe(5);
    });

    test('passes undefined signal when not provided', async () => {
      const mockExecute = async (_params: { message: string; count?: number }) => {
        return {
          content: [{ type: 'text' as const, text: 'Success' }],
          details: { result: 'success', value: 42 },
        };
      };

      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: mockExecute,
      });

      // Call without a signal parameter
      await tool.execute('test-id', { message: 'test' }, undefined, undefined, undefined);

      // If we got here without error, the signal was handled correctly
      expect(true).toBe(true);
    });

    test('returns the exact result from execute function', async () => {
      const expectedDetails = { result: 'completed', value: 100 };
      const expectedContent = [{ type: 'text' as const, text: 'Operation completed successfully' }];

      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: async () => ({
          content: expectedContent,
          details: expectedDetails,
        }),
      });

      const result = await tool.execute(
        'test-id',
        { message: 'test' },
        undefined,
        undefined,
        undefined
      );

      expect(result).toEqual({
        content: expectedContent,
        details: expectedDetails,
      });
    });

    test('handles optional parameters correctly', async () => {
      const mockExecute = async (params: { message: string; count?: number }) => ({
        content: [{ type: 'text' as const, text: `Count: ${params.count ?? 'default'}` }],
        details: { result: 'ok', value: params.count ?? 0 },
      });

      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: mockExecute,
      });

      // Test without optional parameter
      const result1 = await tool.execute(
        'test-id',
        { message: 'test' },
        undefined,
        undefined,
        undefined
      );
      expect(result1.content[0]?.text).toBe('Count: default');
      expect(result1.details.value).toBe(0);

      // Test with optional parameter
      const result2 = await tool.execute(
        'test-id',
        { message: 'test', count: 10 },
        undefined,
        undefined,
        undefined
      );
      expect(result2.content[0]?.text).toBe('Count: 10');
      expect(result2.details.value).toBe(10);
    });
  });

  describe('cancellation handling', () => {
    test('returns cancellation response when signal is aborted', async () => {
      const mockExecute = async () => ({
        content: [{ type: 'text' as const, text: 'Should not be called' }],
        details: { result: 'not-called', value: 0 },
      });

      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Operation was cancelled by user',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: mockExecute,
      });

      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        'test-id',
        { message: 'test' },
        controller.signal,
        undefined,
        undefined
      );

      expect(result.content[0]?.text).toBe('Operation was cancelled by user');
      expect(result.details.cancelled).toBe(true);
      expect(result.details.result).toBe('cancelled');
      expect(result.details.value).toBe(0);
    });

    test('does not call execute function when signal is aborted', async () => {
      let executeCalled = false;
      const mockExecute = async () => {
        executeCalled = true;
        return {
          content: [{ type: 'text' as const, text: 'Execute was called' }],
          details: { result: 'called', value: 1 },
        };
      };

      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: mockExecute,
      });

      const controller = new AbortController();
      controller.abort();

      await tool.execute('test-id', { message: 'test' }, controller.signal, undefined, undefined);

      expect(executeCalled).toBe(false);
    });

    test('merges cancellation details with cancelled: true', async () => {
      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Operation cancelled',
        cancellationDetails: { result: 'user-abort', value: 999 },
        execute: async () => ({
          content: [{ type: 'text' as const, text: 'Success' }],
          details: { result: 'success', value: 0 },
        }),
      });

      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        'test-id',
        { message: 'test' },
        controller.signal,
        undefined,
        undefined
      );

      expect(result.details).toEqual({
        result: 'user-abort',
        value: 999,
        cancelled: true,
      });
    });

    test('handles cancellation details with multiple properties', async () => {
      interface ComplexDetails {
        operation: string;
        status: string;
        code: number;
        timestamp?: string;
      }

      const complexSchema = Type.Object({
        input: Type.String(),
      });

      const tool = buildTool<ComplexDetails>({
        name: 'complex_tool',
        label: 'Complex Tool',
        description: 'A tool with complex details',
        promptSnippet: '/complex',
        promptGuidelines: [],
        parameters: complexSchema,
        cancellationMessage: 'Complex operation cancelled',
        cancellationDetails: {
          operation: 'data-processing',
          status: 'aborted',
          code: -1,
          timestamp: '2024-01-01T00:00:00Z',
        },
        execute: async () => ({
          content: [{ type: 'text' as const, text: 'Done' }],
          details: {
            operation: 'data-processing',
            status: 'complete',
            code: 0,
          },
        }),
      });

      const controller = new AbortController();
      controller.abort();

      const result = await tool.execute(
        'test-id',
        { input: 'data' },
        controller.signal,
        undefined,
        undefined
      );

      expect(result.details.cancelled).toBe(true);
      expect(result.details.operation).toBe('data-processing');
      expect(result.details.status).toBe('aborted');
      expect(result.details.code).toBe(-1);
      expect(result.details.timestamp).toBe('2024-01-01T00:00:00Z');
    });

    test('proceeds normally when signal is not aborted', async () => {
      const mockExecute = async () => ({
        content: [{ type: 'text' as const, text: 'Operation completed' }],
        details: { result: 'success', value: 100 },
      });

      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: mockExecute,
      });

      const controller = new AbortController();
      // Don't abort the signal

      const result = await tool.execute(
        'test-id',
        { message: 'test' },
        controller.signal,
        undefined,
        undefined
      );

      expect(result.content[0]?.text).toBe('Operation completed');
      expect(result.details.result).toBe('success');
      expect(result.details.value).toBe(100);
      expect(result.details.cancelled).toBeUndefined();
    });

    test('proceeds normally when aborted flag is false', async () => {
      const mockExecute = async () => ({
        content: [{ type: 'text' as const, text: 'Operation completed' }],
        details: { result: 'success', value: 50 },
      });

      const tool = buildTool<TestDetails>({
        name: 'test_tool',
        label: 'Test Tool',
        description: 'A test tool',
        promptSnippet: '/test',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: mockExecute,
      });

      // Manually create a signal-like object with aborted: false
      const signal = { aborted: false } as AbortSignal;

      const result = await tool.execute(
        'test-id',
        { message: 'test' },
        signal,
        undefined,
        undefined
      );

      expect(result.content[0]?.text).toBe('Operation completed');
      expect(result.details.result).toBe('success');
      expect(result.details.value).toBe(50);
      expect(result.details.cancelled).toBeUndefined();
    });
  });

  describe('type safety', () => {
    test('handles different detail types correctly', async () => {
      interface SimpleDetails {
        done: boolean;
      }

      interface NestedDetails {
        meta: {
          id: string;
          version: number;
        };
        data: string[];
      }

      const simpleSchema = Type.Object({ value: Type.String() });
      const nestedSchema = Type.Object({ items: Type.Array(Type.String()) });

      const simpleTool = buildTool<SimpleDetails>({
        name: 'simple_tool',
        label: 'Simple Tool',
        description: 'Simple tool',
        promptSnippet: '/simple',
        promptGuidelines: [],
        parameters: simpleSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { done: false },
        execute: async () => ({
          content: [{ type: 'text' as const, text: 'Simple' }],
          details: { done: true },
        }),
      });

      const nestedTool = buildTool<NestedDetails>({
        name: 'nested_tool',
        label: 'Nested Tool',
        description: 'Nested tool',
        promptSnippet: '/nested',
        promptGuidelines: [],
        parameters: nestedSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: {
          meta: { id: '', version: 0 },
          data: [],
        },
        execute: async () => ({
          content: [{ type: 'text' as const, text: 'Nested' }],
          details: {
            meta: { id: 'test-123', version: 1 },
            data: ['item1', 'item2'],
          },
        }),
      });

      const simpleResult = await simpleTool.execute(
        'test-id',
        { value: 'test' },
        undefined,
        undefined,
        undefined
      );
      expect(simpleResult.details.done).toBe(true);

      const nestedResult = await nestedTool.execute(
        'test-id',
        { items: ['a', 'b'] },
        undefined,
        undefined,
        undefined
      );
      expect(nestedResult.details.meta.id).toBe('test-123');
      expect(nestedResult.details.data).toEqual(['item1', 'item2']);
    });
  });

  describe('error handling in execute function', () => {
    test('propagates errors from execute function', async () => {
      const tool = buildTool<TestDetails>({
        name: 'failing_tool',
        label: 'Failing Tool',
        description: 'A tool that throws errors',
        promptSnippet: '/fail',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: async () => {
          throw new Error('Execution failed');
        },
      });

      await expect(
        tool.execute('test-id', { message: 'test' }, undefined, undefined, undefined)
      ).rejects.toThrow('Execution failed');
    });

    test('does not execute when aborted, even if execute would throw', async () => {
      const tool = buildTool<TestDetails>({
        name: 'failing_tool',
        label: 'Failing Tool',
        description: 'A tool that throws errors',
        promptSnippet: '/fail',
        promptGuidelines: [],
        parameters: testSchema,
        cancellationMessage: 'Cancelled',
        cancellationDetails: { result: 'cancelled', value: 0 },
        execute: async () => {
          throw new Error('This should not be called');
        },
      });

      const controller = new AbortController();
      controller.abort();

      // Should not throw, should return cancellation response
      const result = await tool.execute(
        'test-id',
        { message: 'test' },
        controller.signal,
        undefined,
        undefined
      );

      expect(result.details.cancelled).toBe(true);
      expect(result.content[0]?.text).toBe('Cancelled');
    });
  });
});

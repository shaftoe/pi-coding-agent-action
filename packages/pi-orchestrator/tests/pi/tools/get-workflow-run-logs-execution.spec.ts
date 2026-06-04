/**
 * @file Execution tests for the get_workflow_run_logs tool.
 *
 * Verifies that the tool correctly forwards parameters to the platform
 * provider and returns well-formed results.
 */

import { describe, expect, test, mock } from 'bun:test';
import { getWorkflowRunLogsToolFactory } from '@alexanderfortin/pi-orchestrator';
import { mockExtensionContext as mockCtx, createMockProvider } from '../../helpers/tool-mocks';

// get_workflow_run_logs runs in the pull_request event context with PR #42.
const providerOptions = { issueNumber: 42, eventName: 'pull_request' as const };

const SAMPLE_WORKFLOW_LOGS = {
  run_id: 100,
  jobs: [
    {
      id: 200,
      name: 'build',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T00:05:00Z',
      log: 'error TS1234: Some type error\n',
      truncated: false,
    },
  ],
  total_bytes: 35,
  truncated: false,
};

// ─── get_workflow_run_logs ──────────────────────────────────────────

describe('get_workflow_run_logs tool - execution', () => {
  test('has correct tool name and label', () => {
    const provider = createMockProvider();
    const tool = getWorkflowRunLogsToolFactory(provider);
    expect(tool.name).toBe('get_workflow_run_logs');
    expect(tool.label).toBe('Get Workflow Run Logs');
  });

  test('execute returns workflow run logs from provider', async () => {
    const getWorkflowRunLogs = mock(async () => ({
      content: [{ type: 'text' as const, text: 'Workflow run logs fetched' }],
      details: SAMPLE_WORKFLOW_LOGS,
    }));
    const provider = createMockProvider({ getWorkflowRunLogs }, providerOptions);
    const tool = getWorkflowRunLogsToolFactory(provider);

    const result = await tool.execute('call-1', { run_id: 100 }, undefined, undefined, mockCtx);

    expect(getWorkflowRunLogs).toHaveBeenCalledTimes(1);
    expect(result.content).toHaveLength(1);
    expect((result.content as any)[0].type).toBe('text');
    expect((result.details as any).run_id).toBe(100);
    expect((result.details as any).jobs).toHaveLength(1);
    expect((result.details as any).truncated).toBe(false);
  });

  test('execute forwards run_id to provider', async () => {
    const getWorkflowRunLogs = mock(async () => ({
      content: [{ type: 'text' as const, text: 'Workflow run logs fetched' }],
      details: SAMPLE_WORKFLOW_LOGS,
    }));
    const provider = createMockProvider({ getWorkflowRunLogs }, providerOptions);
    const tool = getWorkflowRunLogsToolFactory(provider);

    await tool.execute('call-2', { run_id: 999 }, undefined, undefined, mockCtx);

    expect(getWorkflowRunLogs).toHaveBeenCalledTimes(1);
    expect((getWorkflowRunLogs as any).mock.calls[0][0].run_id).toBe(999);
  });

  test('execute forwards max_bytes to provider', async () => {
    const getWorkflowRunLogs = mock(async () => ({
      content: [{ type: 'text' as const, text: 'Workflow run logs fetched' }],
      details: SAMPLE_WORKFLOW_LOGS,
    }));
    const provider = createMockProvider({ getWorkflowRunLogs }, providerOptions);
    const tool = getWorkflowRunLogsToolFactory(provider);

    await tool.execute('call-3', { run_id: 100, max_bytes: 10240 }, undefined, undefined, mockCtx);

    expect(getWorkflowRunLogs).toHaveBeenCalledTimes(1);
    expect((getWorkflowRunLogs as any).mock.calls[0][0].max_bytes).toBe(10240);
  });

  test('execute does not pass max_bytes when not provided', async () => {
    const getWorkflowRunLogs = mock(async () => ({
      content: [{ type: 'text' as const, text: 'Workflow run logs fetched' }],
      details: SAMPLE_WORKFLOW_LOGS,
    }));
    const provider = createMockProvider({ getWorkflowRunLogs }, providerOptions);
    const tool = getWorkflowRunLogsToolFactory(provider);

    await tool.execute('call-4', { run_id: 100 }, undefined, undefined, mockCtx);

    expect(getWorkflowRunLogs).toHaveBeenCalledTimes(1);
    expect((getWorkflowRunLogs as any).mock.calls[0][0].max_bytes).toBeUndefined();
  });

  test('execute propagates provider errors', async () => {
    const getWorkflowRunLogs = mock(async () => {
      throw new Error('Workflow run not found');
    });
    const provider = createMockProvider({ getWorkflowRunLogs }, providerOptions);
    const tool = getWorkflowRunLogsToolFactory(provider);

    await expect(
      tool.execute('call-error', { run_id: 100 }, undefined, undefined, mockCtx)
    ).rejects.toThrow('Workflow run not found');
  });

  test('execute returns cancellation result when signal is aborted', async () => {
    const getWorkflowRunLogs = mock(async () => ({
      content: [{ type: 'text' as const, text: 'Workflow run logs fetched' }],
      details: SAMPLE_WORKFLOW_LOGS,
    }));
    const provider = createMockProvider({ getWorkflowRunLogs }, providerOptions);
    const tool = getWorkflowRunLogsToolFactory(provider);

    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      'call-cancel',
      { run_id: 100 },
      controller.signal,
      undefined,
      mockCtx
    );

    expect(getWorkflowRunLogs).not.toHaveBeenCalled();
    expect((result.content as any)[0].text).toContain('cancelled');
    expect((result.details as any).cancelled).toBe(true);
    expect((result.details as any).run_id).toBe(0);
  });
});

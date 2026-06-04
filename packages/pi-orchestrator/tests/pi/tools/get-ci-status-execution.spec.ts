import { describe, expect, test, mock } from 'bun:test';
import { getCIStatusToolFactory } from '@alexanderfortin/pi-orchestrator';
import { mockExtensionContext as mockCtx, createMockProvider } from '../../helpers/tool-mocks';

// get_ci_status runs in the pull_request event context with PR #42.
const providerOptions = { issueNumber: 42, eventName: 'pull_request' as const };

const SAMPLE_CI_STATUS = {
  ref: 'abc123def456',
  check_runs: [
    {
      id: 1,
      name: 'build',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T00:05:00Z',
      html_url: 'https://github.com/test-owner/test-repo/runs/1',
      details_url: null,
    },
    {
      id: 2,
      name: 'lint',
      status: 'completed',
      conclusion: 'success',
      started_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T00:02:00Z',
      html_url: 'https://github.com/test-owner/test-repo/runs/2',
      details_url: null,
    },
  ],
  workflow_runs: [
    {
      id: 100,
      name: 'CI',
      status: 'completed',
      conclusion: 'failure',
      started_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/test-owner/test-repo/actions/runs/100',
      head_branch: 'main',
      head_sha: 'abc123',
      event: 'push',
    },
  ],
};

// ─── get_ci_status ──────────────────────────────────────────────────

describe('get_ci_status tool - execution', () => {
  test('has correct tool name and label', () => {
    const provider = createMockProvider();
    const tool = getCIStatusToolFactory(provider);
    expect(tool.name).toBe('get_ci_status');
    expect(tool.label).toBe('Get CI Status');
  });

  test('execute returns CI status from provider', async () => {
    const getCIStatus = mock(async () => ({
      content: [{ type: 'text' as const, text: 'CI status fetched' }],
      details: SAMPLE_CI_STATUS,
    }));
    const provider = createMockProvider({ getCIStatus }, providerOptions);
    const tool = getCIStatusToolFactory(provider);

    const result = await tool.execute(
      'call-1',
      { owner: 'test-owner', repo: 'test-repo', pull_number: 42 },
      undefined,
      undefined,
      mockCtx
    );

    expect(getCIStatus).toHaveBeenCalledTimes(1);
    expect(result.content).toHaveLength(1);
    expect((result.content as any)[0].type).toBe('text');
    expect((result.details as any).ref).toBe('abc123def456');
    expect((result.details as any).check_runs).toHaveLength(2);
    expect((result.details as any).workflow_runs).toHaveLength(1);
  });

  test('execute forwards status filter to provider', async () => {
    const getCIStatus = mock(async () => ({
      content: [{ type: 'text' as const, text: 'CI status fetched' }],
      details: SAMPLE_CI_STATUS,
    }));
    const provider = createMockProvider({ getCIStatus }, providerOptions);
    const tool = getCIStatusToolFactory(provider);

    await tool.execute(
      'call-2',
      { owner: 'test-owner', repo: 'test-repo', status: 'completed' },
      undefined,
      undefined,
      mockCtx
    );

    expect(getCIStatus).toHaveBeenCalledTimes(1);
    expect((getCIStatus as any).mock.calls[0][0].status).toBe('completed');
  });

  test('execute forwards conclusion filter to provider', async () => {
    const getCIStatus = mock(async () => ({
      content: [{ type: 'text' as const, text: 'CI status fetched' }],
      details: SAMPLE_CI_STATUS,
    }));
    const provider = createMockProvider({ getCIStatus }, providerOptions);
    const tool = getCIStatusToolFactory(provider);

    await tool.execute(
      'call-3',
      { owner: 'test-owner', repo: 'test-repo', conclusion: 'failure' },
      undefined,
      undefined,
      mockCtx
    );

    expect(getCIStatus).toHaveBeenCalledTimes(1);
    expect((getCIStatus as any).mock.calls[0][0].conclusion).toBe('failure');
  });

  test('execute forwards ref to provider', async () => {
    const getCIStatus = mock(async () => ({
      content: [{ type: 'text' as const, text: 'CI status fetched' }],
      details: SAMPLE_CI_STATUS,
    }));
    const provider = createMockProvider({ getCIStatus }, providerOptions);
    const tool = getCIStatusToolFactory(provider);

    await tool.execute('call-4', { ref: 'deadbeef' }, undefined, undefined, mockCtx);

    expect(getCIStatus).toHaveBeenCalledTimes(1);
    expect((getCIStatus as any).mock.calls[0][0].ref).toBe('deadbeef');
  });

  test('execute uses context defaults when no params provided', async () => {
    const getCIStatus = mock(async () => ({
      content: [{ type: 'text' as const, text: 'CI status fetched' }],
      details: SAMPLE_CI_STATUS,
    }));
    const provider = createMockProvider({ getCIStatus }, providerOptions);
    const tool = getCIStatusToolFactory(provider);

    await tool.execute('call-5', {}, undefined, undefined, mockCtx);

    expect(getCIStatus).toHaveBeenCalledTimes(1);
    const callParams = (getCIStatus as any).mock.calls[0][0];
    expect(callParams.owner).toBeUndefined();
    expect(callParams.repo).toBeUndefined();
    expect(callParams.pull_number).toBeUndefined();
  });

  test('execute propagates provider errors', async () => {
    const getCIStatus = mock(async () => {
      throw new Error('API rate limit exceeded');
    });
    const provider = createMockProvider({ getCIStatus }, providerOptions);
    const tool = getCIStatusToolFactory(provider);

    await expect(tool.execute('call-error', {}, undefined, undefined, mockCtx)).rejects.toThrow(
      'API rate limit exceeded'
    );
  });

  test('execute returns cancellation result when signal is aborted', async () => {
    const getCIStatus = mock(async () => ({
      content: [{ type: 'text' as const, text: 'CI status fetched' }],
      details: SAMPLE_CI_STATUS,
    }));
    const provider = createMockProvider({ getCIStatus }, providerOptions);
    const tool = getCIStatusToolFactory(provider);

    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute('call-cancel', {}, controller.signal, undefined, mockCtx);

    expect(getCIStatus).not.toHaveBeenCalled();
    expect((result.content as any)[0].text).toContain('cancelled');
    expect((result.details as any).cancelled).toBe(true);
    expect((result.details as any).ref).toBe('');
  });
});

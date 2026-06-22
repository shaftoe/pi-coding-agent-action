/**
 * Tests for ActionsOutputSink — the GitHub Actions output sink implementation.
 *
 * NOTE on mock.module: Bun's mock.module() snapshots the factory's return
 * value — use `mock.module` at the top of the file with mocked functions
 * that you can reference in expectations.
 */

import { describe, expect, test, beforeEach, mock } from 'bun:test';

const mockSetOutput = mock();
const mockSetFailed = mock();

// Mock @actions/core BEFORE importing the module-under-test.
mock.module('@actions/core', () => ({
  setOutput: mockSetOutput,
  setFailed: mockSetFailed,
  debug: mock(),
  info: mock(),
  warning: mock(),
  error: mock(),
  isDebug: mock(() => false),
}));

import { ActionsOutputSink } from '../../src/adapters/output-sink';

describe('ActionsOutputSink', () => {
  let sink: ActionsOutputSink;

  beforeEach(() => {
    mockSetOutput.mockClear();
    mockSetFailed.mockClear();
    sink = new ActionsOutputSink();
  });

  test('setOutput delegates to core.setOutput', () => {
    sink.setOutput('response', 'test response');
    expect(mockSetOutput).toHaveBeenCalledWith('response', 'test response');
  });

  test('setOutput handles numeric values', () => {
    sink.setOutput('tokens', 42);
    expect(mockSetOutput).toHaveBeenCalledWith('tokens', 42);
  });

  test('setOutput handles boolean values', () => {
    sink.setOutput('success', true);
    expect(mockSetOutput).toHaveBeenCalledWith('success', true);
  });

  test('setFailed delegates to core.setFailed', () => {
    const error = new Error('test error');
    sink.setFailed(error);
    expect(mockSetFailed).toHaveBeenCalledWith(error);
  });

  test('getExportDirectory returns path with format', () => {
    const originalRunnerTemp = process.env.RUNNER_TEMP;
    const originalGithubRunId = process.env.GITHUB_RUN_ID;
    process.env.RUNNER_TEMP = '/tmp/runner';
    process.env.GITHUB_RUN_ID = '12345';

    const dir = sink.getExportDirectory('html');
    expect(dir).toBe('/tmp/runner/pi-session-html-12345');

    const dirJsonl = sink.getExportDirectory('jsonl');
    expect(dirJsonl).toBe('/tmp/runner/pi-session-jsonl-12345');

    process.env.RUNNER_TEMP = originalRunnerTemp;
    process.env.GITHUB_RUN_ID = originalGithubRunId;
  });

  test('getExportDirectory falls back to os.tmpdir when RUNNER_TEMP not set', () => {
    const originalRunnerTemp = process.env.RUNNER_TEMP;
    const originalGithubRunId = process.env.GITHUB_RUN_ID;
    delete process.env.RUNNER_TEMP;
    delete process.env.GITHUB_RUN_ID;

    const dir = sink.getExportDirectory('html');
    expect(dir).toContain('pi-session-html-local');

    process.env.RUNNER_TEMP = originalRunnerTemp;
    process.env.GITHUB_RUN_ID = originalGithubRunId;
  });
});

/**
 * Tests for ActionsOutputSink — the GitHub Actions output sink implementation.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { coreMock, registerCoreMock } from '../../../../tests/helpers/core-mock';

registerCoreMock();

import { ActionsOutputSink } from '../../src/adapters/output-sink';

describe('ActionsOutputSink', () => {
  let sink: ActionsOutputSink;

  beforeEach(() => {
    coreMock.setOutput.mockClear();
    coreMock.setFailed.mockClear();
    sink = new ActionsOutputSink();
  });

  test('setOutput delegates to core.setOutput', () => {
    sink.setOutput('response', 'test response');
    expect(coreMock.setOutput).toHaveBeenCalledWith('response', 'test response');
  });

  test('setOutput handles numeric values', () => {
    sink.setOutput('tokens', 42);
    expect(coreMock.setOutput).toHaveBeenCalledWith('tokens', 42);
  });

  test('setOutput handles boolean values', () => {
    sink.setOutput('success', true);
    expect(coreMock.setOutput).toHaveBeenCalledWith('success', true);
  });

  test('setFailed delegates to core.setFailed', () => {
    const error = new Error('test error');
    sink.setFailed(error);
    expect(coreMock.setFailed).toHaveBeenCalledWith(error);
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

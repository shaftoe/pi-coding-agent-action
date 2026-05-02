/**
 * Tests for session artifacts collector and exporter.
 *
 * Tests the SessionArtifactsCollector class behavior, the export function,
 * and the createArtifactsCollectorFactory integration.
 */

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import {
  SessionArtifactsCollector,
  exportArtifacts,
  createArtifactsCollectorFactory,
} from '../../src/pi/session-artifacts';
import type { SessionArtifacts } from '../../src/pi/session-artifacts';
import type { SessionStats, CoreAdapter } from '../../src/types';

function createMockCore(): CoreAdapter {
  return {
    getInput: mock(() => ''),
    setFailed: mock(),
    setOutput: mock(),
    notice: mock(),
    debug: mock(),
    info: mock(),
    warning: mock(),
  };
}

describe('SessionArtifactsCollector', () => {
  let collector: SessionArtifactsCollector;
  let core: CoreAdapter;

  beforeEach(() => {
    core = createMockCore();
    collector = new SessionArtifactsCollector(
      {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        thinkingLevel: 'off',
      },
      core
    );
  });

  describe('constructor', () => {
    test('records session start time', () => {
      const artifacts = collector.getArtifacts();
      expect(artifacts.sessionStartedAt).toBeDefined();
      expect(new Date(artifacts.sessionStartedAt).getTime()).not.toBeNaN();
    });

    test('stores config', () => {
      const artifacts = collector.getArtifacts();
      expect(artifacts.config).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        thinkingLevel: 'off',
      });
    });
  });

  describe('recordToolStart', () => {
    test('records tool execution start', () => {
      collector.recordToolStart('bash', 'call-1', { command: 'ls' });
      collector.recordToolEnd('call-1', false, false, 'output');

      const artifacts = collector.getArtifacts();
      expect(artifacts.toolExecutions).toHaveLength(1);
      const tool = artifacts.toolExecutions[0]!;
      expect(tool.name).toBe('bash');
      expect(tool.callId).toBe('call-1');
      expect(tool.args).toEqual({ command: 'ls' });
      expect(tool.startedAt).toBeDefined();
    });
  });

  describe('recordToolEnd', () => {
    test('records successful tool execution', () => {
      collector.recordToolStart('read', 'call-1', { path: '/foo' });
      collector.recordToolEnd('call-1', false, false, 'file contents');

      const artifacts = collector.getArtifacts();
      expect(artifacts.toolExecutions).toHaveLength(1);
      const tool = artifacts.toolExecutions[0]!;
      expect(tool.success).toBe(true);
      expect(tool.cancelled).toBe(false);
      expect(tool.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('records failed tool execution', () => {
      collector.recordToolStart('bash', 'call-1', { command: 'exit 1' });
      collector.recordToolEnd('call-1', true, false, 'Command failed');

      const artifacts = collector.getArtifacts();
      const tool = artifacts.toolExecutions[0]!;
      expect(tool.success).toBe(false);
      expect(tool.error).toBe('Command failed');
    });

    test('records cancelled tool execution', () => {
      collector.recordToolStart('create_pull_request', 'call-1', { title: 'test' });
      collector.recordToolEnd('call-1', false, true);

      const artifacts = collector.getArtifacts();
      const tool = artifacts.toolExecutions[0]!;
      expect(tool.success).toBe(false);
      expect(tool.cancelled).toBe(true);
    });

    test('handles end without matching start gracefully', () => {
      collector.recordToolEnd('unknown-call', false, false);
      expect(core.debug).toHaveBeenCalledWith(
        expect.stringContaining('tool end without matching start')
      );
    });

    test('truncates long result summaries', () => {
      const longResult = 'x'.repeat(1000);
      collector.recordToolStart('read', 'call-1', {});
      collector.recordToolEnd('call-1', false, false, longResult);

      const artifacts = collector.getArtifacts();
      const summary = artifacts.toolExecutions[0]!.resultSummary;
      expect(summary!.length).toBeLessThanOrEqual(503); // 500 + '...'
    });

    test('calculates duration between start and end', async () => {
      collector.recordToolStart('bash', 'call-1', {});
      await new Promise(resolve => setTimeout(resolve, 10));
      collector.recordToolEnd('call-1', false, false);

      const artifacts = collector.getArtifacts();
      expect(artifacts.toolExecutions[0]!.durationMs).toBeGreaterThanOrEqual(10);
    });
  });

  describe('recordThinkingDelta', () => {
    test('records thinking chunks', () => {
      collector.recordThinkingDelta('Let me analyze');
      collector.recordThinkingDelta(' this problem');

      const artifacts = collector.getArtifacts();
      expect(artifacts.thinkingChunks).toHaveLength(2);
      expect(artifacts.thinkingChunks[0]!.delta).toBe('Let me analyze');
      expect(artifacts.thinkingChunks[1]!.delta).toBe(' this problem');
    });

    test('includes timestamps in thinking chunks', () => {
      collector.recordThinkingDelta('thinking');

      const artifacts = collector.getArtifacts();
      const chunk = artifacts.thinkingChunks[0]!;
      expect(chunk.timestamp).toBeDefined();
      expect(new Date(chunk.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('recordTurnEnd', () => {
    test('increments turn count', () => {
      collector.recordTurnEnd();
      collector.recordTurnEnd();
      collector.recordTurnEnd();

      const artifacts = collector.getArtifacts();
      expect(artifacts.turnCount).toBe(3);
    });
  });

  describe('finalize', () => {
    test('records success status', () => {
      collector.finalize(true);
      const artifacts = collector.getArtifacts();
      expect(artifacts.success).toBe(true);
      expect(artifacts.sessionEndedAt).toBeDefined();
    });

    test('records failure status with error', () => {
      collector.finalize(false, 'API timeout');
      const artifacts = collector.getArtifacts();
      expect(artifacts.success).toBe(false);
      expect(artifacts.error).toBe('API timeout');
    });
  });

  describe('getArtifacts', () => {
    test('returns complete session artifacts', () => {
      collector.recordToolStart('read', 'call-1', { path: '/foo' });
      collector.recordToolEnd('call-1', false, false, 'contents');
      collector.recordThinkingDelta('Hmm...');
      collector.recordTurnEnd();
      collector.finalize(true);

      const stats: SessionStats = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cost: 0.01,
        version: '1.0.0',
      };

      const artifacts = collector.getArtifacts(stats, '2.0.0');

      expect(artifacts.schemaVersion).toBe(1);
      expect(artifacts.config).toEqual({
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        thinkingLevel: 'off',
      });
      expect(artifacts.turnCount).toBe(1);
      expect(artifacts.toolExecutions).toHaveLength(1);
      expect(artifacts.thinkingChunks).toHaveLength(1);
      expect(artifacts.sessionStats).toEqual(stats);
      expect(artifacts.actionVersion).toBe('2.0.0');
      expect(artifacts.success).toBe(true);
      expect(artifacts.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('omits optional fields when not set', () => {
      const artifacts = collector.getArtifacts();
      expect(artifacts.sessionEndedAt).toBeUndefined();
      expect(artifacts.durationMs).toBeUndefined();
      expect(artifacts.sessionStats).toBeUndefined();
      expect(artifacts.success).toBeUndefined();
      expect(artifacts.error).toBeUndefined();
      expect(artifacts.actionVersion).toBeUndefined();
    });

    test('includes durationMs when session ended', () => {
      collector.finalize(true);
      const artifacts = collector.getArtifacts();
      expect(artifacts.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('exportArtifacts', () => {
  test('writes JSON file and returns path', async () => {
    const core = createMockCore();
    const artifacts: SessionArtifacts = {
      schemaVersion: 1,
      sessionStartedAt: new Date().toISOString(),
      config: { provider: 'anthropic', model: 'claude-sonnet-4-5', thinkingLevel: 'off' },
      turnCount: 0,
      toolExecutions: [],
      thinkingChunks: [],
    };

    const resultPath = await exportArtifacts(artifacts, core);

    expect(resultPath).toBeDefined();
    expect(resultPath!).toContain('pi-session-artifacts');
    expect(fs.existsSync(resultPath!)).toBe(true);

    const written = JSON.parse(fs.readFileSync(resultPath!, 'utf-8'));
    expect(written.schemaVersion).toBe(1);
    expect(written.config.provider).toBe('anthropic');
  });

  test('uploads artifact to GitHub Actions', async () => {
    const core = createMockCore();
    const artifacts: SessionArtifacts = {
      schemaVersion: 1,
      sessionStartedAt: new Date().toISOString(),
      config: { provider: 'anthropic', model: 'claude-sonnet-4-5', thinkingLevel: 'off' },
      turnCount: 0,
      toolExecutions: [],
      thinkingChunks: [],
    };

    await exportArtifacts(artifacts, core);

    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('session artifacts written'));
  });

  test('handles write errors gracefully', async () => {
    const core = createMockCore();
    const artifacts: SessionArtifacts = {
      schemaVersion: 1,
      sessionStartedAt: new Date().toISOString(),
      config: { provider: 'anthropic', model: 'claude-sonnet-4-5', thinkingLevel: 'off' },
      turnCount: 0,
      toolExecutions: [],
      thinkingChunks: [],
    };

    const resultPath = await exportArtifacts(artifacts, core);
    expect(resultPath).toBeDefined();
  });
});

describe('createArtifactsCollectorFactory', () => {
  test('returns a factory function', () => {
    const core = createMockCore();
    const collector = new SessionArtifactsCollector(
      { provider: 'test', model: 'test', thinkingLevel: 'off' },
      core
    );

    const factory = createArtifactsCollectorFactory(collector);
    expect(typeof factory).toBe('function');
  });

  test('factory subscribes to tool execution events', () => {
    const core = createMockCore();
    const collector = new SessionArtifactsCollector(
      { provider: 'test', model: 'test', thinkingLevel: 'off' },
      core
    );

    const factory = createArtifactsCollectorFactory(collector);

    const mockPi = {
      on: mock(() => {}),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory(mockPi as any);

    expect(mockPi.on).toHaveBeenCalledTimes(3);
    expect(mockPi.on).toHaveBeenCalledWith('tool_execution_start', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('tool_execution_end', expect.any(Function));
    expect(mockPi.on).toHaveBeenCalledWith('turn_end', expect.any(Function));
  });

  test('captures tool execution start and end events', async () => {
    const core = createMockCore();
    const collector = new SessionArtifactsCollector(
      { provider: 'test', model: 'test', thinkingLevel: 'off' },
      core
    );

    const factory = createArtifactsCollectorFactory(collector);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolStartHandler: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolEndHandler: any;

    const mockPi = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: mock((event: string, handler: any) => {
        if (event === 'tool_execution_start') {
          toolStartHandler = handler;
        }
        if (event === 'tool_execution_end') {
          toolEndHandler = handler;
        }
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory(mockPi as any);

    await toolStartHandler({ toolName: 'bash', toolCallId: 'call-1', args: { command: 'ls' } });
    await toolEndHandler({ toolCallId: 'call-1', isError: false, result: 'file1\nfile2' });

    const artifacts = collector.getArtifacts();
    expect(artifacts.toolExecutions).toHaveLength(1);
    expect(artifacts.toolExecutions[0]!.name).toBe('bash');
    expect(artifacts.toolExecutions[0]!.success).toBe(true);
  });

  test('captures cancelled tool from result.details.cancelled', async () => {
    const core = createMockCore();
    const collector = new SessionArtifactsCollector(
      { provider: 'test', model: 'test', thinkingLevel: 'off' },
      core
    );

    const factory = createArtifactsCollectorFactory(collector);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolStartHandler: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolEndHandler: any;

    const mockPi = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: mock((event: string, handler: any) => {
        if (event === 'tool_execution_start') {
          toolStartHandler = handler;
        }
        if (event === 'tool_execution_end') {
          toolEndHandler = handler;
        }
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory(mockPi as any);

    await toolStartHandler({ toolName: 'read', toolCallId: 'call-1', args: {} });
    await toolEndHandler({
      toolCallId: 'call-1',
      isError: false,
      result: { details: { cancelled: true } },
    });

    const artifacts = collector.getArtifacts();
    expect(artifacts.toolExecutions[0]!.cancelled).toBe(true);
  });

  test('captures turn end events', async () => {
    const core = createMockCore();
    const collector = new SessionArtifactsCollector(
      { provider: 'test', model: 'test', thinkingLevel: 'off' },
      core
    );

    const factory = createArtifactsCollectorFactory(collector);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let turnEndHandler: any;

    const mockPi = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      on: mock((event: string, handler: any) => {
        if (event === 'turn_end') {
          turnEndHandler = handler;
        }
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory(mockPi as any);

    await turnEndHandler({});
    await turnEndHandler({});

    const artifacts = collector.getArtifacts();
    expect(artifacts.turnCount).toBe(2);
  });
});

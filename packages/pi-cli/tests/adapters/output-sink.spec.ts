/**
 * @file Tests for {@link packages/pi-cli/src/adapters/output-sink.ts}.
 *
 * Covers:
 *   - stdout mode: prints response text to stdout with trailing newline
 *   - none mode: prints nothing
 *   - json mode: prints an error and sets exitCode=1 (M2 will wire it up)
 *   - setFailed: prints ✖ to stderr and sets process.exitCode=1
 *   - getExportDirectory: creates the temp directory
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import { CliOutputSink } from '../../src/adapters/output-sink.js';

describe('CliOutputSink', () => {
  let originalStderrWrite: typeof process.stderr.write;
  let originalStdoutWrite: typeof process.stdout.write;
  let exitCodeBefore: typeof process.exitCode;

  beforeEach(() => {
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    exitCodeBefore = process.exitCode;
    process.exitCode = 0 as any;

    process.stderr.write = vi.fn(() => true) as unknown as typeof process.stderr.write;
    process.stdout.write = vi.fn(() => true) as unknown as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
    process.exitCode = exitCodeBefore;
  });

  it('outputs response text to stdout in stdout mode', () => {
    const sink = new CliOutputSink();
    sink.setOutput('response', 'Hello, world!');
    sink.flush('stdout');
    expect(process.stdout.write).toHaveBeenCalledWith('Hello, world!');
  });

  it('ensures trailing newline on response', () => {
    const sink = new CliOutputSink();
    sink.setOutput('response', 'no newline');
    sink.flush('stdout');
    const writes = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
    expect(writes[writes.length - 1]?.[0]).toBe('\n');
  });

  it('does not emit extraneous newline when response already ends with one', () => {
    const sink = new CliOutputSink();
    sink.setOutput('response', 'hello\n');
    sink.flush('stdout');
    const all = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls
      .map(c => c[0] as string)
      .join('');
    expect(all).toBe('hello\n');
    expect(all).not.toBe('hello\n\n');
  });

  it('writes nothing to stdout in none mode', () => {
    const sink = new CliOutputSink();
    sink.setOutput('response', 'hi');
    sink.flush('none');
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('writes nothing to stderr in none mode', () => {
    const sink = new CliOutputSink();
    sink.flush('none');
    expect(process.stderr.write).not.toHaveBeenCalled();
  });

  it('rejects json mode with an error message and sets exitCode=1', () => {
    const sink = new CliOutputSink();
    sink.setOutput('response', 'hi');
    sink.flush('json');
    expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining('not supported yet'));
    expect(process.exitCode).toBe(1);
  });

  it('prints ✖ to stderr and sets exitCode=1 on setFailed', () => {
    const sink = new CliOutputSink();
    sink.setFailed(new Error('Kaboom'));
    sink.flush('stdout');
    expect(process.stderr.write).toHaveBeenCalledWith('✖ Kaboom\n');
    expect(process.exitCode).toBe(1);
  });

  it('prefers setFailed output over response text', () => {
    const sink = new CliOutputSink();
    sink.setOutput('response', 'should not appear');
    sink.setFailed(new Error('Boom'));
    sink.flush('stdout');
    // stdout should NOT get the response
    const stdoutCalls = (process.stdout.write as ReturnType<typeof vi.fn>).mock.calls;
    expect(stdoutCalls).toHaveLength(0);
  });

  it('getExportDirectory creates the directory', () => {
    const sink = new CliOutputSink();
    const dir = sink.getExportDirectory('html');
    expect(fs.existsSync(dir)).toBe(true);
    expect(dir).toContain('pi-cli-html');
    // Clean up
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('getExportDirectory creates jsonl variant', () => {
    const sink = new CliOutputSink();
    const dir = sink.getExportDirectory('jsonl');
    expect(fs.existsSync(dir)).toBe(true);
    expect(dir).toContain('pi-cli-jsonl');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

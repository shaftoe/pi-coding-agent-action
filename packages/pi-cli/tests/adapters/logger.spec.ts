/**
 * @file Tests for {@link packages/pi-cli/src/adapters/logger.ts}.
 *
 * Covers:
 *   - Level filtering: only messages at or below the configured severity
 *     are emitted to stderr.
 *   - Output destination is stderr (never stdout).
 *   - Each level renders with its documented prefix (`✖` for error, etc.).
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { CliLogger } from '../../src/adapters/logger.js';

describe('CliLogger', () => {
  let originalStderrWrite: typeof process.stderr.write;
  let originalStdoutWrite: typeof process.stdout.write;
  let stderrChunks: string[];
  let stdoutChunks: string[];

  beforeEach(() => {
    stderrChunks = [];
    stdoutChunks = [];
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stderr.write = mock((chunk: string | Uint8Array) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stderr.write;
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
  });

  function stderr(): string {
    return stderrChunks.join('');
  }

  describe('default level (warning)', () => {
    it('shows error and warning but suppresses notice/info/debug', () => {
      const log = new CliLogger('warning');
      log.error('e');
      log.warning('w');
      log.notice('n');
      log.info('i');
      log.debug('d');
      const out = stderr();
      expect(out).toContain('✖ e');
      expect(out).toContain('⚠ w');
      expect(out).not.toContain('n\n');
      expect(out).not.toContain('i\n');
      expect(out).not.toContain('[debug]');
    });
  });

  describe('--verbose (debug level)', () => {
    it('shows every level', () => {
      const log = new CliLogger('debug');
      log.error('e');
      log.warning('w');
      log.notice('n');
      log.info('i');
      log.debug('d');
      const out = stderr();
      expect(out).toContain('✖ e');
      expect(out).toContain('⚠ w');
      expect(out).toContain('n\n');
      expect(out).toContain('i\n');
      expect(out).toContain('[debug] d');
    });
  });

  describe('--quiet (error level)', () => {
    it('shows only errors', () => {
      const log = new CliLogger('error');
      log.error('e');
      log.warning('w');
      log.notice('n');
      log.info('i');
      log.debug('d');
      const out = stderr();
      expect(out).toContain('✖ e');
      expect(out).not.toContain('⚠');
      expect(out).not.toContain('n\n');
      expect(out).not.toContain('i\n');
      expect(out).not.toContain('[debug]');
    });
  });

  describe('output destination', () => {
    it('writes everything to stderr, never stdout', () => {
      const log = new CliLogger('debug');
      log.error('e');
      log.warning('w');
      log.info('i');
      log.startGroup?.('group');
      expect(stdoutChunks.join('')).toBe('');
      expect(stderr()).toMatch(/e.*w.*i.*group/s);
    });
  });

  describe('group markers', () => {
    it('renders startGroup as a ▸ header line', () => {
      const log = new CliLogger('debug');
      log.startGroup?.('my group');
      expect(stderr()).toContain('▸ my group\n');
    });

    it('endGroup is a no-op (no extra blank line)', () => {
      const log = new CliLogger('debug');
      log.info('before');
      log.startGroup?.('g');
      log.endGroup?.();
      log.info('after');
      // Two info lines + one group header, no extra blanks injected by endGroup
      expect(stderr()).toBe('before\n▸ g\nafter\n');
    });
  });

  describe('wouldEmit (used by callers / tests)', () => {
    it('respects the configured level', () => {
      const log = new CliLogger('warning');
      expect(log.wouldEmit('error')).toBe(true);
      expect(log.wouldEmit('warning')).toBe(true);
      expect(log.wouldEmit('notice')).toBe(false);
      expect(log.wouldEmit('info')).toBe(false);
      expect(log.wouldEmit('debug')).toBe(false);
    });
  });
});

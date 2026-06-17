/**
 * @file Tests for the `/pickup` command.
 *
 * Two layers, mirroring `handoff.spec.ts`:
 *   1. Pure helpers (`parsePRNumber`, `buildPickupPrompt`) — the arg parsing
 *      and prompt wording, unit-tested in isolation.
 *   2. The command handler — driven against a fake `pi` (records
 *      `sendUserMessage`), a fake `ctx` (controllable `isIdle`/`mode`), and a
 *      stub `Bridge` (controllable `getCurrentBranch`/`resolveCurrentPR`).
 */

import { describe, it, expect } from 'bun:test';
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import type { Bridge } from '../src/bridge.js';
import { parsePRNumber, buildPickupPrompt, registerPickupCommand } from '../src/pickup.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('parsePRNumber', () => {
  it('parses a bare number', () => {
    expect(parsePRNumber('123')).toBe(123);
  });
  it('parses a #-prefixed number', () => {
    expect(parsePRNumber('#42')).toBe(42);
  });
  it('tolerates surrounding whitespace', () => {
    expect(parsePRNumber('  #7  ')).toBe(7);
  });
  it('returns undefined for empty args (no explicit target)', () => {
    expect(parsePRNumber('')).toBeUndefined();
    expect(parsePRNumber('   ')).toBeUndefined();
  });
  it('returns undefined for non-numeric args (falls back to branch)', () => {
    // A typo shouldn't error the command — fall back to branch resolution,
    // which surfaces a clear "no PR on this branch" message instead.
    expect(parsePRNumber('abc')).toBeUndefined();
    expect(parsePRNumber('main')).toBeUndefined();
  });
  it('rejects zero and negative numbers', () => {
    expect(parsePRNumber('0')).toBeUndefined();
    expect(parsePRNumber('#-5')).toBeUndefined();
  });
});

describe('buildPickupPrompt', () => {
  it('includes the PR number and branch', () => {
    const p = buildPickupPrompt(42, 'feature-x');
    expect(p).toContain('PR #42');
    expect(p).toContain('branch `feature-x`');
  });
  it('omits the branch line when branch is undefined', () => {
    const p = buildPickupPrompt(7, undefined);
    expect(p).toContain('PR #7');
    expect(p).not.toContain('branch');
  });
  it('points the agent at both read-only tools', () => {
    const p = buildPickupPrompt(1, 'main');
    expect(p).toContain('`get_thread`');
    expect(p).toContain('`get_pr_diff`');
  });
  it('asks for an active summary (not passive context-injection)', () => {
    const p = buildPickupPrompt(1, 'main');
    expect(p.toLowerCase()).toContain('summary');
    expect(p.toLowerCase()).toContain('where things stand');
  });
});

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/** Recorded `pi.sendUserMessage` calls. */
interface PiLog {
  sent: string[];
}

/** Fake pi exposing only what `/pickup`'s handler touches. */
function makeFakePi(log: PiLog): Parameters<typeof registerPickupCommand>[0] {
  return {
    registerCommand: (
      _name: string,
      options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
    ) => {
      // Stash the handler so a test can invoke it directly. The returned fake
      // carries the last-registered command's handler.
      (
        makeFakePi as unknown as {
          _handler?: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
        }
      )._handler = options.handler;
    },
    sendUserMessage: (content: string) => {
      log.sent.push(typeof content === 'string' ? content : JSON.stringify(content));
    },
  } as unknown as Parameters<typeof registerPickupCommand>[0];
}

/** Bridge stub with controllable branch + PR resolution. */
function makeStubBridge(opts: { branch?: string | undefined; pr?: number | undefined }): Bridge {
  return {
    getCurrentBranch: async () => opts.branch,
    resolveCurrentPR: async () => opts.pr,
  } as unknown as Bridge;
}

/** Fake ctx with controllable idle/mode. */
function makeFakeCtx(opts: { idle?: boolean; mode?: 'tui' | 'rpc' }): ExtensionCommandContext {
  const notifies: string[] = [];
  const ctx = {
    mode: opts.mode ?? 'tui',
    hasUI: true,
    isIdle: () => opts.idle ?? true,
    ui: {
      notify: (msg: string) => {
        notifies.push(msg);
      },
      setStatus: () => {},
    },
  };
  // Expose notifies for assertions via a side channel.
  (ctx as unknown as { _notifies: string[] })._notifies = notifies;
  return ctx as unknown as ExtensionCommandContext;
}

/** Helper: register and grab the handler back. */
function getHandler(): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
  const handler = (
    makeFakePi as unknown as {
      _handler?: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    }
  )._handler;
  if (!handler) {
    throw new Error('no command registered');
  }
  return handler;
}

describe('/pickup command', () => {
  it('resolves the PR from the branch and sends the pickup prompt', async () => {
    const log: PiLog = { sent: [] };
    const pi = makeFakePi(log);
    registerPickupCommand(pi, makeStubBridge({ branch: 'feature-x', pr: 42 }));
    await getHandler()('', makeFakeCtx({ idle: true }));
    expect(log.sent.length).toBe(1);
    expect(log.sent[0]).toContain('PR #42');
    expect(log.sent[0]).toContain('branch `feature-x`');
  });

  it('an explicit number wins over the branch', async () => {
    const log: PiLog = { sent: [] };
    const pi = makeFakePi(log);
    // Branch resolves to 42, but explicit arg is 99.
    registerPickupCommand(pi, makeStubBridge({ branch: 'feature-x', pr: 42 }));
    await getHandler()('#99', makeFakeCtx({ idle: true }));
    expect(log.sent[0]).toContain('PR #99');
    expect(log.sent[0]).not.toContain('PR #42');
  });

  it('explicit number works with no resolvable branch (e.g. a fork PR checkout)', async () => {
    const log: PiLog = { sent: [] };
    const pi = makeFakePi(log);
    // No branch / no auto-resolved PR — the explicit arg is the only source.
    registerPickupCommand(pi, makeStubBridge({ branch: undefined, pr: undefined }));
    await getHandler()('123', makeFakeCtx({ idle: true }));
    expect(log.sent[0]).toContain('PR #123');
    expect(log.sent[0]).not.toContain('branch'); // no branch line
  });

  it('notifies (no send) when there is no PR on the branch and no arg', async () => {
    const log: PiLog = { sent: [] };
    const pi = makeFakePi(log);
    registerPickupCommand(pi, makeStubBridge({ branch: 'orphan', pr: undefined }));
    const ctx = makeFakeCtx({ idle: true });
    await getHandler()('', ctx);
    expect(log.sent.length).toBe(0);
    const notifies = (ctx as unknown as { _notifies: string[] })._notifies;
    expect(notifies.some(m => m.includes("'orphan'"))).toBe(true);
    expect(notifies.some(m => m.includes('/pickup <number>'))).toBe(true);
  });

  it('notifies (no send) on detached HEAD with no arg', async () => {
    const log: PiLog = { sent: [] };
    const pi = makeFakePi(log);
    registerPickupCommand(pi, makeStubBridge({ branch: undefined, pr: undefined }));
    const ctx = makeFakeCtx({ idle: true });
    await getHandler()('', ctx);
    expect(log.sent.length).toBe(0);
    const notifies = (ctx as unknown as { _notifies: string[] })._notifies;
    expect(notifies.some(m => m.toLowerCase().includes('detached'))).toBe(true);
  });

  it('does not send when the agent is busy (idle guard)', async () => {
    const log: PiLog = { sent: [] };
    const pi = makeFakePi(log);
    registerPickupCommand(pi, makeStubBridge({ branch: 'feature-x', pr: 42 }));
    const ctx = makeFakeCtx({ idle: false });
    await getHandler()('', ctx);
    expect(log.sent.length).toBe(0);
    const notifies = (ctx as unknown as { _notifies: string[] })._notifies;
    expect(notifies.some(m => m.toLowerCase().includes('busy'))).toBe(true);
  });

  it('does not send in non-TUI mode (rpc/print)', async () => {
    const log: PiLog = { sent: [] };
    const pi = makeFakePi(log);
    registerPickupCommand(pi, makeStubBridge({ branch: 'feature-x', pr: 42 }));
    const ctx = makeFakeCtx({ mode: 'rpc', idle: true });
    await getHandler()('', ctx);
    expect(log.sent.length).toBe(0);
    const notifies = (ctx as unknown as { _notifies: string[] })._notifies;
    expect(notifies.some(m => m.includes('TUI'))).toBe(true);
  });
});

#!/usr/bin/env bun
/**
 * @file pi-cli entry point.
 *
 * Parses argv with `commander` and dispatches to a subcommand handler.
 * M1 ships only the `run` subcommand; `review` and `thread` are planned
 * for M3.
 *
 * The shebang above targets `bun` since the package is TS-only and the
 * repo is Bun-first. When published as an npm package (M4) the binary
 * will be an esbuild bundle so the shebang will switch to `node`.
 */

import { Command, CommanderError } from 'commander';
import * as path from 'node:path';
import { runCommand, type RunCommandArgs } from './commands/run.js';

/**
 * Build the commander program. Exported so tests can introspect the CLI
 * shape without invoking handlers.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('pi-cli')
    .description(
      'Terminal frontend for the Pi orchestrator. ' +
        'Runs the same agent + tools as the GitHub Action, from a local shell.'
    )
    // Commander's default is to call process.exit on --help / errors.
    // We override exitOutput so tests can run the program without the
    // process dying mid-test; in production, the exitCode is set instead.
    .exitOverride((err: CommanderError) => {
      // CommanderError codes: 'commander.help', 'commander.version',
      // 'commander.helpDisplayed' are non-fatal (user asked for help).
      // Errors have exitCode > 0 and we let commander write the message.
      if (err.code === 'commander.help' || err.code === 'commander.helpDisplayed') {
        process.exitCode = 0;
        return;
      }
      if (err.code === 'commander.version') {
        process.exitCode = 0;
        return;
      }
      process.exitCode = err.exitCode ?? 1;
    });

  program
    .command('run <prompt>')
    .description('Run the Pi agent with a free-form prompt against a GitHub-compatible repo.')
    .requiredOption(
      '--repo <owner/repo>',
      'Target repository (e.g. shaftoe/pi-coding-agent-action).'
    )
    .requiredOption('--provider <id>', 'LLM provider id (e.g. anthropic, openai, google).')
    .requiredOption('--model <id>', 'LLM model id (e.g. claude-sonnet-4-5).')
    .option('--cwd <path>', 'Working directory for the agent.', process.cwd())
    .option(
      '--server-url <url>',
      'Git host server URL. Drives platform detection and Octokit base URL.',
      'https://github.com'
    )
    .option('--verbose', 'Show debug-level logs (mutually exclusive with --quiet).')
    .option('--quiet', 'Suppress all logs except errors (mutually exclusive with --verbose).')
    .action(async (prompt: string, opts: RunCommandArgs) => {
      // Errors thrown here propagate to main()'s outer catch, which writes
      // a ✖ line to stderr and sets process.exitCode=1. runCommand handles
      // its own internal failures via the OutputSink (which also sets
      // process.exitCode), but we don't swallow the throw — it's the
      // signal that the run failed.
      await runCommand({
        ...opts,
        prompt,
        // Resolve cwd relative to current cwd so `--cwd ./foo` works.
        cwd: path.resolve(opts.cwd),
      });
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

// Skip automatic execution when imported (e.g. in tests).
const invokedDirectly = import.meta.main === true || process.argv[1]?.endsWith('index.ts');
if (invokedDirectly) {
  main().catch(err => {
    // runCommand handles orchestrator errors via the OutputSink (prints
    // its own ✖ line and sets process.exitCode). This outer catch is for
    // setup errors (token missing, mutex violation, bad --repo) where
    // runCommand threw before reaching the orchestrator.
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`✖ ${msg}\n`);
    process.exitCode = 1;
  });
}

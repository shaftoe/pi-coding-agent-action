import * as core from '@actions/core';
import * as github from '@actions/github';
import { PiClient } from './pi';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';

const provider = core.getInput('provider');
const modInput = core.getInput('model');
const token = core.getInput('token');
const thinkingInput = core.getInput('thinking_level');

export async function run() {
  const payload = github.context.payload;
  const body = payload.issue?.body ?? payload.pull_request?.body ?? undefined;
  if (!body) {
    throw new Error('no body, skipping prompt');
  }

  const pi = await new PiClient(
    modInput,
    provider,
    token,
    (thinkingInput ?? 'off') as ThinkingLevel
  ).ready();
  const result = await pi.prompt(body);

  core.setOutput('result', result);
  const octokit = github.getOctokit(token);
  await octokit.rest.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: github.context.issue.number,
    body: result,
  });
}

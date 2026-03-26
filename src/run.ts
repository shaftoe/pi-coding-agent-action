import * as core from '@actions/core';
import * as github from '@actions/github';
import { PiClient } from './pi';
import type { ThinkingLevel } from '@mariozechner/pi-agent-core';

const provider = core.getInput('provider');
const modInput = core.getInput('model');
const token = core.getInput('token');
const githubToken = core.getInput('github_token');
const thinkingInput = core.getInput('thinking_level');

export async function run() {
  const comment = github.context.payload.comment;
  if (!comment) {
    core.notice('no comment found in context, skipping prompt');
    return;
  }

  const pi = await new PiClient(
    modInput,
    provider,
    token,
    (thinkingInput ?? 'off') as ThinkingLevel
  ).ready();
  core.info('[prompt] ' + comment.body);
  const result = await pi.prompt(comment.body);

  const octokit = github.getOctokit(githubToken);
  await octokit.rest.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: github.context.issue.number,
    body: result,
  });
}

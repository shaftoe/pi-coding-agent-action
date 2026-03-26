import * as core from '@actions/core';
import * as github from '@actions/github';
import { Client } from './pi';

const provider = core.getInput('provider');
const model = core.getInput('model');
const token = core.getInput('token');
const githubToken = core.getInput('github_token');
const thinkingInput = core.getInput('thinking_level') ?? 'off';
const trigger = core.getInput('trigger') || '/pi';

export async function run() {
  const comment = github.context.payload.comment;
  if (!comment) {
    core.notice('no comment found in context, skipping prompt');
    return;
  }
  const prompt = comment.body.replace(trigger, '').trim();
  const pi = await new Client(model, provider, token, thinkingInput).ready();

  const octokit = github.getOctokit(githubToken);
  const reaction = await octokit.rest.reactions.createForIssueComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: comment.id,
    content: 'eyes',
  });

  const result = await pi.prompt(prompt);

  await octokit.rest.reactions.deleteForIssueComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: comment.id,
    reaction_id: reaction.data.id,
  });
  await octokit.rest.issues.createComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: github.context.issue.number,
    body: result,
  });
}

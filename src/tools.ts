import { Type } from '@mariozechner/pi-ai';
import * as core from '@actions/core';
import { createPullRequest } from './github';
import {
  PULL_REQUEST_TOOL,
  TOOL_EXECUTION,
  TOOL_REGISTRATION,
} from './prompt';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import type { CreatePullRequestParams } from './github';

export const extFactory = (pi: ExtensionAPI): void => {
  pi.registerTool({
    name: PULL_REQUEST_TOOL.name,
    label: PULL_REQUEST_TOOL.label,
    description: PULL_REQUEST_TOOL.description,
    promptSnippet: PULL_REQUEST_TOOL.promptSnippet,
    promptGuidelines: PULL_REQUEST_TOOL.guidelines,
    parameters: Type.Object({
      title: Type.String({
        description: PULL_REQUEST_TOOL.parameters.title.description,
      }),
      body: Type.Optional(
        Type.String({
          description: PULL_REQUEST_TOOL.parameters.body.description,
        })
      ),
      base: Type.Optional(
        Type.String({
          description: PULL_REQUEST_TOOL.parameters.base.description,
        })
      ),
      dryRun: Type.Optional(
        Type.Boolean({
          description: PULL_REQUEST_TOOL.parameters.dryRun.description,
        })
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      core.debug(TOOL_EXECUTION.createPullRequest.called);

      // Check for cancellation
      if (signal?.aborted) {
        core.warning('[create_pull_request] Tool execution cancelled');

        return {
          content: [
            {
              type: 'text' as const,
              text: TOOL_EXECUTION.createPullRequest.cancelled,
            },
          ],
          details: {},
        };
      }

      const { title, body, base, dryRun } = params as CreatePullRequestParams;

      // Delegate to the GitHub-specific implementation
      const prParams: CreatePullRequestParams = { title };
      if (body !== undefined) {
        prParams.body = body;
      }
      if (base !== undefined) {
        prParams.base = base;
      }
      if (dryRun !== undefined) {
        prParams.dryRun = dryRun;
      }

      return await createPullRequest(prParams);
    },
  });

  core.info(TOOL_REGISTRATION.createPullRequest);
};

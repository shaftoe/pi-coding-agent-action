/**
 * @file Parse GitHub Actions URLs into parameters for workflow log retrieval.
 *
 * Parsing is local only: it does not verify that a run or job exists or that
 * the caller is authorized to access it. The configured server origin is
 * checked so parsed IDs are not silently used against a different host.
 */

import { Type, type Static } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import {
  PARSE_ACTIONS_URL_DESCRIPTION,
  PARSE_ACTIONS_URL_PROMPT_SNIPPET,
  PARSE_ACTIONS_URL_PROMPT_GUIDELINES,
  PARSE_ACTIONS_URL_PARAM_URL_DESCRIPTION,
} from '../prompt';
import { CANCELLATION_MESSAGE_PARSE_ACTIONS_URL } from './constants';
import { PREFER_STRICT_JSON_SCHEMA } from './schema';
import { PI_ACTION_NAMESPACE, parseActionsUrlOutputSchema, toStructuredContent } from './metadata';
import { withCancellation } from './tool-execution';
import type { PlatformProvider } from '../../platform';

/** Parsed parameters, also exposed as the tool's structured output. */
export interface ParseActionsUrlDetails {
  owner: string;
  repo: string;
  run_id: number;
  job_id: number | null;
  cancelled?: boolean;
}

/** Convert a decimal URL ID without silently losing integer precision. */
function parseId(value: string, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return id;
}

/**
 * Parse a run or job URL on the configured GitHub server. Queries, fragments,
 * and one trailing slash are ignored. Other URL shapes are rejected rather
 * than guessed. HTTP is allowed for self-hosted servers, but origins must match.
 *
 * Forgejo/Codeberg URLs must not be passed here: their run numbers are not
 * necessarily API run IDs and require platform-specific resolution.
 */
export function parseActionsUrl(
  input: string,
  serverUrl = 'https://github.com'
): ParseActionsUrlDetails {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Expected an absolute GitHub Actions workflow run or job URL.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Expected an HTTP(S) Actions URL without embedded credentials.');
  }

  const server = new URL(serverUrl);
  if (url.origin !== server.origin) {
    throw new Error(`Actions URL must use the configured GitHub server: ${server.origin}.`);
  }
  const prefix = server.pathname.replace(/\/$/, '');
  const path = url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length) : '';
  const match =
    /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/actions\/runs\/([0-9]+)(?:\/job\/([0-9]+))?\/?$/.exec(
      path
    );
  if (!match) {
    throw new Error('Expected /<owner>/<repo>/actions/runs/<run_id>[/job/<job_id>].');
  }
  const [, owner, repo, runId, jobId] = match;
  return {
    owner: owner!,
    repo: repo!,
    run_id: parseId(runId!, 'run_id'),
    job_id: jobId === undefined ? null : parseId(jobId, 'job_id'),
  };
}

const parseActionsUrlSchema = Type.Object(
  {
    url: Type.String({ minLength: 1, description: PARSE_ACTIONS_URL_PARAM_URL_DESCRIPTION }),
  },
  { additionalProperties: false }
);
type ParseActionsUrlParams = Static<typeof parseActionsUrlSchema>;

/** Create the local-only parser tool, bound to the current GitHub server. */
export function parseActionsUrlToolFactory(provider: PlatformProvider) {
  return defineTool({
    name: 'parse_actions_url',
    label: 'Parse Actions URL',
    description: PARSE_ACTIONS_URL_DESCRIPTION,
    promptSnippet: PARSE_ACTIONS_URL_PROMPT_SNIPPET,
    promptGuidelines: PARSE_ACTIONS_URL_PROMPT_GUIDELINES,
    parameters: parseActionsUrlSchema,
    constrainedSampling: PREFER_STRICT_JSON_SCHEMA,
    namespace: PI_ACTION_NAMESPACE,
    annotations: { readOnlyHint: true, openWorldHint: false },
    outputSchema: parseActionsUrlOutputSchema,
    execute: withCancellation<
      ParseActionsUrlParams,
      ParseActionsUrlDetails,
      ParseActionsUrlDetails
    >({
      cancellationMessage: CANCELLATION_MESSAGE_PARSE_ACTIONS_URL,
      cancellationDetails: { owner: '', repo: '', run_id: 0, job_id: null },
      structuredContent: toStructuredContent,
      prepareParams: params => {
        if (provider.type !== 'github') {
          throw new Error(
            'Only GitHub Actions URLs are supported. Forgejo/Codeberg run numbers cannot be used as API run IDs.'
          );
        }
        return parseActionsUrl(params.url, provider.getContext().serverUrl);
      },
      execute: async details => ({
        content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
        details,
      }),
    }),
  });
}

import { describe, expect, test, vi } from 'vitest';
import {
  parseActionsUrl,
  parseActionsUrlToolFactory,
  getWorkflowRunLogsToolFactory,
} from '@alexanderfortin/pi-orchestrator';
import { createMockProvider, mockExtensionContext as ctx } from '../../helpers/tool-mocks';

const RUN_URL = 'https://github.com/foo/bar/actions/runs/45398608466';
const JOB_URL = `${RUN_URL}/job/138465401032`;
const RUN_PARAMS = { owner: 'foo', repo: 'bar', run_id: 45398608466, job_id: null };
const JOB_PARAMS = { ...RUN_PARAMS, job_id: 138465401032 };

function createProvider(serverUrl: string) {
  const provider = createMockProvider();
  return createMockProvider({
    getContext: () => ({ ...provider.getContext(), serverUrl }),
  });
}

describe('parseActionsUrl', () => {
  test.each([
    [RUN_URL, RUN_PARAMS],
    [JOB_URL, JOB_PARAMS],
    [`${RUN_URL}/`, RUN_PARAMS],
    [`${JOB_URL}/?check_suite_focus=true#step:4:2`, JOB_PARAMS],
    [`${RUN_URL}?job_id=999#job/999`, RUN_PARAMS],
    ['https://GitHub.com/foo/bar/actions/runs/45398608466', RUN_PARAMS],
    [
      'https://github.com/Some-Owner/my.repo_name-1/actions/runs/1/job/2',
      { owner: 'Some-Owner', repo: 'my.repo_name-1', run_id: 1, job_id: 2 },
    ],
    [
      'https://github.com/foo/bar/actions/runs/9007199254740991',
      { ...RUN_PARAMS, run_id: Number.MAX_SAFE_INTEGER },
    ],
  ])('parses %s', (url, expected) => {
    expect(parseActionsUrl(url)).toEqual(expected);
  });

  test.each([
    ['https://github.example.com', 'https://github.example.com/foo/bar/actions/runs/45398608466'],
    ['http://git.internal:3000', 'http://git.internal:3000/foo/bar/actions/runs/45398608466'],
    [
      'https://git.example.com/github/',
      'https://git.example.com/github/foo/bar/actions/runs/45398608466',
    ],
  ])('accepts the configured enterprise server %s', (server, url) => {
    expect(parseActionsUrl(url, server)).toEqual(RUN_PARAMS);
  });

  test.each([
    '',
    'not a URL',
    '/foo/bar/actions/runs/1',
    '//github.com/foo/bar/actions/runs/1',
    'https://github.com/foo/bar',
    'https://github.com/foo/bar/actions',
    'https://github.com/foo/bar/actions/runs',
    'https://github.com/foo/bar/actions/runs/1/job',
    'https://github.com/foo/bar/actions/runs/1/jobs/2',
    'https://github.com/foo/bar/actions/runs/1/job/2/steps/3',
    'https://github.com/foo/bar/actions/runs/1/attempts/2',
    'https://github.com/foo/bar/actions/runs/1//',
    'https://github.com/foo/bar/actions/runs/1.5',
    'https://github.com/foo/bar/actions/runs/-1',
    'https://github.com/foo/bar/actions/runs/1e3',
    'https://github.com/foo/bar/actions/runs/abc',
    'https://github.com/foo/bar/actions/runs/1/job/abc',
    'https://github.com/foo%2Fother/bar/actions/runs/1',
    'ftp://github.com/foo/bar/actions/runs/1',
    'javascript:alert(1)',
    'https://user:secret@github.com/foo/bar/actions/runs/1',
    'https://user@github.com/foo/bar/actions/runs/1',
  ])('rejects unsupported URL %s', url => {
    expect(() => parseActionsUrl(url)).toThrow();
  });

  test.each([
    'https://evil.example/foo/bar/actions/runs/1',
    'https://github.com.evil.example/foo/bar/actions/runs/1',
    'https://github.com@evil.example/foo/bar/actions/runs/1',
    'https://github.com:8443/foo/bar/actions/runs/1',
    'http://github.com/foo/bar/actions/runs/1',
  ])('rejects a different origin: %s', url => {
    expect(() => parseActionsUrl(url)).toThrow();
  });

  test('does not accept public GitHub links on an enterprise server', () => {
    expect(() => parseActionsUrl(RUN_URL, 'https://github.example.com')).toThrow(
      'configured GitHub server'
    );
  });

  test('rejects paths outside a configured server prefix', () => {
    expect(() => parseActionsUrl(RUN_URL, 'https://github.com/prefix')).toThrow(
      'Expected /<owner>'
    );
  });

  test.each([
    ['0', undefined, 'run_id'],
    ['9007199254740992', undefined, 'run_id'],
    ['9999999999999999999999999999999', undefined, 'run_id'],
    ['1', '0', 'job_id'],
    ['1', '9007199254740993', 'job_id'],
  ])('rejects invalid numeric IDs (run %s, job %s)', (runId, jobId, field) => {
    const url = `https://github.com/foo/bar/actions/runs/${runId}${jobId === undefined ? '' : `/job/${jobId}`}`;
    expect(() => parseActionsUrl(url)).toThrow(`${field} must be a positive safe integer.`);
  });
});

describe('parse_actions_url tool', () => {
  test('declares a strict URL-only input and local read-only metadata', () => {
    const tool = parseActionsUrlToolFactory(createMockProvider());
    expect(tool.name).toBe('parse_actions_url');
    expect(tool.parameters.required).toEqual(['url']);
    expect(Object.keys(tool.parameters.properties)).toEqual(['url']);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.constrainedSampling).toEqual({ type: 'json_schema', strict: 'prefer' });
    expect(tool.namespace?.name).toBe('pi_action');
    expect(tool.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(tool.outputSchema).toMatchObject({
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        run_id: { type: 'number' },
        job_id: { anyOf: [{ type: 'number' }, { type: 'null' }] },
      },
    });
  });

  test.each([
    [RUN_URL, RUN_PARAMS],
    [JOB_URL, JOB_PARAMS],
  ])('returns matching text, details, and structured content for %s', async (url, expected) => {
    const tool = parseActionsUrlToolFactory(createMockProvider());
    const result = await tool.execute('parse', { url }, undefined, undefined, ctx);

    expect(result.isError).not.toBe(true);
    expect(result.details).toEqual(expected);
    expect(result.structuredContent).toEqual(expected);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(expected, null, 2) }]);
  });

  test('uses the configured enterprise server', async () => {
    const tool = parseActionsUrlToolFactory(createProvider('https://github.example.com'));
    const result = await tool.execute(
      'enterprise',
      { url: JOB_URL.replace('github.com', 'github.example.com') },
      undefined,
      undefined,
      ctx
    );
    expect(result.details).toEqual(JOB_PARAMS);
  });

  test.each(['forgejo', 'codeberg'] as const)('rejects %s run-number URLs', async type => {
    const tool = parseActionsUrlToolFactory(createMockProvider({ type }));
    const result = await tool.execute(
      'other-platform',
      { url: 'https://codeberg.org/foo/bar/actions/runs/1' },
      undefined,
      undefined,
      ctx
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error:
        'Only GitHub Actions URLs are supported. Forgejo/Codeberg run numbers cannot be used as API run IDs.',
    });
  });

  test('reports invalid URLs without exposing embedded credentials', async () => {
    const tool = parseActionsUrlToolFactory(createMockProvider());
    const result = await tool.execute(
      'invalid',
      { url: 'https://user:secret@github.com/foo/bar/actions/runs/1' },
      undefined,
      undefined,
      ctx
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      error: 'Expected an HTTP(S) Actions URL without embedded credentials.',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  test('cancels before reading platform context or parsing', async () => {
    const getContext = vi.fn(() => {
      throw new Error('Context must not be read');
    });
    const tool = parseActionsUrlToolFactory(createMockProvider({ getContext }));
    const controller = new AbortController();
    controller.abort();
    const result = await tool.execute(
      'cancel',
      { url: 'not a URL' },
      controller.signal,
      undefined,
      ctx
    );
    expect(getContext).not.toHaveBeenCalled();
    expect(result.isError).not.toBe(true);
    expect(result.details.cancelled).toBe(true);
    expect(result.structuredContent).toEqual(result.details);
    expect(result.content).toEqual([{ type: 'text', text: 'Actions URL parsing was cancelled' }]);
  });

  test.each([RUN_URL, JOB_URL])('composes with get_workflow_run_logs for %s', async url => {
    const getWorkflowRunLogs = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'Fetched logs' }],
      details: { run_id: RUN_PARAMS.run_id, jobs: [], total_bytes: 0, truncated: false },
    }));
    const provider = createMockProvider({ getWorkflowRunLogs });
    const parsed = await parseActionsUrlToolFactory(provider).execute(
      'parse',
      { url },
      undefined,
      undefined,
      ctx
    );
    // Parsing never fetches logs. Its result can be handed straight to the
    // real logs tool, whose boundary drops null job_id and max_bytes values.
    expect(getWorkflowRunLogs).not.toHaveBeenCalled();
    const result = await getWorkflowRunLogsToolFactory(provider).execute(
      'logs',
      { ...parsed.details, max_bytes: null },
      undefined,
      undefined,
      ctx
    );
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: 'Fetched logs' }]);
    expect(getWorkflowRunLogs).toHaveBeenCalledExactlyOnceWith({
      owner: 'foo',
      repo: 'bar',
      run_id: RUN_PARAMS.run_id,
      ...(url === JOB_URL ? { job_id: JOB_PARAMS.job_id } : {}),
    });
  });
});

/**
 * Tests for the gist-sharing util (`createSessionGist`).
 *
 * Verifies the exact HTTP contract (method, headers, body) and the shape of
 * the returned viewer link (including the `#` fragment the pi.dev viewer
 * reads from `location.hash`). Uses a mocked global `fetch`.
 */

import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';
import {
  createSessionGist,
  DEFAULT_SHARE_VIEWER_URL,
  DEFAULT_GITHUB_GIST_API,
  GIST_CREATE_TIMEOUT_MS,
  PI_DEV_VIEWER_URL,
  resolveShareViewerUrl,
  githubGistProvider,
} from '../../src/share/gist';

describe('createSessionGist', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'abc123def456',
        html_url: 'https://gist.github.com/bot/abc123def456',
        files: {
          'session.html': { raw_url: 'https://gist.githubusercontent.com/bot/abc123def456/raw' },
        },
      }),
      text: async () => '',
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('creates a secret gist with the correct HTTP contract', async () => {
    await createSessionGist({ token: 'ghp_token', content: '<html>session</html>' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const calls = (globalThis.fetch as any).mock.calls;
    const [url, init] = calls[0];
    expect(url).toBe(DEFAULT_GITHUB_GIST_API);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_token');
    expect(headers.Accept).toBe('application/vnd.github+json');

    const body = JSON.parse(init?.body as string);
    expect(body.public).toBe(false);
    expect(body.files['session.html'].content).toBe('<html>session</html>');
  });

  test('returns a pi.dev share link with the # fragment', async () => {
    const gist = await createSessionGist({ token: 't', content: 'x' });
    expect(gist.id).toBe('abc123def456');
    expect(gist.gistUrl).toBe('https://gist.github.com/bot/abc123def456');
    expect(gist.rawUrl).toBe('https://gist.githubusercontent.com/bot/abc123def456/raw');
    expect(gist.shareUrl).toBe(`${DEFAULT_SHARE_VIEWER_URL}#abc123def456`);
  });

  test('honours a custom viewer URL', async () => {
    const gist = await createSessionGist({ token: 't', content: 'x' }, 'https://example.com/v/');
    expect(gist.shareUrl).toBe('https://example.com/v/#abc123def456');
  });

  test('honours a custom filename, description, public flag, and API URL', async () => {
    await createSessionGist({
      token: 't',
      content: 'data',
      filename: 'session.jsonl',
      description: 'custom',
      public: true,
      apiUrl: 'https://ghe.example.com/api/v3/gists',
    });

    const calls = (globalThis.fetch as any).mock.calls;
    const [requestUrl, init] = calls[0];
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer t' });
    const body = JSON.parse(init?.body as string);
    expect(body.description).toBe('custom');
    expect(body.public).toBe(true);
    expect(body.files['session.jsonl'].content).toBe('data');
    expect(requestUrl).toBe('https://ghe.example.com/api/v3/gists');
  });

  test('throws with status + body detail on non-2xx', async () => {
    globalThis.fetch = mock(async () => ({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => ({}),
      text: async () => '{"message":"validation failed"}',
    })) as unknown as typeof fetch;

    await expect(createSessionGist({ token: 't', content: 'x' })).rejects.toThrow(
      /422 Unprocessable Entity.*validation failed/
    );
  });

  test('passes an AbortSignal to fetch for timeout safety', async () => {
    await createSessionGist({ token: 't', content: 'x' });

    const calls = (globalThis.fetch as any).mock.calls;
    const init = calls[0][1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('throws a timeout error when the request aborts', async () => {
    // Simulate an aborted request (the timeout fires).
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      // Simulate the AbortController firing: reject with an AbortError.
      if (init.signal) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      return { ok: true, status: 201, json: async () => ({}), text: async () => '' } as any;
    }) as unknown as typeof fetch;

    await expect(createSessionGist({ token: 't', content: 'x' })).rejects.toThrow(
      `gist create timed out after ${GIST_CREATE_TIMEOUT_MS}ms`
    );
  });

  test('DEFAULT_SHARE_VIEWER_URL defaults to pi.dev when env var is unset', () => {
    // The env var is not set in the test environment, so the constant
    // should fall back to the pi.dev viewer URL.
    expect(DEFAULT_SHARE_VIEWER_URL).toBe('https://pi.dev/session/');
  });

  test('respects PI_SHARE_VIEWER_URL env var override via dynamic import', async () => {
    const original = process.env.PI_SHARE_VIEWER_URL;
    process.env.PI_SHARE_VIEWER_URL = 'https://viewer.example.com/s/';
    try {
      // Use a unique query string to force a fresh module evaluation so
      // the module-level constant is re-evaluated with the env var set.
      const mod = await import(`../../src/share/gist?env_test=${Date.now()}`);
      expect(mod.DEFAULT_SHARE_VIEWER_URL).toBe('https://viewer.example.com/s/');
    } finally {
      if (original === undefined) {
        delete process.env.PI_SHARE_VIEWER_URL;
      } else {
        process.env.PI_SHARE_VIEWER_URL = original;
      }
    }
  });

  test('throws when the 2xx response lacks id/html_url (malformed)', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: 'unexpected proxy response' }),
      text: async () => '',
    })) as unknown as typeof fetch;

    await expect(createSessionGist({ token: 't', content: 'x' })).rejects.toThrow(
      /unexpected response.*no id\/html_url/
    );
  });
});

describe('resolveShareViewerUrl', () => {
  const original = process.env.PI_SHARE_VIEWER_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PI_SHARE_VIEWER_URL;
    } else {
      process.env.PI_SHARE_VIEWER_URL = original;
    }
  });

  test('returns the pi.dev default when the env var is unset', () => {
    delete process.env.PI_SHARE_VIEWER_URL;
    expect(resolveShareViewerUrl()).toBe(PI_DEV_VIEWER_URL);
  });

  test('returns the pi.dev default when the env var is empty', () => {
    // An empty-string env var must fall through (a "" viewer URL would
    // produce broken share links) — same intent as DEFAULT_SHARE_VIEWER_URL.
    process.env.PI_SHARE_VIEWER_URL = '';
    expect(resolveShareViewerUrl()).toBe(PI_DEV_VIEWER_URL);
  });

  test('honours a custom viewer URL from the env var at call time', () => {
    process.env.PI_SHARE_VIEWER_URL = 'https://gistviewer.l3x.in/';
    expect(resolveShareViewerUrl()).toBe('https://gistviewer.l3x.in/');
  });
});

describe('githubGistProvider', () => {
  const originalViewer = process.env.PI_SHARE_VIEWER_URL;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        id: 'abc123def456',
        html_url: 'https://gist.github.com/bot/abc123def456',
        files: { 'session.html': { raw_url: 'r' } },
      }),
      text: async () => '',
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalViewer === undefined) {
      delete process.env.PI_SHARE_VIEWER_URL;
    } else {
      process.env.PI_SHARE_VIEWER_URL = originalViewer;
    }
  });

  test('resolves the viewer URL at call time (parity with opengist)', async () => {
    // The provider routes through resolveShareViewerUrl() rather than the
    // module-load-cached constant, so a runtime env-var change is picked up.
    process.env.PI_SHARE_VIEWER_URL = 'https://gistviewer.l3x.in/';
    const gist = await githubGistProvider.create({ token: 't', content: 'x' });
    expect(gist.shareUrl).toBe('https://gistviewer.l3x.in/#abc123def456');
  });

  test('falls back to the pi.dev default when the env var is unset', async () => {
    delete process.env.PI_SHARE_VIEWER_URL;
    const gist = await githubGistProvider.create({ token: 't', content: 'x' });
    expect(gist.shareUrl).toBe(`${PI_DEV_VIEWER_URL}#abc123def456`);
  });
});

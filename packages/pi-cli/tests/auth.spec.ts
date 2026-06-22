/**
 * @file Tests for {@link packages/pi-cli/src/auth.ts}.
 *
 * Covers:
 *   - GitHub token resolution order (GITHUB_TOKEN takes precedence over GH_TOKEN).
 *   - Provider token resolution via the provider→env table.
 *   - Error messages for missing tokens (must name the exact env var to set).
 */

import { describe, it, expect } from 'bun:test';
import { PROVIDER_ENV_VARS, resolveProviderToken } from '../src/auth.js';
import { resolveGitHubToken } from '@alexanderfortin/pi-platform-github';

describe('resolveGitHubToken (re-exported from pi-platform-github)', () => {
  // Smoke-test that the CLI's auth barrel re-exports the canonical resolver.
  // Full coverage lives in packages/pi-platform-github/tests/auth.spec.ts.
  it('prefers GITHUB_TOKEN over GH_TOKEN', () => {
    expect(resolveGitHubToken({ GITHUB_TOKEN: 'primary', GH_TOKEN: 'secondary' })).toBe('primary');
  });
});

describe('resolveProviderToken', () => {
  it('resolves anthropic via ANTHROPIC_API_KEY', () => {
    const token = resolveProviderToken('anthropic', { ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(token).toBe('sk-ant-x');
  });

  it('resolves openai via OPENAI_API_KEY', () => {
    const token = resolveProviderToken('openai', { OPENAI_API_KEY: 'sk-x' });
    expect(token).toBe('sk-x');
  });

  it('resolves google via GEMINI_API_KEY (not GOOGLE_API_KEY)', () => {
    const token = resolveProviderToken('google', { GEMINI_API_KEY: 'gem-x' });
    expect(token).toBe('gem-x');
  });

  it('resolves huggingface via HF_TOKEN (not HF_API_KEY)', () => {
    const token = resolveProviderToken('huggingface', { HF_TOKEN: 'hf_x' });
    expect(token).toBe('hf_x');
  });

  it('throws naming the exact env var to set when missing', () => {
    expect(() => resolveProviderToken('anthropic', {})).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => resolveProviderToken('anthropic', {})).toThrow(/anthropic/);
  });

  it('throws on empty-string env value', () => {
    expect(() => resolveProviderToken('anthropic', { ANTHROPIC_API_KEY: '' })).toThrow(
      /ANTHROPIC_API_KEY/
    );
  });

  it('throws on whitespace-only env value', () => {
    expect(() => resolveProviderToken('anthropic', { ANTHROPIC_API_KEY: '   ' })).toThrow(
      /ANTHROPIC_API_KEY/
    );
  });

  it('throws for unknown provider id with a docs link', () => {
    expect(() => resolveProviderToken('not-a-real-provider', {})).toThrow(
      /Unknown provider 'not-a-real-provider'/
    );
    expect(() => resolveProviderToken('not-a-real-provider', {})).toThrow(/docs\.pi\.dev/);
  });

  it('PROVIDER_ENV_VARS covers the providers documented in pi docs/providers.md', () => {
    // Sanity-check the table has the entries we explicitly tested above.
    // If a provider is renamed upstream, this test will catch it.
    expect(PROVIDER_ENV_VARS.anthropic).toBe('ANTHROPIC_API_KEY');
    expect(PROVIDER_ENV_VARS.openai).toBe('OPENAI_API_KEY');
    expect(PROVIDER_ENV_VARS.google).toBe('GEMINI_API_KEY');
    expect(PROVIDER_ENV_VARS.zai).toBe('ZAI_API_KEY');
    expect(PROVIDER_ENV_VARS.huggingface).toBe('HF_TOKEN');
    expect(PROVIDER_ENV_VARS.deepseek).toBe('DEEPSEEK_API_KEY');
    expect(PROVIDER_ENV_VARS.groq).toBe('GROQ_API_KEY');
  });
});

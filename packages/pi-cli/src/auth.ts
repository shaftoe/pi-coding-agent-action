/**
 * @file Authentication resolution for the CLI.
 *
 * Two distinct tokens are required:
 *
 * 1. **GitHub token** — used by the platform provider to talk to the
 *    GitHub/Codeberg/Forgejo REST API (reactions, comments, PRs, etc).
 *    Resolved from `GITHUB_TOKEN` then `GH_TOKEN`.
 *
 * 2. **LLM provider API token** — used by the Pi SDK to call the chosen
 *    LLM provider. Resolved from a provider-specific environment variable
 *    (e.g. `ANTHROPIC_API_KEY` for `--provider anthropic`).
 *
 * The GitHub token resolver lives in `@alexanderfortin/pi-platform-github`
 * (shared with the `pi-action-bridge` extension) and is re-exported here so
 * the CLI's auth surface stays in one module. Provider-token resolution is
 * CLI-only and stays below.
 *
 * Both are env-var-only by design: no `--token` flags, no `gh auth token`
 * fallback, no keychain reads.
 */

// Canonical implementation lives in pi-platform-github; re-exported so the
// CLI keeps a single auth import site (`../auth.js`).
export { resolveGitHubToken } from '@alexanderfortin/pi-platform-github';

/**
 * Map a `--provider` id to the canonical environment variable name that
 * holds its API key. Source of truth: pi SDK's
 * `docs/providers.md` → "Authentication" table.
 *
 * Kept as a flat record so unknown providers fail with a clear error in
 * {@link resolveProviderToken} instead of silently returning `undefined`.
 */
export const PROVIDER_ENV_VARS: Readonly<Record<string, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  'ant-ling': 'ANT_LING_API_KEY',
  'azure-openai-responses': 'AZURE_OPENAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  nvidia: 'NVIDIA_API_KEY',
  google: 'GEMINI_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  groq: 'GROQ_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  'cloudflare-ai-gateway': 'CLOUDFLARE_API_KEY',
  'cloudflare-workers-ai': 'CLOUDFLARE_API_KEY',
  xai: 'XAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
  zai: 'ZAI_API_KEY',
  'zai-coding-cn': 'ZAI_CODING_CN_API_KEY',
  opencode: 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  huggingface: 'HF_TOKEN',
  fireworks: 'FIREWORKS_API_KEY',
  together: 'TOGETHER_API_KEY',
  'kimi-coding': 'KIMI_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  'minimax-cn': 'MINIMAX_CN_API_KEY',
  xiaomi: 'XIAOMI_API_KEY',
  'xiaomi-token-plan-cn': 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
};

/**
 * Resolve the LLM provider API token for the given provider id.
 *
 * Returns the token string when found. Throws a descriptive error naming the
 * exact env var the user needs to set, so failure messages are actionable.
 *
 * Unknown providers throw a separate error suggesting the user check
 * `pi docs/providers.md`.
 */
export function resolveProviderToken(
  provider: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const envVar = PROVIDER_ENV_VARS[provider];
  if (!envVar) {
    throw new Error(
      `Unknown provider '${provider}'. ` +
        `Check the supported list at https://docs.pi.dev/providers.`
    );
  }
  const value = env[envVar];
  if (value && value.trim() !== '') {
    return value;
  }
  throw new Error(
    `Missing API token for provider '${provider}'. ` +
      `Set ${envVar} in your environment and retry.`
  );
}

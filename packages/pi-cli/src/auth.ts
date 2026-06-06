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
 * Both are env-var-only by design: no `--token` flags, no `gh auth token`
 * fallback, no keychain reads. See RFC §6 (cli-frontend.md).
 */

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
 * Resolve the GitHub API token from the environment.
 *
 * Resolution order (first match wins):
 *   1. `GITHUB_TOKEN`
 *   2. `GH_TOKEN`
 *
 * Throws a descriptive error when neither is set.
 */
export function resolveGitHubToken(env: NodeJS.ProcessEnv = process.env): string {
  const gh = env.GITHUB_TOKEN;
  if (gh && gh.trim() !== '') {
    return gh;
  }
  const ghShort = env.GH_TOKEN;
  if (ghShort && ghShort.trim() !== '') {
    return ghShort;
  }
  throw new Error(
    'Missing GitHub token. Set GITHUB_TOKEN (or GH_TOKEN) in your environment and retry.'
  );
}

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

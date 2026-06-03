/**
 * Test fixture: registers a custom LLM provider from environment variables.
 *
 * Used by the E2E custom-provider test to verify that extension-loaded
 * providers work end-to-end (extension loads → provider registers → model
 * found → LLM call succeeds).
 *
 * The provider name is prefixed with "e2e-custom-" so it can NEVER collide
 * with a built-in provider.  This guarantees that the only way the test can
 * find the model is if this extension actually loaded and registered it.
 *
 * Required env vars:
 *   E2E_PROVIDER_CUSTOM  – base provider name (e.g. "openrouter")
 *                           The extension registers as "e2e-custom-<name>"
 *   E2E_MODEL_CUSTOM     – model id (e.g. "liquid/lfm-2.5-1.2b-instruct:free")
 *
 * Optional env vars:
 *   E2E_BASEURL_CUSTOM   – base URL (default: "https://openrouter.ai/api/v1")
 *   E2E_API_CUSTOM       – API type (default: "openai-completions")
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export default function (pi: ExtensionAPI) {
  const provider = process.env.E2E_PROVIDER_CUSTOM;
  const modelId = process.env.E2E_MODEL_CUSTOM;
  const baseUrl = process.env.E2E_BASEURL_CUSTOM ?? 'https://openrouter.ai/api/v1';
  const api = process.env.E2E_API_CUSTOM ?? 'openai-completions';

  if (!provider || !modelId) {
    throw new Error(
      'custom-provider test extension: E2E_PROVIDER_CUSTOM and E2E_MODEL_CUSTOM env vars are required'
    );
  }

  // Prefix the provider name so it can never match a built-in provider.
  // The test constructs the same prefixed name and uses it when creating
  // the Agent, so the only way the model can be found is via this extension.
  const prefixedName = `e2e-custom-${provider}`;

  pi.registerProvider(prefixedName, {
    baseUrl,
    api,
    // The Agent constructor sets authStorage for the provider name, which
    // the SDK uses to obtain the API key at request time.  The apiKey field
    // here satisfies the SDK's provider-config validation which requires
    // apiKey or oauth when models are defined.  The "$"-prefix tells the
    // SDK to read the value from the named env var.
    apiKey: '$E2E_TOKEN_CUSTOM',
    models: [
      {
        id: modelId,
        name: `E2E Custom Test (${modelId})`,
        reasoning: false,
        input: ['text' as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  });
}

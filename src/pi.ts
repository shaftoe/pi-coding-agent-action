import * as core from '@actions/core';
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type CreateAgentSessionOptions,
} from '@mariozechner/pi-coding-agent';
import { parseEnvVars } from './utils.js';
import { PI_TIMEOUT_MS } from './constants.js';

// ── Run Pi Agent ───────────────────────────────────────────
/**
 * Runs the pi agent with the given prompt using the SDK.
 * @param prompt - The prompt to send to pi
 * @returns The response from pi
 * @throws Error if pi exits with non-zero status
 */
export async function runPi(prompt: string): Promise<string> {
  const provider = core.getInput('provider') || 'anthropic';
  const modelInput = core.getInput('model') || 'claude-sonnet-4-5';
  const customSystemPrompt = core.getInput('prompt') || '';
  const envVarsString = core.getInput('env_vars') || '';
  const envVars = parseEnvVars(envVarsString);

  core.info(`Using provider: ${provider}, model: ${modelInput}`);

  // Set up auth storage and model registry
  const authStorage = AuthStorage.create();

  // Inject custom environment variables
  for (const { key, value } of envVars) {
    core.info(`Setting env var: ${key}=***`);
    process.env[key] = value;
  }

  // Apply runtime API key override if available in environment
  for (const providerName of ['anthropic', 'openai', 'google']) {
    const envKey = `${providerName.toUpperCase()}_API_KEY`;
    if (process.env[envKey]) {
      authStorage.setRuntimeApiKey(providerName, process.env[envKey]);
    }
  }

  const modelRegistry = new ModelRegistry(authStorage);

  // Get available models
  const availableModels = modelRegistry.getAvailable();
  core.info(`Available models: ${availableModels.length}`);

  // Find the requested model or use the first available
  let model = availableModels.find(m => m.id === modelInput);
  if (!model) {
    core.warning(
      `Model ${modelInput} not found or no API key configured. Using first available model.`
    );
    model = availableModels[0];
    if (!model) {
      throw new Error('No models available. Please configure an API key.');
    }
  }
  core.info(`Using model: ${model.id}`);

  // Set up in-memory settings
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  // Build system prompt
  let systemPrompt = 'You are a helpful coding assistant.';
  if (customSystemPrompt) {
    systemPrompt = customSystemPrompt;
  }

  // Create resource loader with custom system prompt
  const resourceLoader = new DefaultResourceLoader({
    settingsManager,
    systemPromptOverride: () => systemPrompt,
  });
  await resourceLoader.reload();

  // Create the agent session
  const options: CreateAgentSessionOptions = {
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    model,
    settingsManager,
    resourceLoader,
  };

  const { session } = await createAgentSession(options);

  // Collect the response
  let response = '';
  let isComplete = false;

  // Subscribe to events to collect the output
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      response += event.assistantMessageEvent.delta;
    } else if (event.type === 'agent_end') {
      isComplete = true;
    }
  });

  // Send the prompt with timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      unsubscribe();
      void session.abort();
      reject(new Error(`pi agent timed out after ${PI_TIMEOUT_MS}ms`));
    }, PI_TIMEOUT_MS);
  });

  try {
    await Promise.race([session.prompt(prompt), timeoutPromise]);

    // Wait a bit for the final events to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Make sure we have the complete response
    if (!isComplete) {
      core.warning('Agent may not have finished processing');
    }

    unsubscribe();
  } catch (err) {
    unsubscribe();
    throw err;
  }

  return response.trim();
}

// ── Summarize ─────────────────────────────────────────────
/**
 * Summarizes text for use as a git commit message.
 * Uses a simple heuristic (first line, truncated to 50 chars) to avoid expensive AI calls.
 * Falls back to AI only for very long/complex responses.
 * @param text - The text to summarize
 * @param issueNumber - The issue number (used for fallback message)
 * @returns A short summary suitable for a git commit message
 */
export async function summarize(text: string, issueNumber: number): Promise<string> {
  // Simple heuristic: use first line, truncated to 50 characters
  const firstLine = text.split('\n')[0].trim();

  // If first line is short enough and not too generic, use it directly
  if (firstLine.length > 0 && firstLine.length <= 50) {
    const genericPatterns = /^(I|I'll|Sure|OK|Great|Here|The|This|A)/;
    if (!genericPatterns.test(firstLine)) {
      return firstLine;
    }
  }

  // For longer or more complex responses, use AI to generate summary
  const summaryPrompt = `Summarize the following in less than 40 characters, suitable for a git commit message:\n\n${text}`;
  try {
    return await runPi(summaryPrompt);
  } catch {
    return `Fix issue #${issueNumber}`;
  }
}

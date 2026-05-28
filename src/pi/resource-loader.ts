/**
 * @file Resource loader configuration for the Pi agent.
 *
 * Creates and configures the resource loader used by the agent session.
 *
 * Registers custom extension factories (tool definitions) and overrides the
 * default system prompt with the one tailored for GitHub Actions usage.
 *
 * Also appends AGENTS.md content to the system prompt to provide project context.
 */

import {
  DefaultPackageManager,
  DefaultResourceLoader,
  getAgentDir,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { SYSTEM_PROMPT } from './prompt';
import { createLoggingFactory } from './logging';
import type { ExtensionLoadingInfo } from './logging';
import { createToolsFactory } from './tools/index';
import type { CoreAdapter, PiConfig } from '../types';
import type { PlatformProvider } from '../platform';

/**
 * Result of resolving extension sources.
 */
interface ExtensionResolutionResult {
  /** Paths of successfully resolved and enabled extensions. */
  paths: string[];
  /** Information about the extension loading process. */
  info: ExtensionLoadingInfo;
}

/**
 * Resolve extension sources to their filesystem paths.
 *
 * @param extensions - Optional array of extension sources (npm packages, git repos, or local paths).
 * @returns A promise resolving to the extension paths and loading info.
 */
export async function resolveExtensions(extensions?: string[]): Promise<ExtensionResolutionResult> {
  const paths: string[] = [];
  const info: ExtensionLoadingInfo = {
    requested: extensions ?? [],
    loaded: [],
    warnings: [],
  };

  if (!extensions?.length) {
    return { paths, info };
  }

  const settingsManager = SettingsManager.inMemory();
  const pkgManager = new DefaultPackageManager({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    settingsManager,
  });

  const resolved = await pkgManager.resolveExtensionSources(extensions, {
    local: true,
    temporary: true,
  });

  for (const ext of resolved.extensions) {
    if (ext.enabled) {
      info.loaded.push(ext.path);
      paths.push(ext.path);
    }
  }

  if (resolved.extensions.length === 0 && extensions.length > 0) {
    info.warnings.push(`No extensions resolved from: ${extensions.join(', ')}`);
  }

  return { paths, info };
}

/**
 * Create an extension factory that filters the active tool set based on
 * `config.loadedTools`.
 *
 * When `loadedTools` is `undefined`, no filtering is performed.
 * Otherwise the list is validated against the tools that are actually available
 * after all extensions have been loaded. Unknown tool names cause an early
 * error that fails the run.
 *
 * @param config - The configuration containing the `loadedTools` setting.
 * @param core   - CoreAdapter for logging.
 * @returns An extension factory that registers a `session_start` handler.
 */
export function createToolFilterFactory(config: Partial<PiConfig>, core: CoreAdapter) {
  return (pi: import('@earendil-works/pi-coding-agent').ExtensionAPI): void => {
    const loadedTools = config.loadedTools;

    // No filtering needed when all tools should be loaded
    if (!loadedTools) {
      return;
    }

    pi.on('session_start', () => {
      const availableTools = pi.getAllTools().map(t => t.name);
      const availableSet = new Set(availableTools);

      // Find unknown tool names
      const unknown = loadedTools.filter(name => !availableSet.has(name));

      if (unknown.length > 0) {
        const message =
          `loaded_tools: unknown tool name(s): ${unknown.join(', ')}. ` +
          `Available tools: ${availableTools.sort().join(', ')}`;
        core.info(`[loaded_tools] ❌ ${message}`);
        throw new Error(message);
      }

      // Log the filtering
      const removed = availableTools.filter(name => !loadedTools.includes(name));
      if (removed.length > 0) {
        core.info(
          `[loaded_tools] Keeping ${loadedTools.length} tool(s): ${loadedTools.join(', ')}\n` +
            `[loaded_tools] Removing ${removed.length} tool(s): ${removed.sort().join(', ')}`
        );
      }

      pi.setActiveTools(loadedTools);
    });
  };
}

/**
 * Create and configure the resource loader used by the agent session.
 *
 * Accepts a Pi config object but only uses the fields the loader needs:
 * extensions, loadBuiltinExtensions, loadedTools, and diff limits.
 * Other config fields (provider, model, token, etc.) are ignored.
 *
 * @param core     - The CoreAdapter to use for logging within the Pi agent.
 * @param provider - The platform provider for custom tool operations.
 * @param config   - Partial Pi config; only `extensions`, `loadBuiltinExtensions`,
 *                   `loadedTools`, and diff-limit fields are used.
 * @returns A fully loaded {@link DefaultResourceLoader} instance.
 */
export async function getResourceLoader(
  core: CoreAdapter,
  provider: PlatformProvider,
  config?: Partial<PiConfig>
): Promise<DefaultResourceLoader> {
  const extensions = config?.extensions;
  const loadBuiltinExtensions = config?.loadBuiltinExtensions ?? true;

  const { paths: additionalExtensionPaths, info: extensionInfo } =
    await resolveExtensions(extensions);

  const extensionFactories = [createLoggingFactory(core, extensionInfo)];
  if (loadBuiltinExtensions) {
    extensionFactories.unshift(createToolsFactory(provider, config));
  }

  // Add tool filter when loadedTools is configured
  if (config?.loadedTools) {
    extensionFactories.push(createToolFilterFactory(config, core));
  }

  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: getAgentDir(),
    extensionFactories,
    additionalExtensionPaths,
    systemPromptOverride: () => SYSTEM_PROMPT,
    appendSystemPromptOverride: agentsFiles => {
      if (agentsFiles.length === 0) {
        return [];
      }
      return agentsFiles;
    },
    // Disable theme loading in headless/non-interactive environments
    // (GitHub Actions CI and test environments don't need UI themes)
    noThemes: true,
  });
  await loader.reload();
  return loader;
}

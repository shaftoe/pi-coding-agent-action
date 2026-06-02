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
import type { Logger, ResourceLoaderConfig } from '../types';
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
 * @param cwd        - Working directory. Defaults to `process.cwd()`.
 * @returns A promise resolving to the extension paths and loading info.
 */
export async function resolveExtensions(
  extensions?: string[],
  cwd?: string
): Promise<ExtensionResolutionResult> {
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
  const resolvedCwd = cwd ?? process.cwd();
  const pkgManager = new DefaultPackageManager({
    cwd: resolvedCwd,
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
 * Create and configure the resource loader used by the agent session.
 *
 * @param logger  - The Logger to use for logging within the Pi agent.
 * @param provider - The platform provider for custom tool operations.
 * @param config   - Optional resource loader config (extensions, builtin toggle,
 *                   diff limits, system prompt override).
 * @returns A fully loaded {@link DefaultResourceLoader} instance.
 */
export async function getResourceLoader(
  logger: Logger,
  provider: PlatformProvider,
  config?: ResourceLoaderConfig
): Promise<DefaultResourceLoader> {
  const extensions = config?.extensions;
  const loadBuiltinExtensions = config?.loadBuiltinExtensions ?? true;

  const { paths: additionalExtensionPaths, info: extensionInfo } = await resolveExtensions(
    extensions,
    config?.cwd
  );

  const extensionFactories = [createLoggingFactory(logger, extensionInfo)];
  if (loadBuiltinExtensions) {
    extensionFactories.unshift(createToolsFactory(provider, config));
  }

  const cwd = config?.cwd ?? process.cwd();

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    extensionFactories,
    additionalExtensionPaths,
    systemPromptOverride: () => config?.systemPrompt ?? SYSTEM_PROMPT,
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

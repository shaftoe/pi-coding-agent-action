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
import type { LoadExtensionsResult } from '@earendil-works/pi-coding-agent';
import { getSystemPrompt } from './prompt';
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
 * Reconcile the pre-load extension list with the SDK's final load result.
 *
 * Before the SDK reloads, `info.loaded` contains every enabled resolved source,
 * so it can include paths whose imports later fail and duplicate paths when
 * multiple sources resolve to the same extension. After reload, `extensions`
 * is the source of truth: import failures are absent, while extensions with
 * conflict diagnostics are still present. The banner reports loaded extensions,
 * not requested sources, so each successfully loaded path is shown once.
 */
export function updateLoadedExtensions(
  info: ExtensionLoadingInfo,
  extensions: readonly { path: string }[]
): void {
  const loadedPaths = new Set(extensions.map(extension => extension.path));
  info.loaded = [...new Set(info.loaded.filter(path => loadedPaths.has(path)))];
}

/**
 * Resolve extension sources to their filesystem paths.
 *
 * @param extensions - Optional array of extension sources (npm packages, git repos, or local paths).
 * @param cwd        - Working directory. Defaults to `process.cwd()`.
 * @returns A promise resolving to the extension paths and loading info.
 */
// fallow-ignore-next-line complexity
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
 * Build the resource loader options (without creating or reloading the loader).
 *
 * Useful when the caller needs the options to pass to
 * `createAgentSessionServices()` instead of creating the loader directly.
 *
 * @param logger   - The Logger to use for logging within the Pi agent.
 * @param provider - The platform provider for custom tool operations.
 * @param config   - Optional resource loader config (extensions, builtin toggle,
 *                   diff limits, system prompt override).
 * @returns A promise resolving to the options for `DefaultResourceLoader`
 *          (minus `cwd`, `agentDir`, and `settingsManager` which are supplied
 *          by `createAgentSessionServices`).
 */
// fallow-ignore-next-line complexity
export async function buildResourceLoaderOptions(
  logger: Logger,
  provider: PlatformProvider,
  config?: ResourceLoaderConfig
) {
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

  return {
    extensionFactories,
    additionalExtensionPaths,
    extensionsOverride: (result: LoadExtensionsResult): LoadExtensionsResult => {
      updateLoadedExtensions(extensionInfo, result.extensions);
      return result;
    },
    systemPromptOverride: () => config?.systemPrompt ?? getSystemPrompt(provider.type),
    appendSystemPromptOverride: (agentsFiles: string[]) => {
      if (agentsFiles.length === 0) {
        return [];
      }
      return agentsFiles;
    },
    // Disable theme loading in headless/non-interactive environments
    // (GitHub Actions CI and test environments don't need UI themes)
    noThemes: true,
  };
}

/**
 * Create and configure the resource loader used by the agent session.
 *
 * @param logger   - The Logger to use for logging within the Pi agent.
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
  const options = await buildResourceLoaderOptions(logger, provider, config);
  const cwd = config?.cwd ?? process.cwd();

  const loader = new DefaultResourceLoader({
    ...options,
    cwd,
    agentDir: getAgentDir(),
  });
  await loader.reload();
  return loader;
}

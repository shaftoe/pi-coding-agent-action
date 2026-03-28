/**
 * @file Polyfill for `import.meta.url` when bundled for CommonJS.
 *
 * The `@mariozechner/pi-coding-agent` package references `import.meta.url` (via
 * `ZW.url`) at the top level. Because the GitHub Action bundle targets
 * CommonJS, we provide a fallback value derived from `__filename` so that the
 * import does not throw at runtime.
 */
export const importMetaUrl = require('url').pathToFileURL(__filename).href;

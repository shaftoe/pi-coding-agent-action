// @mariozechner/pi-coding-agent package uses ZW.url (which is import.meta.url)
// directly at the top level so we need to provide a fallback value for import.meta.url
// in the bundle
export const importMetaUrl = require('url').pathToFileURL(__filename).href;

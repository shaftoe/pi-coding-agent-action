/**
 * CLI script — updates version references in README.md to match the
 * version being released by semantic-release.
 *
 * Called by the @semantic-release/exec plugin during the release process.
 * The next version is read from the `npm_package_version` env var set by
 * semantic-release (via the `--package-manager bun` / `execCwd` option)
 * or can be passed as the first CLI argument.
 *
 * Usage:
 *   bun run scripts/bump-readme-version.ts [version]
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"

const __dirname = dirname(resolve(process.argv[1]!))
const cwd = resolve(__dirname, "..")

const README_FILE = resolve(cwd, "README.md")

function main() {
  // Version comes from the CLI arg or from the env set by semantic-release
  const version = process.argv[2] ?? process.env.npm_package_version

  if (!version) {
    console.error("No version provided. Pass it as an argument or set npm_package_version env var.")
    process.exit(1)
  }

  const readme = readFileSync(README_FILE, "utf-8")

  // Replace the pinned version reference in the "Securing your workflows" section
  // e.g. uses: shaftoe/pi-coding-agent-action@v2.8.0 -> uses: shaftoe/pi-coding-agent-action@v2.9.0
  const updated = readme.replace(
    /(uses:\s*shaftoe\/pi-coding-agent-action@)v\d+\.\d+\.\d+/,
    `$1v${version}`,
  )

  if (updated === readme) {
    console.log("No pinned version reference found to update in README.md")
    return
  }

  writeFileSync(README_FILE, updated, "utf-8")
  console.log(`Updated README.md pinned version reference to v${version}`)
}

main()

#!/usr/bin/env sh
esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node24 \
  --outfile=dist/index.js \
  --format=cjs \
  --minify \
  --define:import.meta.url=importMetaUrl \
  --inject:src/import-meta-url.js

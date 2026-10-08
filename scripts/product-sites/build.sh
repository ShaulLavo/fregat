#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
output=${1:?Usage: build.sh OUTPUT_DIRECTORY}
mkdir "$output"
output=$(cd "$output" && pwd)
cd "$root"
export SITE_ORIGIN=https://shaulavo.dev
bun run build:workspaces
bun run --cwd apps/site site:build
bun run --cwd editor/site build --base /singapore/
cp -R editor/site/dist "$output/singapore"
VITE_BASE_PATH=/singapore/demo/ bun x turbo run build --filter=@singapore-editor/example-app
cp -R editor/examples/app/dist "$output/singapore/demo"
bun run --cwd ghostty-webgpu/site build --base /ghostty-webgpu
cp -R apps/site/dist "$output/fregat"
cp -R ghostty-webgpu/site/dist "$output/ghostty-webgpu"
cp scripts/product-sites/index.html "$output/index.html"

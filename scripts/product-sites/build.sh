#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
output=${1:?Usage: build.sh OUTPUT_DIRECTORY [SITES]}
sites=${2:-fregat,singapore,demo,ghostty-webgpu}
selected() { [[ ",$sites," == *",$1,"* ]]; }
IFS=, read -r -a names <<< "$sites"
for name in "${names[@]}"; do
  case "$name" in fregat|singapore|demo|ghostty-webgpu) ;; *) echo "Unknown site: $name" >&2; exit 2 ;; esac
done
mkdir "$output"
output=$(cd "$output" && pwd)
cd "$root"

targets=()
if selected fregat; then targets+=('"site"'); fi
if selected singapore; then targets+=('"singapore-editor-site"'); fi
if selected demo; then targets+=('"@singapore-editor/example-app"'); fi
if selected ghostty-webgpu; then targets+=('"ghostty-webgpu-site"'); fi
json="[$(IFS=,; echo "${targets[*]}")]"
bun scripts/ci/packages.mjs build "$json"
if selected fregat; then
  SITE_ORIGIN=https://fregat.shaulavo.dev bun run --cwd apps/site site:build
  cp -R apps/site/dist "$output/fregat"
fi
if selected singapore; then
  SITE_ORIGIN=https://singapore.shaulavo.dev bun run --cwd editor/site build --base /
  cp -R editor/site/dist "$output/singapore"
fi
if selected demo; then
  VITE_BASE_PATH=/demo/ bun x turbo run build --filter=@singapore-editor/example-app
  mkdir -p "$output/singapore"
  cp -R editor/examples/app/dist "$output/singapore/demo"
fi
if selected ghostty-webgpu; then
  SITE_ORIGIN=https://ghostty.shaulavo.dev bun run --cwd ghostty-webgpu/site build --base /
  cp -R ghostty-webgpu/site/dist "$output/ghostty-webgpu"
fi
for site in fregat singapore ghostty-webgpu; do
  if [[ -d "$output/$site" ]]; then cp scripts/product-sites/_headers "$output/$site/_headers"; fi
done
cp scripts/product-sites/index.html "$output/index.html"

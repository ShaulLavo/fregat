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
export SITE_ORIGIN=https://shaulavo.dev
targets=()
if selected fregat; then targets+=('"site"'); fi
if selected singapore; then targets+=('"singapore-editor-site"'); fi
if selected demo; then targets+=('"@singapore-editor/example-app"'); fi
if selected ghostty-webgpu; then targets+=('"ghostty-webgpu-site"'); fi
json="[$(IFS=,; echo "${targets[*]}")]"
bun scripts/ci/packages.mjs build "$json"
if selected fregat; then
  bun run --cwd apps/site site:build
  cp -R apps/site/dist "$output/fregat"
fi
if selected singapore; then
  bun run --cwd editor/site build --base /singapore/
  cp -R editor/site/dist "$output/singapore"
fi
if selected demo; then
  VITE_BASE_PATH=/singapore/demo/ bun x turbo run build --filter=@singapore-editor/example-app
  mkdir -p "$output/singapore"
  cp -R editor/examples/app/dist "$output/singapore/demo"
fi
if selected ghostty-webgpu; then
  bun run --cwd ghostty-webgpu/site build --base /ghostty-webgpu
  cp -R ghostty-webgpu/site/dist "$output/ghostty-webgpu"
fi
cp scripts/product-sites/index.html "$output/index.html"

#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
output=${1:?Usage: build.sh OUTPUT_DIRECTORY [fregat]}
sites=${2:-fregat}
if [[ "$sites" != fregat ]]; then echo "Unknown site: $sites" >&2; exit 2; fi
mkdir "$output"
output=$(cd "$output" && pwd)
cd "$root"

json='["site"]'
case "${3:-}" in
  '') bun scripts/ci/packages.mjs build "$json" ;;
  --reuse-workspace-builds) bun scripts/ci/build-reuse.mjs verify-site "$json" ;;
  *) echo "Unknown prerequisite mode" >&2; exit 2 ;;
esac
SITE_ORIGIN=https://fregat.shaulavo.dev bun run --cwd apps/site site:build
cp -R apps/site/dist "$output/fregat"
cp scripts/product-sites/_headers "$output/fregat/_headers"

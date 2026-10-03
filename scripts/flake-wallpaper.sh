#!/usr/bin/env bash
# Run through the heavy-job wrapper. Usage: bash scripts/flake-wallpaper.sh [evidence-dir] [runs]
set -u

if ! command -v taskset > /dev/null; then
  printf 'Skipped bounded CPU-load reproduction: taskset is unavailable.\n'
  exit 0
fi

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
evidence=${1:-$(mktemp -d "${TMPDIR:-/tmp}/wallpaper-flake-XXXXXX")}
runs=${2:-30}
mkdir -p "$evidence"
evidence=$(cd "$evidence" && pwd)
cpu=$(taskset -pc $$ | sed 's/.*: //' | cut -d, -f1 | cut -d- -f1)

taskset -c "$cpu" yes > /dev/null &
load=$!
trap 'kill "$load"; wait "$load" 2>/dev/null' EXIT

cd "$root/apps/web" || exit 1
reports=()
for ((run = 1; run <= runs; run++)); do
  reports+=("$evidence/$run.json")
  taskset -c "$cpu" bun --bun vitest run --project node \
    src/features/settings/tests/wallpaper-catalog.test.ts --retry=0 \
    --reporter=verbose --reporter=json --outputFile.json="$evidence/$run.json" \
    > "$evidence/$run.log" 2>&1
  printf 'Run %s/%s exited %s.\n' "$run" "$runs" "$?"
done

printf 'Evidence: %s\n' "$evidence"
bun "$root/scripts/flake-summary.ts" 'Wallpaper catalog under bounded CPU load' "${reports[@]}"

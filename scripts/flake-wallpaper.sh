#!/usr/bin/env bash
# Run through the heavy-job wrapper. Usage: bash scripts/flake-wallpaper.sh [evidence-dir] [runs]
set -u

if ! command -v taskset > /dev/null; then
  printf 'Skipped bounded CPU-load reproduction: taskset is unavailable.\n'
  exit 0
fi

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if (( $# > 0 )); then
  evidence=$1
  mkdir "$evidence" || exit 1
else
  evidence=$(mktemp -d "${TMPDIR:-/tmp}/wallpaper-flake-XXXXXX") || exit 1
fi
runs=${2:-30}
evidence=$(cd "$evidence" && pwd) || exit 1
cpu=$(taskset -pc $$ | sed 's/.*: //' | cut -d, -f1 | cut -d- -f1)

taskset -c "$cpu" yes > /dev/null &
load=$!
trap 'kill "$load"; wait "$load" 2>/dev/null' EXIT

cd "$root/apps/web" || exit 1
reports=()
failure=0
for ((run = 1; run <= runs; run++)); do
  reports+=("$evidence/$run.json")
  taskset -c "$cpu" bun --bun vitest run --project node \
    src/features/settings/tests/wallpaper-catalog.test.ts --retry=0 \
    --reporter=verbose --reporter=json --outputFile.json="$evidence/$run.json" \
    > "$evidence/$run.log" 2>&1
  status=$?
  printf 'Run %s/%s exited %s.\n' "$run" "$runs" "$status"
  if (( status != 0 )); then failure=$status; fi
done

printf 'Evidence: %s\n' "$evidence"
bun "$root/scripts/flake-summary.ts" 'Wallpaper catalog under bounded CPU load' "${reports[@]}"
status=$?
if (( failure != 0 )); then exit "$failure"; fi
exit "$status"

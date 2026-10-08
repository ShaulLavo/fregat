#!/usr/bin/env bash
set -euo pipefail

if [[ $(uname -s) != Linux ]] || ! command -v taskset >/dev/null; then
  echo 'SKIP: CPU-contention reproduction requires Linux and taskset.'
  exit 0
fi

count=${1:-10}
if [[ ! $count =~ ^[1-9][0-9]*$ ]]; then
  echo 'Expected a positive iteration count.' >&2
  exit 2
fi
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
output=${2:-$(mktemp -d "${TMPDIR:-/tmp}/file-sync-remount-XXXXXX")}
mkdir -p "$output"
output=$(cd "$output" && pwd)
cpu=$(awk '/Cpus_allowed_list/{split($2,a,"[-,]");print a[1]}' /proc/self/status)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
bun_version=$(bun --version)
node_version=$(node --version)
printf 'CPU %s; three contending Node processes; Bun %s; Node %s\n' \
  "$cpu" "$bun_version" "$node_version"
for _ in 1 2 3; do
  taskset -c "$cpu" node -e 'for (;;) {}' >/dev/null 2>&1 &
  pids+=("$!")
done

cd "$root/apps/web"
printf 'iteration,scope,exit\n' > "$output/results.csv"
failed=0
for ((i=1;i<=count;i++)); do
  args=()
  scope=file
  if ((i%2==1)); then
    args=(-t 'recreates a deleted file.*dirty: false')
    scope=selected
  fi
  code=0
  taskset -c "$cpu" bun --bun vitest run --project node \
    src/features/editor/tests/file-sync-service.test.ts "${args[@]}" \
    --reporter verbose > "$output/$i.log" 2>&1 || code=$?
  printf '%d,%s,%d\n' "$i" "$scope" "$code" | tee -a "$output/results.csv"
  if ((code!=0)); then failed=$((failed+1)); fi
done
printf '%d/%d processes failed; logs in %s\n' "$failed" "$count" "$output"
if ((failed>0)); then exit 1; fi

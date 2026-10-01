#!/usr/bin/env bash
# The lane job's first process, inside its scope in the job's own slice. It caps the slice, so
# bench cases that join it with --slice=$HEAVY_JOB_SLICE share the cap, then records the slice's
# totals before the slice empties and systemd unloads it. Bash: it counts in the peak.
# Usage: job.sh <memory max> <run directory> <command>
set -euo pipefail
memory_max=$1
run=$2
command=$3

slice_dir=/sys/fs/cgroup$(dirname "$(cut -d: -f3- /proc/self/cgroup)")
slice=$(basename "$slice_dir")
systemctl --user set-property --runtime "$slice" "MemoryMax=$memory_max" MemorySwapMax=0

started=$(date +%s%N)
trap : INT TERM HUP
rc=0
bash -c "$command" || rc=$?

number_or_null() { [[ $1 =~ ^[0-9]+$ ]] && printf '%s' "$1" || printf null; }
field() { command grep -m1 "^$2 " "$1" 2>/dev/null | cut -d' ' -f2 || true; }

printf '{"host":"%s","model":"%s","arch":"%s","cpus":%s,"slice":"%s","memoryMax":"%s","exitCode":%s,"wallMs":%s,"memoryPeakBytes":%s,"cpuUsageUsec":%s,"oomKills":%s}\n' \
  "$(hostname)" "$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)" "$(uname -m)" "$(nproc)" \
  "$slice" "$memory_max" "$rc" "$((($(date +%s%N) - started) / 1000000))" \
  "$(number_or_null "$(cat "$slice_dir/memory.peak" 2>/dev/null || true)")" \
  "$(number_or_null "$(field "$slice_dir/cpu.stat" usage_usec)")" \
  "$(number_or_null "$(field "$slice_dir/memory.events" oom_kill)")" >"$run/lane.json"
# --runtime leaves a drop-in under /run until reboot; this slice name is never reused.
systemctl --user revert "$slice" >/dev/null 2>&1 || true
exit "$rc"

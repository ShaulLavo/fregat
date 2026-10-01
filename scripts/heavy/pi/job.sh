#!/usr/bin/env bash
# Runs inside the lane job's scope on the Pi, so its cgroup still exists when the command exits,
# and writes the scope's totals and the host beside the run's output. Bash: it counts in the peak.
run=$1
command=$2
started=$(date +%s%N)
trap : INT TERM HUP
bash -c "$command"
rc=$?
cgroup=/sys/fs/cgroup$(cut -d: -f3- /proc/self/cgroup)
read_or_null() { [ -r "$1" ] && cat "$1" || echo null; }
printf '{"host":"%s","model":"%s","arch":"%s","cpus":%s,"exitCode":%s,"wallMs":%s,"memoryPeakBytes":%s,"cpuUsageUsec":%s,"oomKills":%s}\n' \
  "$(hostname)" "$(tr -d '\0' </proc/device-tree/model 2>/dev/null)" "$(uname -m)" "$(nproc)" "$rc" \
  "$((($(date +%s%N) - started) / 1000000))" "$(read_or_null "$cgroup/memory.peak")" \
  "$(command grep -m1 '^usage_usec ' "$cgroup/cpu.stat" | cut -d' ' -f2)" \
  "$(command grep -m1 '^oom_kill ' "$cgroup/memory.events" | cut -d' ' -f2)" >"$run/lane.json"
exit "$rc"

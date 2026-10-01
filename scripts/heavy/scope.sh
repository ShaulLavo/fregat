#!/usr/bin/env bash
# Runs inside the job's systemd scope, so the cgroup still exists when the command exits and
# its totals can be read. Bash, not Bun: this process is counted in the scope's memory peak.
out=$1
shift
trap : INT TERM HUP
"$@"
rc=$?
cgroup=/sys/fs/cgroup$(cut -d: -f3- /proc/self/cgroup)
{
  printf 'exit %s\n' "$rc"
  printf 'peak %s\n' "$(cat "$cgroup/memory.peak" 2>/dev/null)"
  command grep -m1 '^usage_usec ' "$cgroup/cpu.stat" | sed 's/^usage_usec/cpu/'
  command grep -m1 '^oom_kill ' "$cgroup/memory.events" | sed 's/^oom_kill/oom/'
} >"$out" 2>/dev/null
exit "$rc"

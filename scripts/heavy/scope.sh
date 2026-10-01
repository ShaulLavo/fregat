#!/usr/bin/env bash
# Runs inside the job's systemd scope, so the job's slice still exists when the command exits
# and its totals can be read. Bash, not Bun: this process is counted in the job's memory peak.
out=$1
shift
trap : INT TERM HUP
"$@"
rc=$?
cgroup=/sys/fs/cgroup$(cut -d: -f3- /proc/self/cgroup)
# The job is its slice: this scope and any scope it opened with nested-scope.sh.
drain_root=${cgroup%/*}

# Counts the job's processes other than this shim into `found`, sending each the signal if
# one is given. Builtins only, so the scan itself adds no process to the cgroup.
scan() {
  found=0
  local file pid
  for file in "$drain_root"/cgroup.procs "$drain_root"/*/cgroup.procs; do
    [ -r "$file" ] || continue
    while read -r pid; do
      [ "$pid" = "$$" ] && continue
      found=$((found + 1))
      [ -n "$1" ] && kill "-$1" "$pid" 2>/dev/null
    done <"$file"
  done
}

# Waits up to $1 tenths of a second for the job's other processes to exit.
settle() {
  local tries=0
  scan ''
  while [ "$found" -gt 0 ] && [ "$tries" -lt "$1" ]; do
    sleep 0.1
    tries=$((tries + 1))
    scan ''
  done
}

# What the command left running is stopped before the totals are read: it would otherwise
# keep using the machine after the slot is released, and its usage would go unrecorded.
# TERM gets ten seconds, as a test runner needs to shut its workers down; then KILL.
scan TERM
left=$found
settle 100
if [ "$found" -gt 0 ]; then
  scan KILL
  settle 20
fi

{
  printf 'exit %s\n' "$rc"
  printf 'left %s\n' "$left"
  printf 'peak %s\n' "$(cat "$drain_root/memory.peak" 2>/dev/null)"
  command grep -m1 '^usage_usec ' "$drain_root/cpu.stat" | sed 's/^usage_usec/cpu/'
  command grep -m1 '^oom_kill ' "$drain_root/memory.events" | sed 's/^oom_kill/oom/'
} >"$out" 2>/dev/null
exit "$rc"

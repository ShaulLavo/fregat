#!/usr/bin/env bash
# Keep the scope alive while reading its final cgroup totals.
# Usage: scope.sh <accounting file> <command…>
out=$1
shift
grace=10
mkdir -p /tmp/scope-trace; exec 9>>"/tmp/scope-trace/$(basename "$(dirname "$out")").$$"; BASH_XTRACEFD=9; set -x
date +%s.%N >&9
trap : INT TERM HUP
"$@"
rc=$?
cgroup=/sys/fs/cgroup$(cut -d: -f3- /proc/self/cgroup)
drain_root=$cgroup

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
# keep using the machine after the case ends, and its usage would go unrecorded.
scan TERM
left=$found
settle $((grace * 10))
if [ "$found" -gt 0 ]; then
  scan KILL
  settle 20
fi

date +%s.%N >&9; ls -la "$drain_root" >&9 2>&1; for f in memory.peak memory.current memory.events memory.max cgroup.procs cgroup.events; do echo "== $f" >&9; cat "$drain_root/$f" >&9 2>&1; done; ls -la "$(dirname "$out")" >&9 2>&1
{
  printf 'exit %s\n' "$rc"
  printf 'left %s\n' "$left"
  printf 'peak %s\n' "$(cat "$drain_root/memory.peak" 2>/dev/null)"
  command grep -m1 '^usage_usec ' "$drain_root/cpu.stat" | sed 's/^usage_usec/cpu/'
  command grep -m1 '^oom_kill ' "$drain_root/memory.events" | sed 's/^oom_kill/oom/'
} >"$out" 2>/dev/null
echo "wrote rc=$? out=$out" >&9; ls -la "$out" >&9 2>&1; cat "$out" >&9 2>&1
exit "$rc"

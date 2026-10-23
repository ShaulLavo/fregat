#!/usr/bin/env bash
# Keep the scope alive while reading the command's final cgroup totals.
# Usage: scope.sh <accounting file> <memory max> <command…>
# The command runs alone in a capped child cgroup while this shim waits in an uncapped one.
# Inside the cap, the shim's next fork after an OOM kill can find the cgroup still full of
# the killed command's memory, and the kernel then kills the shim before it writes the totals.
out=$1
max=$2
shift 2
grace=10
trap : INT TERM HUP
while read -r line; do
  [[ $line == 0::* ]] && break
done </proc/self/cgroup
scope=/sys/fs/cgroup${line#0::}
drain_root=$scope/case

# Moves this shim to an uncapped leaf and caps the command's leaf without swap.
cap() {
  mkdir "$scope/shim" "$drain_root" &&
    echo 0 >"$scope/shim/cgroup.procs" &&
    echo +memory >"$scope/cgroup.subtree_control" &&
    echo "$max" >"$drain_root/memory.max" || return
  [ ! -e "$drain_root/memory.swap.max" ] || echo 0 >"$drain_root/memory.swap.max"
}

if ! cap; then
  echo "scope.sh: cannot cap the command at $max in $scope" >&2
  exit 125
fi
(echo 0 >"$drain_root/cgroup.procs" && exec "$@")
rc=$?

# Counts the command's remaining processes into `found`, sending each the signal if one is
# given.
scan() {
  found=0
  local file pid
  for file in "$drain_root"/cgroup.procs "$drain_root"/*/cgroup.procs; do
    [ -r "$file" ] || continue
    while read -r pid; do
      found=$((found + 1))
      [ -n "$1" ] && kill "-$1" "$pid" 2>/dev/null
    done <"$file"
  done
}

# Waits up to $1 tenths of a second for the command's processes to exit.
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

{
  printf 'exit %s\n' "$rc"
  printf 'left %s\n' "$left"
  printf 'peak %s\n' "$(cat "$drain_root/memory.peak" 2>/dev/null)"
  command grep -m1 '^usage_usec ' "$drain_root/cpu.stat" | sed 's/^usage_usec/cpu/'
  command grep -m1 '^oom_kill ' "$drain_root/memory.events" | sed 's/^oom_kill/oom/'
} >"$out" 2>/dev/null
exit "$rc"

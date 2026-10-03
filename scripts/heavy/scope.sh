#!/usr/bin/env bash
# Runs inside a systemd scope, so the cgroup still exists when the command exits and its totals
# can be read. Bash, not Bun: this process is counted in the memory peak.
# Usage: scope.sh [--slice] [--grace <seconds>] [--runtime <seconds>] <accounting file> <command…>
# --slice: the job is the scope's parent slice (this scope and the scopes nested-scope.sh opened
# beside it). Without it the job is this scope alone, as for a bench case inside a job.
# --grace: seconds the job's leftover processes get between TERM and KILL (default 10).
# Slot locks the wrapper hands over on fds 3–5 stay with this shim, which outlives the job's
# processes, and are closed for the command so nothing it starts can keep them.
# The wrapper's job-entry lock arrives on fd 6 and is dropped here, inside the job's slice, before
# anything else runs (the wrapper starts this with `bash -p`): from now on the slice, not the
# launcher, is what shows the job is running.
exec 6<&-
whole_slice=
grace=10
runtime=
while [ "${1:-}" = --slice ] || [ "${1:-}" = --grace ] || [ "${1:-}" = --runtime ]; do
  case "$1" in
    --slice) whole_slice=1; shift; continue ;;
    --grace) grace=$2 ;;
    --runtime) runtime=$2 ;;
  esac
  shift 2
done
out=$1
shift
trap 'exit 125' INT TERM HUP
if [ -n "$runtime" ]; then
  read -r started _ </proc/uptime || exit 125
  deadline=$((10#${started/./} + runtime * 100))
  slice=${HEAVY_JOB_SLICE:?}
  [[ "$slice" =~ ^[a-z0-9]+-[a-z0-9]+\.slice$ ]] || exit 125
  watchdog=${slice%.slice}_deadline.service
  script=$(dirname -- "$0")/deadline.sh
  # Readiness gates execution. Arming inside the scope keeps a delayed launcher from recreating
  # a slice after its watchdog has expired; fd 6 protected that launcher until entry above.
  systemd-run --user --quiet --collect --expand-environment=no --unit="$watchdog" --slice=app.slice \
    -p Type=notify -p NotifyAccess=all -p "TimeoutStartSec=$((grace + 3))s" \
    -p "RuntimeMaxSec=$((runtime + grace))s" -p KillSignal=SIGKILL -p TimeoutStopSec=1s \
    -p "ExecStopPost=/usr/bin/env systemctl --user kill --signal=SIGKILL $slice" \
    bash -p "$script" "$slice" "$runtime" "$grace" 3<&- 4<&- 5<&- || exit 125
  systemctl --user is-active --quiet "$watchdog" || exit 125
  # The service stays active during grace. A late readiness return must also have runtime left,
  # even if TERM was missed; /proc/uptime is monotonic and reports centiseconds.
  read -r now _ </proc/uptime || exit 125
  [ "$((10#${now/./}))" -lt "$deadline" ] || exit 125
fi
trap : INT TERM HUP
"$@" 3<&- 4<&- 5<&-
rc=$?
cgroup=/sys/fs/cgroup$(cut -d: -f3- /proc/self/cgroup)
drain_root=$cgroup
[ -n "$whole_slice" ] && drain_root=${cgroup%/*}

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

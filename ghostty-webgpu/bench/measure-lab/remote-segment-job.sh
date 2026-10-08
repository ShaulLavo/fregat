#!/bin/bash
export PATH=$HOME/.local/share/mise/shims:$PATH
set -u
root=$1
prepared=$2
protocol=$3
job=$4
limit=$5
mkdir "$job/tmp"
export TMPDIR="$job/tmp"
cd "$root" || exit 1
child=0
result=1
reason=launch

cleanup() {
  trap - EXIT TERM INT HUP
  /usr/bin/python3 - "$root" "$job/custody.json" "$$" <<'PY'
import datetime, importlib.util, json, os, pathlib, signal, subprocess, sys, time
root, output, manager = sys.argv[1], pathlib.Path(sys.argv[2]), int(sys.argv[3])
spec = importlib.util.spec_from_file_location('native_reader', root + '/rusage.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def owned():
    rows = []
    excluded = {os.getpid(), manager}
    for line in subprocess.check_output(['/bin/ps', '-axo', 'uid=,pid=,ppid=,command='], text=True).splitlines():
        parts = line.strip().split(None, 3)
        if len(parts) == 4:
            rows.append((int(parts[0]), int(parts[1]), int(parts[2]), parts[3]))
    ids = {pid for uid, pid, ppid, cmd in rows if uid == os.getuid() and root in cmd and pid not in excluded}
    while True:
        more = {pid for uid, pid, ppid, cmd in rows if uid == os.getuid() and ppid in ids and pid not in excluded}
        if more <= ids: break
        ids |= more
    result = []
    for uid, pid, ppid, cmd in rows:
        if pid not in ids: continue
        try:
            identity = reader.read(pid).get('ri_proc_start_abstime')
            if identity is None: continue
        except (ProcessLookupError, OSError):
            continue
        result.append(dict(pid=pid, ppid=ppid, command=cmd, startMachAbsoluteTicks=identity))
    return result
def stop(row, sig):
    try:
        if reader.read(row['pid']).get('ri_proc_start_abstime') != row['startMachAbsoluteTicks']:
            return
        os.kill(row['pid'], sig)
        row['termSentAt' if sig == signal.SIGTERM else 'killSentAt'] = now()
    except (ProcessLookupError, OSError): pass
before = owned()
for row in before: stop(row, signal.SIGTERM)
for _ in range(20):
    if not owned(): break
    time.sleep(.1)
remaining = owned()
for row in remaining: stop(row, signal.SIGKILL)
time.sleep(.1)
remaining = owned()
checked = now()
for row in before:
    row['goneConfirmedAt'] = checked if row['pid'] not in {r['pid'] for r in remaining} else None
output.write_text(json.dumps(dict(before=before, remaining=remaining, clean=not remaining, checkedAt=checked), indent=2) + '\n')
PY
  /usr/bin/python3 - "$job" "$result" "$reason" <<'PY'
import datetime, json, pathlib, sys
job = pathlib.Path(sys.argv[1])
custody = json.loads((job / 'custody.json').read_text()) if (job / 'custody.json').exists() else {'clean': False}
status = dict(exitCode=int(sys.argv[2]), reason=sys.argv[3], custody=custody, finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
(job / 'status.tmp').write_text(json.dumps(status) + '\n')
(job / 'status.tmp').replace(job / 'status.json')
PY
}
trap cleanup EXIT
trap 'result=143; reason=signal; exit "$result"' TERM INT HUP
start=$(date +%s)
printf '%s\n' "$$" > "$job/manager.pid"
printf '%s\n' "$start" > "$job/started-seconds"
/opt/homebrew/bin/node segments.mjs "$prepared" "$protocol" > "$job/run.log" 2>&1 &
child=$!
printf '%s\n' "$child" > "$job/driver.pid"
while kill -0 "$child" 2>/dev/null; do
  now=$(date +%s)
  heartbeat=$(stat -f %m "$job/heartbeat")
  if test -e "$HOME/tmp/ghostty-bench/RECLAIMED" || test -e "$HOME/tmp/ghostty-bench/EXPERIMENT_HOLD"; then
    result=130; reason=owner-marker; exit "$result"
  fi
  if test -e "$job/cancel"; then result=130; reason=controller-cancel; exit "$result"; fi
  if test "$((now - start))" -ge "$limit"; then result=124; reason=deadline; exit "$result"; fi
  if test "$((now - heartbeat))" -gt 30; then result=125; reason=heartbeat-expired; exit "$result"; fi
  sleep 2
done
wait "$child"
result=$?
reason=driver-exit
exit "$result"

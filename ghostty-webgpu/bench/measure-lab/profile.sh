#!/usr/bin/env bash
set -euo pipefail
if test "$#" -lt 3; then
  printf 'Usage: profile.sh ARTIFACTS ARM NEW_OUTPUT [PERF_EXECUTABLE] [EVENT]\n' >&2
  exit 2
fi
artifacts=$(realpath "$1")
arm=$2
output=$(realpath -m "$3")
perf=${4:-perf}
event=${5:-instructions:u}
lab=$(dirname "$(realpath "$0")")
mkdir "$output"
export PERF_BUILDID_DIR="$output/buildid-cache"
export DEBUGINFOD_URLS=
cd "$output"
node_pid=
perf_pid=
cleanup() {
  if test -n "$perf_pid"; then kill -INT "$perf_pid" 2>/dev/null || true; wait "$perf_pid" 2>/dev/null || true; fi
  if test -n "$node_pid"; then kill -TERM "$node_pid" 2>/dev/null || true; wait "$node_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
node --expose-gc --predictable --no-concurrent-recompilation --no-liftoff \
  --no-wasm-tier-up --random-seed=42 --perf-prof --perf-prof-unwinding-info \
  --perf-prof-path="$output" --interpreted-frames-native-stack \
  "$lab/run.mjs" --artifacts "$artifacts" --arms "$arm" --repetitions 1 \
  --ticks 18000 --count 1 --output "$output/samples.jsonl" \
  --ready-file "$output/ready.json" --continue-file "$output/continue" \
  > "$output/node.log" 2>&1 &
node_pid=$!
target_pid=$node_pid
# The node PID remains our waited child throughout acquisition.
python3 - "$output/ready.json" "$node_pid" <<'PY'
import json,pathlib,sys,time
path=pathlib.Path(sys.argv[1]); pid=int(sys.argv[2]); deadline=time.monotonic()+30
while not path.exists():
    assert pathlib.Path(f'/proc/{pid}').exists(), 'owned target exited before warmup'
    assert time.monotonic()<deadline, 'warmup readiness deadline'
    time.sleep(.02)
assert json.loads(path.read_text())['pid']==pid, 'ready target identity'
PY
mkfifo "$output/control.fifo" "$output/ack.fifo"
exec {control}<>"$output/control.fifo"
exec {ack}<>"$output/ack.fifo"
"$perf" record --no-inherit --tid "$node_pid" --event "$event" --count 500000 \
  --call-graph fp --clockid mono --delay=-1 --control="fd:$control,$ack" \
  --output "$output/raw.data" > "$output/perf-record.log" 2>&1 &
perf_pid=$!
printf 'enable\n' >&"$control"
read -r -t 15 response <&"$ack"
test "$response" = ack
printf 'start\n' > "$output/continue"
wait "$node_pid"
node_pid=
kill -INT "$perf_pid" 2>/dev/null || true
record_status=0
wait "$perf_pid" || record_status=$?
perf_pid=
# A controlled SIGINT ends acquisition after the owned target has completed.
if test "$record_status" -ne 0 && test "$record_status" -ne 130; then exit "$record_status"; fi
python3 "$lab/perf-ips.py" "$output/raw.data" --output "$output/ips.jsonl" --receipt "$output/ip-receipt.json"
python3 "$lab/jit-attribution.py" --jit "$output/jit-$target_pid.dump" --events "$output/ips.jsonl" --output "$output/attribution.json"
python3 - "$output" "$target_pid" <<'PY'
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]); ip=json.loads((root/'ip-receipt.json').read_text()); attribution=json.loads((root/'attribution.json').read_text())
assert ip['tids']==[int(sys.argv[2])], 'owned main-thread samples only'
status='COMPLETE' if ip['lostSamples']==0 and ip['throttleRecords']==0 and ip['unthrottleRecords']==0 else 'INCOMPLETE'
(root/'receipt.json').write_text(json.dumps({'status':status,'attribution':'Instruction-event sampling on owned warmed Node main thread; original unambiguous JIT labels, no inherited worker threads','envelope':'Includes attach polling, measured loop, proof and cleanup; excludes application warmup. Attribution replay uses 18000 ticks on one target, so retained history differs from a 900-tick efficiency window. No exact per-function counter or energy claim.','ipReceipt':ip,'attributedSamples':attribution['uniquelyAttributedSamples'],'limits':attribution['limits']},indent=2)+'\n')
print(json.dumps({'status':status,'topLabels':attribution['functions'][:10]}))
sys.exit(0 if status=='COMPLETE' else 1)
PY

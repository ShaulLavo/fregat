#!/usr/bin/env bash
set -euo pipefail
if test "$#" -lt 3; then
  printf 'Usage: compare.sh ARTIFACTS A,B NEW_OUTPUT [WORKLOAD]\n' >&2
  exit 2
fi
artifacts=$(realpath "$1")
arms=$2
if [[ "$arms" != *,* ]]; then printf 'Two comparison arms are required.\n' >&2; exit 2; fi
output=$(realpath -m "$3")
workload=${4:-line-scroll}
lab=$(dirname "$(realpath "$0")")
mkdir "$output"
node --expose-gc --predictable --single-threaded --max-semi-space-size=64 \
  --no-maglev --no-turbofan --no-liftoff --no-wasm-tier-up --random-seed=42 \
  "$lab/run.mjs" --artifacts "$artifacts" --arms "$arms" --reuse-actors true \
  --warm-ticks 5000 --repetitions 6 --ticks 900 --count 1 --workload "$workload" \
  --output "$output/samples.jsonl" > "$output/run.log" 2>&1
python3 "$lab/analyze.py" "$output/samples.jsonl" --output "$output/summary.json" > "$output/analysis.txt"
python3 - "$output/summary.json" <<'PY'
import json,sys
summary=json.load(open(sys.argv[1]))
print(json.dumps({'model':'Baseline-JS WebGL structural work; final Mac acceptance remains separate','gatesPassed':summary['gatesPassed'],'precisionTargetMet':summary['precisionTargetMet'],'comparison':summary.get('comparison')},indent=2))
sys.exit(0 if summary['gatesPassed'] and summary['precisionTargetMet'] else 1)
PY

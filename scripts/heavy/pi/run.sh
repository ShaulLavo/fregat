#!/usr/bin/env bash
# Runs one command on the Pi lane through mesh, inside a memory-capped scope, then copies its run
# directory back here. The command runs from the Pi's checkout (sync it first with sync.sh); its
# arguments are joined and run by bash, as ssh does, with $LANE_RUN naming its output directory.
# Usage: scripts/heavy/pi/run.sh [--host pi] [--dir fregat-lane] [--memory-max 3G] [--evidence DIR] <label> -- <command…>
set -euo pipefail

usage() {
  echo "usage: $0 [--host pi] [--dir fregat-lane] [--memory-max 3G] [--evidence DIR] <label> -- <command…>" >&2
  exit 2
}

host=pi
dir=fregat-lane
memory_max=3G
evidence=
while [ $# -gt 0 ]; do
  case $1 in
    --host) host=$2; shift 2 ;;
    --dir) dir=$2; shift 2 ;;
    --memory-max) memory_max=$2; shift 2 ;;
    --evidence) evidence=$2; shift 2 ;;
    --*) usage ;;
    *) break ;;
  esac
done
[ $# -ge 2 ] || usage
label=$(printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '-')
shift
[ "$1" = -- ] && shift
[ $# -gt 0 ] || usage

name=$(date +%Y%m%dT%H%M%S)-$label
evidence=${evidence:-/work/tmp/fregat-evidence/$name-$host}
remote_run=$dir/runs/$name
# The Pi has about 3.7 GiB; swap is off inside the scope so a cap hit is a kill, not a slow crawl.
remote="cd \$HOME/$dir/platform && export LANE_RUN=\$HOME/$remote_run && mkdir -p \"\$LANE_RUN\" && \
systemd-run --user --scope --quiet --unit=lane-$name -p MemoryMax=$memory_max -p MemorySwapMax=0 \
bash scripts/heavy/pi/job.sh \"\$LANE_RUN\" $(printf '%q' "$*")"

rc=0
mesh "$host" -- bash -lc "$remote" </dev/null || rc=$?
mkdir -p "$evidence"
# Fixtures are generated inputs, often hundreds of MiB.
rsync -a --exclude=fixture/ --max-size=50M "$host:$remote_run/" "$evidence/" || true
echo "[pi-lane] $label on $host exited $rc; evidence: $evidence"
[ -f "$evidence/lane.json" ] && cat "$evidence/lane.json"
exit "$rc"

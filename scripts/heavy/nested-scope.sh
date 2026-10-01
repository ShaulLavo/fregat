#!/usr/bin/env bash
# Runs a command in a new systemd user scope. Inside a heavy job the scope joins the job's
# slice, so the job's memory ceiling and recorded totals include it.
# Usage: nested-scope.sh [systemd-run options…] <command…>
if [ -n "${HEAVY_JOB_SLICE:-}" ]; then
  exec systemd-run --user --scope --quiet --slice="$HEAVY_JOB_SLICE" "$@"
fi
exec systemd-run --user --scope --quiet "$@"

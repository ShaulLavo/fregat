#!/usr/bin/env bash
# Runs a command in a new systemd user scope. Inside a heavy job the scope joins the job's
# slice, so the job's memory ceiling and recorded totals include it. The command runs as given
# (systemd-run would expand `$VAR` in it), and an OOM kill stops only the offending process.
# Usage: nested-scope.sh [systemd-run options…] <command…>
options=(--user --scope --quiet --expand-environment=no -p OOMPolicy=continue)
[ -n "${HEAVY_JOB_SLICE:-}" ] && options+=(--slice="$HEAVY_JOB_SLICE")
exec systemd-run "${options[@]}" "$@"

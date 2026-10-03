#!/usr/bin/env bash
# The manager starts this service outside the job slice; even a stopped wrapper cannot pause it.
# ExecStopPost kills the whole slice on success, failure, or the service's native runtime limit.
set -eu
slice=$1
runtime=$2
grace=$3
systemd-notify --ready
sleep "$runtime"
systemctl --user kill --signal=SIGTERM "$slice"
sleep "$grace"

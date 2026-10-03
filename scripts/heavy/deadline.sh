#!/usr/bin/env bash
# The manager starts this service outside the job slice; even a stopped wrapper cannot pause it.
# ExecStopPost kills the whole slice on success, failure, or the service's native runtime limit.
set -eu
slice=$1
runtime=$2
grace=$3
# A healthy watchdog reports each second, including grace; a stopped shell cannot renew it.
heartbeat_until() {
  local now until budget=${1/./}
  # The scope emits remaining runtime with two fractional digits; grace stays whole seconds.
  [[ "$1" = *.* ]] || budget=$(($1 * 100))
  read -r now _ </proc/uptime
  until=$((10#${now/./} + 10#$budget))
  while :; do
    systemd-notify WATCHDOG=1
    read -r now _ </proc/uptime
    [ "$((10#${now/./}))" -lt "$until" ] || return 0
    sleep 1
  done
}

systemd-notify --ready
heartbeat_until "$runtime"
systemctl --user kill --signal=SIGTERM "$slice"
heartbeat_until "$grace"

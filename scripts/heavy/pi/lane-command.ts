import { shellQuote } from '../../../apps/server/src/utils/shell'
import { createScriptError } from '../../structured-errors'

/** How long a lane job may live, enforced on the Pi whatever happens to the connection. */
export type LaneLimits = {
  /** Wall-clock ceiling in seconds: the job scope's RuntimeMaxSec and a timer that stops the slice. */
  readonly maxWallSec: number
  /** Seconds without a heartbeat line on stdin before the Pi stops the job. */
  readonly leaseSec: number
  /** Seconds a stop waits after TERM before it sends KILL. */
  readonly graceSec: number
}

export const DEFAULT_LIMITS: LaneLimits = { maxWallSec: 3600, leaseSec: 30, graceSec: 10 }

export type LaneJob = LaneLimits & {
  readonly root: string
  readonly name: string
  readonly memoryMax: string
  readonly command: string
  /** Where in the checkout the command starts, as `git rev-parse --show-prefix` names it. */
  readonly directory?: string
}

// A dash in a slice name nests it under another slice; underscores keep it one level.
export function laneUnit(name: string) {
  return `lane_${name.replaceAll('-', '_')}`
}

function checkoutDirectory(directory = '') {
  const parts = directory.split('/').filter(Boolean)
  if (parts.some((part) => part === '..' || part === '.')) {
    throw createScriptError(`The job directory ${JSON.stringify(directory)} leaves the checkout.`)
  }
  return parts.join('/')
}

function seconds(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw createScriptError(
      `${name} must be a positive whole number of seconds; received ${value}.`,
    )
  }
  return value
}

export function laneRunDirectory(job: Pick<LaneJob, 'root' | 'name'>) {
  return `${job.root}/runs/${job.name}`
}

/**
 * Shell defining `stop_lane`: TERM to every process in the slice, KILL after the grace period
 * if any remain, then unload the slice, its ceiling timer and its failed members. Bounded.
 */
function stopLaneFunction(name: string, graceSec: number) {
  const unit = laneUnit(name)
  const slice = shellQuote(`${unit}.slice`)
  const timer = shellQuote(`${unit}_ceiling.timer`)
  const graceCs = seconds(graceSec, 'graceSec') * 100
  return `stop_lane() {
  systemctl --user stop ${timer} >/dev/null 2>&1
  local cg now until
  cg=$(systemctl --user show -p ControlGroup --value ${slice} 2>/dev/null)
  procs() { [ -n "$cg" ] && [ -d "/sys/fs/cgroup$cg" ] && find "/sys/fs/cgroup$cg" -name cgroup.procs -exec cat {} + 2>/dev/null | wc -l || echo 0; }
  if [ "$(procs)" -gt 0 ]; then
    systemctl --user kill --signal=TERM ${slice} >/dev/null 2>&1
    read -r now _ </proc/uptime
    until=$((10#\${now/./} + ${graceCs}))
    while [ "$(procs)" -gt 0 ]; do
      read -r now _ </proc/uptime
      [ "$((10#\${now/./}))" -lt "$until" ] || break
      sleep 0.1
    done
    if [ "$(procs)" -gt 0 ]; then
      echo "[pi-lane] the job outlived TERM by ${graceSec}s; sending KILL" >&2
      systemctl --user kill --signal=KILL ${slice} >/dev/null 2>&1
      sleep 0.5
    fi
  fi
  systemctl --user stop ${slice} >/dev/null 2>&1
  # job.sh capped the slice with a runtime drop-in; a killed job.sh never removed it.
  systemctl --user revert ${slice} >/dev/null 2>&1
  for unit in $(systemctl --user show -p RequiredBy --value ${slice} 2>/dev/null); do systemctl --user reset-failed "$unit" >/dev/null 2>&1; done
  systemctl --user reset-failed ${shellQuote(`${unit}_ceiling.service`)} >/dev/null 2>&1
  return 0
}`
}

/** Shell that stops the lane job if anything is left and succeeds only once its slice is unloaded. */
export function confirmStoppedCommand(name: string, graceSec: number) {
  const slice = shellQuote(`${laneUnit(name)}.slice`)
  return `${stopLaneFunction(name, graceSec)}
stop_lane
[ -z "$(systemctl --user list-units --all --no-legend --plain ${slice})" ]`
}

/**
 * Shell for the Pi. The job runs in its own slice, which job.sh caps; bench cases join it through
 * HEAVY_JOB_SLICE, so the cap and the totals cover them. The shell holds a lease: it stops the
 * slice when stdin closes, when no heartbeat line arrives for leaseSec, or when it is hung up on.
 * A timer stops the slice at maxWallSec even if this shell is gone. The job scope takes
 * OOMPolicy=continue: an OOM kills the offender alone, and job.sh lives to record it rather than
 * being SIGKILLed by systemd's stop on a second OOM event. systemd-run would expand \$VAR in the
 * command it is given, so expansion is off and the command reaches bash as written. `command` is the only
 * shell-interpreted part.
 */
export function laneJobCommand(job: LaneJob) {
  const platform = `${job.root}/platform`
  const directory = checkoutDirectory(job.directory)
  const run = laneRunDirectory(job)
  const unit = laneUnit(job.name)
  const slice = shellQuote(`${unit}.slice`)
  const maxWall = seconds(job.maxWallSec, 'maxWallSec')
  const lease = seconds(job.leaseSec, 'leaseSec')
  return `${stopLaneFunction(job.name, job.graceSec)}
# A closed connection must not kill this shell before it stops the slice.
trap '' PIPE
trap 'stop_lane; exit 129' HUP
trap 'stop_lane; exit 130' INT
trap 'stop_lane; exit 143' TERM
cd ${shellQuote(directory ? `${platform}/${directory}` : platform)} || exit 1
mkdir -p ${shellQuote(run)} || exit 1
# Tools that write evidence under FREGAT_EVIDENCE_ROOT write it where run.ts copies it back.
export LANE_RUN=${shellQuote(run)} FREGAT_EVIDENCE_ROOT=${shellQuote(run)} HEAVY_JOB_SLICE=${slice}
systemd-run --user --quiet --unit=${shellQuote(`${unit}_ceiling`)} --on-active=${maxWall}s --timer-property=AccuracySec=1s systemctl --user stop ${slice} || exit 1
systemd-run --user --scope --quiet --expand-environment=no --unit=${shellQuote(`${unit}.scope`)} --slice=${slice} -p RuntimeMaxSec=${maxWall} -p OOMPolicy=continue \\
  bash ${shellQuote(`${platform}/scripts/heavy/pi/job.sh`)} ${shellQuote(job.memoryMax)} ${shellQuote(run)} ${shellQuote(job.command)} </dev/null &
job=$!
while kill -0 "$job" 2>/dev/null; do
  IFS= read -r -t ${lease} _ && continue
  kill -0 "$job" 2>/dev/null || break
  echo "[pi-lane] the controlling connection closed or went quiet for ${lease}s; stopping the job" >&2
  stop_lane
  break
done
wait "$job"
status=$?
stop_lane
exit "$status"`
}

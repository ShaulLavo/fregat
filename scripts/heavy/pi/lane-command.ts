import { shellQuote } from '../../../apps/server/src/utils/shell'
import { createScriptError } from '../../structured-errors'

export type LaneJob = {
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

export function laneRunDirectory(job: Pick<LaneJob, 'root' | 'name'>) {
  return `${job.root}/runs/${job.name}`
}

/**
 * Shell for the Pi: the job runs in its own slice, which job.sh caps; bench cases join it through
 * HEAVY_JOB_SLICE, so the cap and the totals cover them. `command` is the only shell-interpreted part.
 */
export function laneJobCommand(job: LaneJob) {
  const platform = `${job.root}/platform`
  const directory = checkoutDirectory(job.directory)
  const run = laneRunDirectory(job)
  const unit = laneUnit(job.name)
  return [
    `cd ${shellQuote(directory ? `${platform}/${directory}` : platform)}`,
    `mkdir -p ${shellQuote(run)}`,
    `export LANE_RUN=${shellQuote(run)} HEAVY_JOB_SLICE=${shellQuote(`${unit}.slice`)}`,
    [
      'exec systemd-run --user --scope --quiet',
      `--unit=${shellQuote(`${unit}.scope`)}`,
      `--slice=${shellQuote(`${unit}.slice`)}`,
      'bash',
      shellQuote(`${platform}/scripts/heavy/pi/job.sh`),
      shellQuote(job.memoryMax),
      shellQuote(run),
      shellQuote(job.command),
    ].join(' '),
  ].join(' && ')
}

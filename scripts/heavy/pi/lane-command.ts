import { shellQuote } from '../../../apps/server/src/utils/shell'

export type LaneJob = {
  readonly root: string
  readonly name: string
  readonly memoryMax: string
  readonly command: string
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
  const run = laneRunDirectory(job)
  // A dash in a slice name nests it under another slice; underscores keep it one level.
  const unit = `lane_${job.name.replaceAll('-', '_')}`
  return [
    `cd ${shellQuote(platform)}`,
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

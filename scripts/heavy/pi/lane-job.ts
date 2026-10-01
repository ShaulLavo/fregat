import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { scriptFailureText } from '../../structured-errors'
import { collectEvidence, laneExitCode } from './evidence'
import { laneJobCommand, laneRunDirectory, laneUnit, type LaneJob } from './lane-command'
import { run } from './remote'

/** What job.sh writes to lane.json: the totals of the job's slice, bench cases included. */
export type LaneTotals = {
  readonly host: string
  readonly exitCode: number
  readonly memoryPeakBytes: number | null
  readonly cpuUsageUsec: number | null
  readonly oomKills: number | null
}

export type LaneRun = Omit<LaneJob, 'name'> & {
  readonly host: string
  readonly name: string
  readonly evidence: string
}

export function laneRunName(label: string) {
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').slice(0, 15).toLowerCase()
  const safe = label.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-')
  // Two launches of one label in the same second must not share a directory or a slice.
  return `${stamp}-${safe}-${randomBytes(3).toString('hex')}`
}

/** Signals every process in the job's slice on the Pi; the job then exits and writes its totals. */
export function stopLane(host: string, name: string, signal: NodeJS.Signals) {
  run([
    'ssh',
    '-o',
    'BatchMode=yes',
    host,
    `systemctl --user kill --signal=${signal} ${laneUnit(name)}.slice`,
  ])
}

/**
 * Runs the job through mesh in its capped slice and copies its run directory to `evidence`. The
 * exit is the command's, or EVIDENCE_FAILED when it succeeded and its evidence did not arrive.
 */
export async function runOnLane(job: LaneRun) {
  const mesh = Bun.spawn(['mesh', job.host, '--', 'bash', '-lc', laneJobCommand(job)], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  const commandExit = await mesh.exited
  let totals: LaneTotals | null = null
  try {
    collectEvidence(`${job.host}:${laneRunDirectory(job)}`, job.evidence)
    totals = JSON.parse(readFileSync(path.join(job.evidence, 'lane.json'), 'utf8')) as LaneTotals
  } catch (error) {
    console.error(scriptFailureText(error))
  }
  return { exitCode: laneExitCode(commandExit, totals !== null), totals }
}

/** The lane's totals in the accounting format scope.sh writes, so the wrapper records them alike. */
export function accountingText(totals: LaneTotals | null, exitCode: number) {
  const lines = [`exit ${exitCode}`]
  if (totals?.memoryPeakBytes != null) lines.push(`peak ${totals.memoryPeakBytes}`)
  if (totals?.cpuUsageUsec != null) lines.push(`cpu ${totals.cpuUsageUsec}`)
  if (totals?.oomKills != null) lines.push(`oom ${totals.oomKills}`)
  return `${lines.join('\n')}\n`
}

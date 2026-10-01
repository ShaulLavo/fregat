import { existsSync, readFileSync, rmSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import path from 'node:path'

import { scriptErrors } from '../structured-errors'
import { DEFAULT_LIMITS } from './pi/lane-command'

export const SCOPE_SHIM = path.join(import.meta.dirname, 'scope.sh')
// install.ts bundles pi/launch.ts beside run.js as pi/launch.js.
export const PI_LAUNCHER = path.join(
  import.meta.dirname,
  'pi',
  import.meta.url.endsWith('.ts') ? 'launch.ts' : 'launch.js',
)
// 28 cores would otherwise mean ~24 Vitest workers at ~450 MB each.
const VITEST_WORKERS = '4'

export const HOSTS = ['local', 'pi'] as const
export type Host = (typeof HOSTS)[number]

export function isHost(value: string): value is Host {
  return (HOSTS as readonly string[]).includes(value)
}

type Launch = {
  readonly unit: string
  readonly accountingFile: string
  readonly command: readonly string[]
}

/**
 * A local job's scope joins its slice; the shim drains and reads the whole slice, and holds the
 * slot locks it inherits on fds 3–5 for as long as the job's processes run.
 */
export function localCommand({
  unit,
  accountingFile,
  command,
  slice,
  graceSeconds,
}: Launch & { readonly slice: string; readonly graceSeconds: number }) {
  return [
    'systemd-run',
    '--user',
    '--scope',
    '--quiet',
    `--unit=${unit}`,
    `--slice=${slice}`,
    // systemd-run expands `$VAR` in the command itself, mangling `${x%y}` and `$$`.
    '--expand-environment=no',
    // The default `stop` SIGTERMs the scope after an OOM kill, and a second OOM during that
    // stop SIGKILLs the shim, losing the record. The kernel still kills only the offender.
    '-p',
    'OOMPolicy=continue',
    'bash',
    SCOPE_SHIM,
    '--slice',
    '--grace',
    String(graceSeconds),
    accountingFile,
    ...command,
  ]
}

/** The job runs on the Pi in its own capped slice; the launcher writes that slice's totals. */
export function piCommand({
  unit,
  accountingFile,
  command,
  maxWallSec,
}: Launch & { readonly maxWallSec?: number }) {
  return [
    process.execPath,
    PI_LAUNCHER,
    unit,
    accountingFile,
    String(maxWallSec ?? DEFAULT_LIMITS.maxWallSec),
    ...command,
  ]
}

export type JobAccounting = {
  /** Processes still running when the command exited, which the shim stopped. */
  readonly leftoverProcesses: number | null
  readonly memoryPeakBytes: number | null
  readonly cpuUsageUsec: number | null
  readonly oomKills: number | null
}

export type JobOutcome = JobAccounting & {
  /** The local job slice; null for a Pi job, whose slice lives on the Pi. */
  readonly slice: string | null
  readonly unit: string
  readonly exitCode: number
  readonly wallMs: number
}

type JobBase = {
  readonly id: string
  readonly command: readonly string[]
  readonly cwd: string
  /** Seconds between a stop signal and SIGKILL to everything the job runs. */
  readonly graceSeconds: number
}

/**
 * A local job carries its slice root, ceiling and the shared slot-lock descriptors its scope
 * keeps; a Pi job runs under the Pi's ceiling and wall limit.
 */
export type JobSpec =
  | (JobBase & {
      readonly host: 'local'
      readonly sliceRoot: string
      readonly ceilingBytes: number
      readonly slotLocks: readonly number[]
    })
  | (JobBase & { readonly host: 'pi'; readonly maxWallSec?: number })

/**
 * Launches the job. A local job runs in its own slice, `<root>-<id>.slice`, whose ceiling is set
 * before the first process starts; `HEAVY_JOB_SLICE` names it, so scopes the job opens through
 * `nested-scope.sh` share its ceiling and accounting. `stop` signals every process of the job
 * and, if they are still running after the grace, kills them. `done` settles once they have all
 * exited; the slice and its ceiling are removed however the launch or the job ends.
 */
export function startJob(job: JobSpec) {
  const unit = `${job.host === 'local' ? job.sliceRoot : 'heavy'}-${job.id}.scope`
  const accountingFile = path.join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `${unit}.accounting`)
  const slice = job.host === 'local' ? jobSlice(job) : null
  const started = performance.now()
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn({
      cmd: launchCommand(job, unit, accountingFile),
      cwd: job.cwd,
      env: {
        ...process.env,
        ...(slice ? { HEAVY_JOB_SLICE: slice } : {}),
        VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? VITEST_WORKERS,
      },
      stdio: ['inherit', 'inherit', 'inherit', ...(job.host === 'local' ? job.slotLocks : [])],
    })
  } catch (error) {
    if (slice) removeSlice(slice)
    throw error
  }

  // Before systemd-run has made the scope, the signal ends systemd-run itself; the Pi
  // launcher forwards it to the Pi.
  const signalJob = (signal: NodeJS.Signals) => {
    child.kill(signal)
    if (slice) systemctl(['kill', `--signal=${signal}`, slice])
  }
  let escalation: ReturnType<typeof setTimeout> | undefined
  const stop = (signal: NodeJS.Signals) => {
    signalJob(signal)
    escalation ??= setTimeout(() => signalJob('SIGKILL'), job.graceSeconds * 1000)
  }

  const done = child.exited
    .then((): JobOutcome => {
      const signalCode = child.signalCode
      const exitCode = child.exitCode ?? 128 + (signalCode ? constants.signals[signalCode] : 0)
      const wallMs = Math.round(performance.now() - started)
      return { exitCode, slice, unit, wallMs, ...readAccounting(accountingFile) }
    })
    .finally(() => {
      clearTimeout(escalation)
      if (slice) removeSlice(slice)
    })
  return { done, stop }
}

type LocalJob = Extract<JobSpec, { readonly host: 'local' }>

function jobSlice(job: LocalJob) {
  return `${job.sliceRoot}-${job.id}.slice`
}

function launchCommand(job: JobSpec, unit: string, accountingFile: string) {
  const launch = { accountingFile, command: job.command, unit }
  if (job.host === 'pi') return piCommand({ ...launch, maxWallSec: job.maxWallSec })
  limitSlice(jobSlice(job), job.ceilingBytes)
  return localCommand({ ...launch, graceSeconds: job.graceSeconds, slice: jobSlice(job) })
}

/** Kills whatever still runs in a slice whose wrapper is gone, then removes it. */
export function reapSlice(slice: string) {
  systemctl(['kill', '--signal=SIGKILL', slice])
  removeSlice(slice)
}

function removeSlice(slice: string) {
  systemctl(['stop', slice])
  systemctl(['revert', slice])
}

// No MemoryHigh: above it the kernel throttles a runaway into a crawl instead of killing it
// at MemoryMax. Swap keeps P1's 2:7 share of the ceiling.
function limitSlice(slice: string, ceilingBytes: number) {
  const swap = Math.floor((ceilingBytes * 2) / 7)
  const result = systemctl([
    'set-property',
    '--runtime',
    slice,
    `MemoryMax=${ceilingBytes}`,
    `MemorySwapMax=${swap}`,
  ])
  if (result.exitCode === 0) return
  throw scriptErrors.HEAVY_SLICE_FAILED({ detail: result.stderr.toString().trim(), slice })
}

function systemctl(args: readonly string[]) {
  return Bun.spawnSync(['systemctl', '--user', ...args], { stderr: 'pipe', stdout: 'ignore' })
}

export function readAccounting(file: string): JobAccounting {
  if (!existsSync(file)) {
    return { cpuUsageUsec: null, leftoverProcesses: null, memoryPeakBytes: null, oomKills: null }
  }
  const values = new Map(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.split(' ') as [string, string | undefined]),
  )
  rmSync(file, { force: true })
  const number = (key: string) => {
    const value = values.get(key)
    return value && /^\d+$/.test(value) ? Number(value) : null
  }
  return {
    cpuUsageUsec: number('cpu'),
    leftoverProcesses: number('left'),
    memoryPeakBytes: number('peak'),
    oomKills: number('oom'),
  }
}

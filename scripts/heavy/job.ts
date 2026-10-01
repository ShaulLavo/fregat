import { existsSync, readFileSync, rmSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import path from 'node:path'

import { scriptErrors } from '../structured-errors'

const SCOPE_SHIM = path.join(import.meta.dirname, 'scope.sh')
// 28 cores would otherwise mean ~24 Vitest workers at ~450 MB each.
const VITEST_WORKERS = '4'

type Launch = {
  readonly unit: string
  readonly slice: string
  readonly accountingFile: string
  readonly command: readonly string[]
}

/** The argv that runs a job on each host, inside a scope whose shim writes the accounting file. */
const launchers = {
  local: ({ unit, slice, accountingFile, command }: Launch) => [
    'systemd-run',
    '--user',
    '--scope',
    '--quiet',
    `--unit=${unit}`,
    `--slice=${slice}`,
    'bash',
    SCOPE_SHIM,
    accountingFile,
    ...command,
  ],
}

export type Host = keyof typeof launchers
export const HOSTS = Object.keys(launchers) as readonly Host[]

export function isHost(value: string): value is Host {
  return Object.hasOwn(launchers, value)
}

export type JobAccounting = {
  /** Processes still running when the command exited, which the shim stopped. */
  readonly leftoverProcesses: number | null
  readonly memoryPeakBytes: number | null
  readonly cpuUsageUsec: number | null
  readonly oomKills: number | null
}

export type JobOutcome = JobAccounting & {
  readonly slice: string
  readonly unit: string
  readonly exitCode: number
  readonly wallMs: number
}

export type JobSpec = {
  readonly id: string
  readonly host: Host
  readonly command: readonly string[]
  readonly cwd: string
  /** The slice's MemoryMax; nested scopes that join the slice share it. */
  readonly ceilingBytes: number
}

/**
 * Launches the job in its own slice, `heavy-<id>.slice`, whose ceiling is set before the
 * first process starts. `HEAVY_JOB_SLICE` names it, so scopes the job opens through
 * `nested-scope.sh` share its ceiling and accounting. `stop` signals every process in the
 * slice, and `done` settles once the command and everything it left running have exited.
 */
export function startJob(job: JobSpec) {
  const unit = `heavy-${job.id}.scope`
  const slice = `heavy-${job.id}.slice`
  const accountingFile = path.join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `${unit}.accounting`)
  limitSlice(slice, job.ceilingBytes)
  const started = performance.now()
  const child = Bun.spawn({
    cmd: launchers[job.host]({ accountingFile, command: job.command, slice, unit }),
    cwd: job.cwd,
    env: {
      ...process.env,
      HEAVY_JOB_SLICE: slice,
      VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? VITEST_WORKERS,
    },
    stdio: ['inherit', 'inherit', 'inherit'],
  })

  const stop = (signal: NodeJS.Signals) => {
    // Before systemd-run has made the scope, the signal ends systemd-run itself.
    child.kill(signal)
    systemctl(['kill', `--signal=${signal}`, slice])
  }

  const done = child.exited.then((): JobOutcome => {
    const signalCode = child.signalCode
    const exitCode = child.exitCode ?? 128 + (signalCode ? constants.signals[signalCode] : 0)
    const wallMs = Math.round(performance.now() - started)
    const accounting = readAccounting(accountingFile)
    systemctl(['stop', slice])
    systemctl(['revert', slice])
    return { exitCode, slice, unit, wallMs, ...accounting }
  })
  return { done, stop }
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

function readAccounting(file: string): JobAccounting {
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

import { existsSync, readFileSync, rmSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import path from 'node:path'

export const SCOPE_SHIM = path.join(import.meta.dirname, 'scope.sh')
// install.ts bundles pi/launch.ts beside run.js as pi/launch.js.
export const PI_LAUNCHER = path.join(
  import.meta.dirname,
  'pi',
  import.meta.url.endsWith('.ts') ? 'launch.ts' : 'launch.js',
)
// The per-job budget that kept the 2026-09-25 OOM to one job: a runaway is killed alone.
const MEMORY_CAPS = ['-p', 'MemoryHigh=6G', '-p', 'MemoryMax=7G', '-p', 'MemorySwapMax=2G']
// 28 cores would otherwise mean ~24 Vitest workers at ~450 MB each.
const VITEST_WORKERS = '4'

export type Launch = {
  readonly unit: string
  readonly accountingFile: string
  readonly command: readonly string[]
}

/** The argv that runs a job on each host, inside a scope whose shim writes the accounting file. */
const launchers = {
  local: ({ unit, accountingFile, command }: Launch) => [
    'systemd-run',
    '--user',
    '--scope',
    '--quiet',
    `--unit=${unit}`,
    ...MEMORY_CAPS,
    'bash',
    SCOPE_SHIM,
    accountingFile,
    ...command,
  ],
  // The job runs on the Pi in its own capped slice; the launcher writes that slice's totals.
  pi: ({ unit, accountingFile, command }: Launch) => [
    process.execPath,
    PI_LAUNCHER,
    unit,
    accountingFile,
    ...command,
  ],
}

export function launchCommand(host: Host, launch: Launch) {
  return launchers[host](launch)
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
  readonly unit: string
  readonly exitCode: number
  readonly wallMs: number
}

export type JobSpec = {
  readonly id: string
  readonly host: Host
  readonly command: readonly string[]
  readonly cwd: string
}

/**
 * Launches the job; `stop` signals every process in its scope, and `done` settles once the
 * command and everything it left running have exited.
 */
export function startJob(job: JobSpec) {
  const unit = `heavy-${job.id}.scope`
  const accountingFile = path.join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), `${unit}.accounting`)
  const started = performance.now()
  const child = Bun.spawn({
    cmd: launchCommand(job.host, { accountingFile, command: job.command, unit }),
    cwd: job.cwd,
    env: { ...process.env, VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? VITEST_WORKERS },
    stdio: ['inherit', 'inherit', 'inherit'],
  })

  const stop = (signal: NodeJS.Signals) => {
    // Before systemd-run has made the scope, the signal ends systemd-run itself.
    child.kill(signal)
    Bun.spawnSync(['systemctl', '--user', 'kill', `--signal=${signal}`, unit], { stderr: 'ignore' })
  }

  const done = child.exited.then((): JobOutcome => {
    const signalCode = child.signalCode
    const exitCode = child.exitCode ?? 128 + (signalCode ? constants.signals[signalCode] : 0)
    return {
      exitCode,
      unit,
      wallMs: Math.round(performance.now() - started),
      ...readAccounting(accountingFile),
    }
  })
  return { done, stop }
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

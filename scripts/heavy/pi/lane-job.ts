import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { constants } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import { shellQuote } from '../../../apps/server/src/utils/shell'
import { scriptFailureText } from '../../structured-errors'
import { collectEvidence, laneExitCode } from './evidence'
import {
  confirmStoppedCommand,
  laneJobCommand,
  laneRunDirectory,
  laneUnit,
  type LaneJob,
} from './lane-command'

// The exit when the Pi could not be confirmed to have stopped the job (sysexits EX_TEMPFAIL).
export const LANE_ABANDONED = 75
// ssh's own exit for a connection or transport failure.
const TRANSPORT_FAILED = 255

const count = v.pipe(v.number(), v.safeInteger(), v.minValue(0))
const metric = v.nullable(count)
const text = v.pipe(v.string(), v.regex(/^[^\n\r]*$/))
const totalsSchema = v.strictObject({
  host: text,
  model: text,
  arch: text,
  cpus: v.pipe(count, v.minValue(1), v.maxValue(4096)),
  slice: text,
  memoryMax: text,
  exitCode: v.pipe(count, v.maxValue(255)),
  wallMs: count,
  memoryPeakBytes: metric,
  cpuUsageUsec: metric,
  oomKills: metric,
})

/** What job.sh writes to lane.json: the totals of the job's slice, bench cases included. */
export type LaneTotals = v.InferOutput<typeof totalsSchema>

/** lane.json exactly as job.sh writes it, or null: a wrong field must never become a number. */
export function parseLaneTotals(json: string): LaneTotals | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = v.safeParse(totalsSchema, value)
  return parsed.success ? parsed.output : null
}

/** How the lane reaches its host: tests swap ssh for a local bash with the same contract. */
export type LaneTransport = {
  /** argv that runs bash script text on the host with this process's pipes. */
  readonly shell: (script: string) => string[]
  /** How rsync names a path on the host. */
  readonly path: (file: string) => string
}

const SSH_OPTIONS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=5',
  '-o',
  'ServerAliveCountMax=3',
]

export function sshTransport(host: string): LaneTransport {
  return {
    // A login shell: Bun lives in ~/.local/bin, which only the profile puts on PATH.
    shell: (script) => ['ssh', ...SSH_OPTIONS, host, `bash -lc ${shellQuote(script)}`],
    path: (file) => `${host}:${file}`,
  }
}

export type LaneRun = Omit<LaneJob, 'name'> & {
  readonly host: string
  readonly name: string
  readonly evidence: string
}

export type LaneOptions = {
  readonly transport: LaneTransport
  /** Aborting cancels the job: before it starts, it never starts; after, the lease is closed. */
  readonly signal?: AbortSignal
  readonly heartbeatMs?: number
  /** Attempts, and the pause between them, to confirm the slice is gone before giving up. */
  readonly confirmAttempts?: number
  readonly confirmDelayMs?: number
  /** Bound on each control command (confirm and stop). */
  readonly controlTimeoutMs?: number
}

export type LaneOutcome = {
  readonly exitCode: number
  readonly totals: LaneTotals | null
  readonly started: boolean
  readonly abandoned: boolean
}

export function laneRunName(label: string) {
  const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').slice(0, 15).toLowerCase()
  const safe = label.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-')
  // Two launches of one label in the same second must not share a directory or a slice.
  return `${stamp}-${safe}-${randomBytes(3).toString('hex')}`
}

/**
 * Lets queued signal handlers run. A signal that lands during synchronous work (a sync, an ssh
 * spawnSync) is handled only once the event loop turns, so a cancel check must wait for that.
 */
export function signalsDelivered() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

export function signalExit(reason: unknown) {
  const signal = typeof reason === 'string' ? (reason as NodeJS.Signals) : 'SIGTERM'
  return 128 + (constants.signals[signal] ?? constants.signals.SIGTERM)
}

/** Stops whatever is left of the job and waits, boundedly, for its slice to unload. */
async function confirmStopped(job: LaneRun, options: LaneOptions) {
  const attempts = options.confirmAttempts ?? 6
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = Bun.spawnSync(
      options.transport.shell(confirmStoppedCommand(job.name, job.graceSec)),
      {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
        timeout: options.controlTimeoutMs ?? 30_000,
      },
    )
    if (result.exitCode === 0) return true
    console.error(
      `[pi-lane] could not confirm ${laneUnit(job.name)}.slice stopped on ${job.host} (attempt ${attempt}/${attempts}, exit ${result.exitCode ?? 'timeout'})`,
    )
    if (attempt < attempts) await Bun.sleep(options.confirmDelayMs ?? 5_000)
  }
  return false
}

function abandon(job: LaneRun) {
  const slice = `${laneUnit(job.name)}.slice`
  console.error(
    `[pi-lane] ABANDONED: ${slice} on ${job.host} may still be running. Stop it with \`ssh ${job.host} systemctl --user stop ${slice}\`; its ceiling timer ends it after ${job.maxWallSec}s regardless.`,
  )
  mkdirSync(job.evidence, { recursive: true })
  writeFileSync(
    path.join(job.evidence, 'abandoned.json'),
    `${JSON.stringify({ host: job.host, slice, maxWallSec: job.maxWallSec, at: new Date().toISOString() })}\n`,
  )
}

function readTotals(job: LaneRun, transport: LaneTransport) {
  try {
    collectEvidence(transport.path(laneRunDirectory(job)), job.evidence)
    const totals = parseLaneTotals(readFileSync(path.join(job.evidence, 'lane.json'), 'utf8'))
    if (!totals) console.error(`[pi-lane] ${job.evidence}/lane.json is not the shape job.sh writes`)
    return totals
  } catch (error) {
    console.error(scriptFailureText(error))
    return null
  }
}

/**
 * Runs the job on the lane host in its capped slice, holding its lease with heartbeats on stdin.
 * Resolves only once the slice is confirmed gone, or after a bounded give-up reported as
 * abandoned, so whoever holds the Pi lock keeps it while the job can still run.
 */
export async function runOnLane(job: LaneRun, options: LaneOptions): Promise<LaneOutcome> {
  const { signal, transport } = options
  await signalsDelivered()
  if (signal?.aborted) {
    return { exitCode: signalExit(signal.reason), totals: null, started: false, abandoned: false }
  }
  const child = Bun.spawn(transport.shell(laneJobCommand(job)), {
    stdin: 'pipe',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  // A write to a dead connection is a missed heartbeat; the host's lease handles that.
  const beat = setInterval(() => {
    try {
      child.stdin.write('\n')
      void Promise.resolve(child.stdin.flush()).catch(() => {})
    } catch {
      clearInterval(beat)
    }
  }, options.heartbeatMs ?? 5_000)
  let released = false
  const release = () => {
    clearInterval(beat)
    if (released) return
    released = true
    void child.stdin.end()
  }
  let deadline: ReturnType<typeof setTimeout> | undefined
  // Closing the lease is the cancel: the host stops the slice on EOF, or after leaseSec of
  // silence if the connection is already gone. Past that, the local transport is cut.
  const onAbort = () => {
    release()
    deadline = setTimeout(() => child.kill('SIGKILL'), (job.leaseSec + job.graceSec + 15) * 1_000)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  const transportExit = await child.exited
  release()
  clearTimeout(deadline)
  signal?.removeEventListener('abort', onAbort)

  if (!(await confirmStopped(job, options))) {
    abandon(job)
    return { exitCode: LANE_ABANDONED, totals: null, started: true, abandoned: true }
  }
  const totals = readTotals(job, transport)
  if (signal?.aborted) {
    return { exitCode: signalExit(signal.reason), totals, started: true, abandoned: false }
  }
  const commandExit = transportExit === TRANSPORT_FAILED && totals ? totals.exitCode : transportExit
  return {
    exitCode: laneExitCode(commandExit, totals !== null),
    totals,
    started: true,
    abandoned: false,
  }
}

/** The lane's totals in the accounting format scope.sh writes, so the wrapper records them alike. */
export function accountingText(totals: LaneTotals | null, exitCode: number) {
  const lines = [`exit ${exitCode}`]
  if (totals?.memoryPeakBytes != null) lines.push(`peak ${totals.memoryPeakBytes}`)
  if (totals?.cpuUsageUsec != null) lines.push(`cpu ${totals.cpuUsageUsec}`)
  if (totals?.oomKills != null) lines.push(`oom ${totals.oomKills}`)
  return `${lines.join('\n')}\n`
}

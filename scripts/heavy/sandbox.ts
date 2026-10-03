import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'

import { processExists } from '../../apps/server/scripts/process-exists'
import type { HeavyJobRecord } from './record'

export { processExists as alive }

const RUN = path.join(import.meta.dirname, 'run.ts')
export const MiB = 2 ** 20
export const userScopes = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0
const boxes: Box[] = []
const external = new Map<Box, { child: ReturnType<typeof spawn>; done: Promise<void> }[]>()

/** External holders run outside the job slice; cleanup owns their entire process group. */
export function startExternal(box: Box, command: readonly string[]) {
  const child = spawn(command[0]!, command.slice(1), { detached: true, stdio: 'ignore' })
  const done = new Promise<void>((resolve) => child.on('close', () => resolve()))
  const children = external.get(box) ?? []
  children.push({ child, done })
  external.set(box, children)
  return child
}

/** Removes every sandbox made since the last call; tests call it in `afterEach`. */
export async function removeSandboxes() {
  for (const box of boxes.splice(0)) {
    const children = external.get(box) ?? []
    for (const { child } of children) {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) continue
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    await Promise.all(children.map(({ done }) => done))
    external.delete(box)
    spawnSync('systemctl', ['--user', 'stop', `${box.sliceRoot}.slice`])
    rmSync(box.root, { force: true, recursive: true })
  }
}

/**
 * A private state directory, log directory, settings home, `/proc` stand-in and slice root:
 * slices are machine-wide, so a sandbox's jobs never see, count or reap anyone else's.
 */
export function sandbox() {
  const root = mkdtempSync(path.join(tmpdir(), 'heavy-run-'))
  const box = {
    home: path.join(root, 'home'),
    logs: path.join(root, 'logs'),
    proc: path.join(root, 'proc'),
    root,
    sliceRoot: `heavyt${randomBytes(4).toString('hex')}`,
    state: path.join(root, 'state'),
  }
  boxes.push(box)
  for (const dir of [box.home, box.state, path.join(box.proc, 'pressure')])
    mkdirSync(dir, { recursive: true })
  return box
}

export type Box = {
  readonly home: string
  readonly logs: string
  readonly proc: string
  readonly root: string
  readonly sliceRoot: string
  readonly state: string
}

/** What admission reads from `/proc`: available memory, memory pressure, load per core. */
export function writeMachine(
  box: Box,
  machine: { availableMiB: number; memoryPressure?: number; loadPerCore?: number },
) {
  writeFileSync(
    path.join(box.proc, 'meminfo'),
    `MemTotal: 33554432 kB\nMemAvailable: ${machine.availableMiB * 1024} kB\n`,
  )
  writeFileSync(
    path.join(box.proc, 'pressure', 'memory'),
    `some avg10=${(machine.memoryPressure ?? 0).toFixed(2)} avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`,
  )
  const load = (machine.loadPerCore ?? 0) * availableParallelism()
  writeFileSync(path.join(box.proc, 'loadavg'), `${load.toFixed(2)} 0.00 0.00 1/100 1\n`)
}

export function writeSettings(box: Box, values: Record<string, unknown>) {
  writeFileSync(path.join(box.home, 'settings.json'), JSON.stringify(values))
}

export type StartOptions = {
  readonly cwd?: string
  /** Another slice root for this job, beside the sandbox's state directory. */
  readonly sliceRoot?: string
  readonly jobClass?: string
  readonly quiet?: boolean
  readonly maxWallSec?: number
  readonly detached?: boolean
  readonly env?: NodeJS.ProcessEnv
  readonly preload?: string
  readonly logDir?: boolean
  readonly machine?: boolean
}

export function start(
  box: Box,
  label: string,
  command: readonly string[],
  options: StartOptions = {},
) {
  const args = [
    RUN,
    '--state-dir',
    box.state,
    '--settings-home',
    box.home,
    '--slice-root',
    options.sliceRoot ?? box.sliceRoot,
  ]
  if (options.preload) args.unshift('--preload', options.preload)
  if (options.logDir !== false) args.push('--log-dir', box.logs)
  if (options.machine) args.push('--proc', box.proc)
  if (options.jobClass) args.push('--class', options.jobClass)
  if (options.quiet) args.push('--quiet')
  if (options.maxWallSec !== undefined) args.push('--max-wall', String(options.maxWallSec))
  const child = spawn('bun', [...args, label, '--', ...command], {
    cwd: options.cwd ?? box.root,
    detached: options.detached ?? false,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  let stdout = ''
  child.stderr.on('data', (chunk) => (stderr += chunk))
  child.stdout.on('data', (chunk) => (stdout += chunk))
  const done = new Promise<{ code: number | null; stderr: string }>((resolve) =>
    child.on('close', (code) => resolve({ code, stderr })),
  )
  return { child, done, stderr: () => stderr, stdout: () => stdout }
}

export function heavy(
  box: Box,
  label: string,
  command: readonly string[],
  options: StartOptions = {},
) {
  return start(box, label, command, options).done
}

export function records(box: Box): HeavyJobRecord[] {
  if (!existsSync(box.logs)) return []
  return readdirSync(box.logs)
    .filter((file) => file.endsWith('.jsonl'))
    .flatMap((file) => readFileSync(path.join(box.logs, file), 'utf8').trim().split('\n'))
    .map((line) => JSON.parse(line) as HeavyJobRecord)
}

export function recordOf(box: Box, label: string) {
  return records(box).find((record) => record.label === label)
}

/** When the job's command started, from its record: the end minus its wall time. */
export function startedAt(record: HeavyJobRecord | undefined) {
  return record ? Date.parse(record.timestamp) - record.wallMs : Number.NaN
}

export function endedAt(record: HeavyJobRecord | undefined) {
  return record ? Date.parse(record.timestamp) : Number.NaN
}

export function unitActive(unit: string) {
  return spawnSync('systemctl', ['--user', 'is-active', unit]).stdout.toString().trim() === 'active'
}

/** A shell loop that holds until the test creates `file`. */
export const until = (file: string) => `until [ -e ${file} ]; do sleep 0.02; done`

/** Whether a job started at once or reported a wait first; either way it is left to finish. */
export async function firstDecision(job: ReturnType<typeof start>) {
  let ended = false
  void job.done.then(() => (ended = true))
  for (;;) {
    if (job.stderr().includes('is waiting:')) return 'waiting'
    if (ended) return 'started'
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'

import { bootSeconds } from './admission'
import { lockDescriptor, openExisting } from './lock'
import type { Box, start } from './sandbox'

type Failure = {
  readonly box: Box
  readonly jobs: Readonly<Record<string, ReturnType<typeof start> | undefined>>
  readonly units?: readonly string[]
  readonly manager?: ReturnType<typeof spawnSync>
  readonly launcher?: {
    readonly pid: number | undefined
    readonly resultFile: string
    readonly checkpoints: readonly ReturnType<typeof quietLauncherReceipt>[]
  }
}

export function quietLauncherReceipt(pid: number | undefined, phase: string) {
  const boot = capture(bootSeconds)
  if (pid === undefined) return { phase, bootSeconds: boot, created: false }
  return {
    phase,
    bootSeconds: boot,
    pid,
    status: capture(() => readFileSync(`/proc/${pid}/status`, 'utf8')),
    cgroup: capture(() => readFileSync(`/proc/${pid}/cgroup`, 'utf8')),
    fd6: capture(() => readlinkSync(`/proc/${pid}/fd/6`)),
    fd6Info: capture(() => readFileSync(`/proc/${pid}/fdinfo/6`, 'utf8')),
  }
}

export function quietFailureReceipt({ box, jobs, units = [], manager, launcher }: Failure) {
  return capture(() => ({
    bootSeconds: capture(bootSeconds),
    fixtureRoot: box.root,
    sliceRoot: box.sliceRoot,
    jobs: Object.entries(jobs).map(([name, job]) => {
      if (!job) return { name, created: false }
      const { pid, exitCode, signalCode } = job.child
      return {
        name,
        pid,
        exitCode,
        signalCode,
        stdout: job.stdout(),
        stderr: job.stderr(),
        status: capture(() => readFileSync(`/proc/${pid}/status`, 'utf8')),
        wchan: capture(() => readFileSync(`/proc/${pid}/wchan`, 'utf8')),
      }
    }),
    state: Object.fromEntries(
      ['queue', 'jobs', 'runs', 'measurements', 'reaping'].map((place) => [
        place,
        files(path.join(box.state, place), place === 'queue' || place === 'jobs'),
      ]),
    ),
    holder: capture(() => readFileSync(path.join(box.state, 'quiet.holder'), 'utf8')),
    records: files(box.logs),
    launcher: launcher
      ? {
          current: quietLauncherReceipt(launcher.pid, 'failure'),
          result: capture(() => readFileSync(launcher.resultFile, 'utf8')),
          checkpoints: launcher.checkpoints,
        }
      : null,
    clientVersion: query(['systemd-run', '--version']),
    managerVersion: query(['systemctl', '--user', 'show', '--property=Version,SystemState']),
    managerCommand: manager ? resultReceipt(manager) : null,
    managerUnits: query([
      'systemctl',
      '--user',
      'show',
      '--all',
      '--property=Id,LoadState,ActiveState,SubState,Result,RuntimeMaxUSec,TimeoutStopUSec,ControlGroup,InvocationID',
      `${box.sliceRoot}*`,
      ...units.filter(
        (unit) => unit.startsWith(`${box.sliceRoot}-`) || unit === `${box.sliceRoot}.slice`,
      ),
    ]),
    managerJournal: query([
      'journalctl',
      '--user',
      '--no-pager',
      '--output=short-monotonic',
      '--lines=40',
      `--unit=${box.sliceRoot}*`,
    ]),
  }))
}

function files(directory: string, ownership = false) {
  return capture(() =>
    readdirSync(directory)
      .toSorted()
      .map((name) => {
        const file = path.join(directory, name)
        return {
          name,
          receipt: ownership ? entry(file) : capture(() => readFileSync(file, 'utf8')),
        }
      }),
  )
}

function entry(file: string) {
  return capture(() => {
    const fd = openExisting(file)
    if (fd === null) return null
    try {
      return { text: readFileSync(fd, 'utf8'), owned: !lockDescriptor(fd) }
    } finally {
      closeSync(fd)
    }
  })
}

function query(command: readonly string[]) {
  return { command, ...resultReceipt(spawnSync(command[0]!, command.slice(1), { timeout: 1_000 })) }
}

function resultReceipt(result: ReturnType<typeof spawnSync>) {
  return {
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stdout: result.stdout?.toString(),
    stderr: result.stderr?.toString(),
  }
}

function capture<T>(read: () => T): T | { receiptError: string } {
  try {
    return read()
  } catch (error) {
    return { receiptError: String(error) }
  }
}

const OBSERVER_BYTES = 65_536
const OBSERVER_RECORDS = 128
const OBSERVER_FILES = 16
const OBSERVER_LINE = 4_096
const shellPhases = [
  'entry',
  'payload',
  'payload-return',
  'cleanup-term',
  'cleanup-grace',
  'cleanup-kill',
  'accounting-start',
  'accounting-return',
  'watchdog-ready',
  'watchdog-runtime',
  'watchdog-term',
  'watchdog-grace',
  'overflow',
] as const
const pidSchema = v.pipe(v.number(), v.integer(), v.minValue(1))
const statusSchema = v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(65_535)))
const signalSchema = v.nullable(
  v.union([
    v.picklist(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP']),
    v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64)),
  ]),
)
const processSchema = v.strictObject({
  pid: pidSchema,
  parent: v.pipe(v.number(), v.integer(), v.minValue(0)),
  state: v.picklist(['R', 'S', 'D', 'Z', 'T', 't', 'X', 'x', 'I', 'W', 'P']),
  start: v.pipe(v.number(), v.integer(), v.minValue(0)),
  waitStatus: statusSchema,
  terminationSignal: v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(64))),
})
type ObservedProcess = v.InferOutput<typeof processSchema>
const scopeSchema = v.strictObject({
  processes: v.pipe(v.array(processSchema), v.maxLength(16)),
  watchdog: v.pipe(v.array(processSchema), v.maxLength(8)),
  primaryPid: v.nullable(pidSchema),
  unavailable: v.pipe(v.number(), v.integer(), v.minValue(0)),
  truncated: v.boolean(),
})
const eventBase = { at: v.pipe(v.number(), v.finite(), v.minValue(0)), pid: pidSchema }
const observationSchema = v.variant('kind', [
  v.strictObject({
    ...eventBase,
    kind: v.literal('shell'),
    phase: v.picklist(shellPhases),
    role: v.picklist(['shim', 'watchdog']),
    status: statusSchema,
  }),
  v.strictObject({
    ...eventBase,
    kind: v.literal('boundary'),
    operation: v.picklist([
      'spawn',
      'signal-attempt',
      'signal-return',
      'signal-throw',
      'supervisor-exit',
      'manager-return',
    ]),
    signal: signalSchema,
    status: statusSchema,
    result: v.picklist([
      'returned',
      'returned-void',
      'returned-true',
      'returned-false',
      'threw',
      'unavailable',
    ]),
    scope: scopeSchema,
  }),
])
type Observation = v.InferOutput<typeof observationSchema>
type QuietObserver =
  | { readonly kind: 'ready'; readonly directory: string; readonly preload: string }
  | { readonly kind: 'unavailable'; readonly reason: string }

function observerReason(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'io'
  if (error.code === 'ENOENT') return 'missing'
  if (error.code === 'EACCES' || error.code === 'EPERM') return 'refused'
  return 'io'
}

function boundedText(file: string, limit: number) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    if (!fstatSync(fd).isFile()) return { kind: 'refused' as const }
    const bytes = Buffer.alloc(limit + 1)
    const length = readSync(fd, bytes, 0, bytes.length, null)
    if (length > limit) return { kind: 'truncated' as const }
    return {
      kind: 'read' as const,
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
      bytes: length,
    }
  } finally {
    closeSync(fd)
  }
}

function observedProcess(pid: number): ObservedProcess | null {
  try {
    const text = boundedText(`/proc/${pid}/stat`, 1_024)
    if (text.kind !== 'read') return null
    const fields = text.text.slice(text.text.lastIndexOf(')') + 2).split(' ')
    const waitStatus = fields[0] === 'Z' ? Number(fields[49]) : null
    const parsed = v.safeParse(processSchema, {
      pid,
      parent: Number(fields[1]),
      state: fields[0],
      start: Number(fields[19]),
      waitStatus,
      terminationSignal: (waitStatus ?? 0) & 127 || null,
    })
    return parsed.success ? parsed.output : null
  } catch {
    return null
  }
}

function cgroupProcesses(group: string, limit: number) {
  try {
    const text = boundedText(path.join('/sys/fs/cgroup', group, 'cgroup.procs'), 1_024)
    if (text.kind !== 'read')
      return { processes: [], unavailable: 1, truncated: text.kind === 'truncated' }
    const pids = text.text.trim().split(/\s+/).filter(Boolean)
    const processes = pids
      .slice(0, limit)
      .map(Number)
      .map(observedProcess)
      .filter((value) => value !== null)
    return {
      processes,
      unavailable: Math.min(pids.length, limit) - processes.length,
      truncated: pids.length > limit,
    }
  } catch {
    return { processes: [], unavailable: 1, truncated: false }
  }
}

function observedScope(directory: string, pid: number, unit: string) {
  const empty = { processes: [], watchdog: [], primaryPid: null, unavailable: 1, truncated: false }
  try {
    const text = boundedText(`/proc/${pid}/cgroup`, 1_024)
    if (text.kind !== 'read') return empty
    const group = text.text.trim().split(':').slice(2).join(':')
    if (!group.endsWith(`/${unit}`)) return empty
    const slice = group.slice(0, group.lastIndexOf('/'))
    const root = slice.slice(0, slice.lastIndexOf('/'))
    const manager = root.slice(0, root.lastIndexOf('/'))
    const processes = cgroupProcesses(group, 16)
    const watchdog = cgroupProcesses(
      `${manager}/app.slice/${unit.replace('.scope', '_deadline.service')}`,
      8,
    )
    const shell = observerRecords(directory)
      .events.filter((event) => event.kind === 'shell' && event.pid === pid)
      .at(-1)
    const children = processes.processes.filter((process) => process.parent === pid)
    const primaryPid =
      shell?.kind === 'shell' && shell.phase === 'payload' && children.length === 1
        ? children[0]!.pid
        : null
    return {
      processes: processes.processes,
      watchdog: watchdog.processes,
      primaryPid,
      unavailable: processes.unavailable + watchdog.unavailable,
      truncated: processes.truncated || watchdog.truncated,
    }
  } catch {
    return empty
  }
}

type ObservationWriter = {
  readonly file: string
  readonly counts: string
  records: number
  bytes: number
  dropped: number
  unavailable: number
}

function emitObservation(writer: ObservationWriter, event: Observation) {
  try {
    const line = JSON.stringify(event) + '\n'
    if (
      writer.records >= OBSERVER_RECORDS ||
      writer.bytes + Buffer.byteLength(line) > OBSERVER_BYTES
    ) {
      writer.dropped++
    } else {
      appendFileSync(writer.file, line)
      writer.records++
      writer.bytes += Buffer.byteLength(line)
    }
  } catch {
    writer.unavailable++
  }
  try {
    writeFileSync(
      writer.counts,
      JSON.stringify({ dropped: writer.dropped, unavailable: writer.unavailable }),
    )
  } catch {}
}

/** All writes are optional observations; the original subprocess owns every outcome. */
export function quietRuntimeRecorder(directory: string) {
  const writer: ObservationWriter = {
    file: path.join(directory, `events-${process.pid}.jsonl`),
    counts: path.join(directory, `counts-${process.pid}.json`),
    records: 0,
    bytes: 0,
    dropped: 0,
    unavailable: 0,
  }
  const boundary = (
    child: Pick<Bun.Subprocess, 'pid'>,
    unit: string,
    operation: Extract<Observation, { kind: 'boundary' }>['operation'],
    status: number | null,
    signal: unknown,
    result: Extract<Observation, { kind: 'boundary' }>['result'] = 'returned',
  ) => {
    const parsedSignal = v.safeParse(signalSchema, signal)
    emitObservation(writer, {
      kind: 'boundary',
      at: Date.now() / 1_000,
      pid: child.pid,
      operation,
      status,
      signal: parsedSignal.success ? parsedSignal.output : null,
      result,
      scope: observedScope(directory, child.pid, unit),
    })
  }
  return {
    observe(
      child: Pick<Bun.Subprocess, 'pid' | 'kill' | 'exited' | 'exitCode' | 'signalCode'>,
      unit: string,
    ) {
      boundary(child, unit, 'spawn', null, null)
      const kill = child.kill.bind(child)
      child.kill = (...args) => {
        boundary(child, unit, 'signal-attempt', null, args[0] ?? 'SIGTERM')
        try {
          const result = kill(...args)
          boundary(
            child,
            unit,
            'signal-return',
            null,
            args[0] ?? 'SIGTERM',
            result === undefined ? 'returned-void' : 'returned',
          )
          return result
        } catch (error) {
          boundary(child, unit, 'signal-throw', null, args[0] ?? 'SIGTERM', 'threw')
          throw error
        }
      }
      void child.exited.then(
        (status) => boundary(child, unit, 'supervisor-exit', status, child.signalCode),
        () => boundary(child, unit, 'supervisor-exit', null, null, 'unavailable'),
      )
    },
    manager(pid: number, unit: string, status: number) {
      boundary({ pid }, unit, 'manager-return', status, null)
    },
  }
}

function shellObserver(directory: string, role: 'shim' | 'watchdog') {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  return `
__quiet_records=0
__quiet_phase() {
  local __quiet_status=$1 __quiet_command=$2 __quiet_phase=
  case "$__quiet_command" in
    'whole_slice=') __quiet_phase=entry ;;
    '"$@" '*) __quiet_phase=payload ;;
    'rc=$?') __quiet_phase=payload-return ;;
    'scan TERM') __quiet_phase=cleanup-term ;;
    'settle '*) __quiet_phase=cleanup-grace ;;
    'scan KILL') __quiet_phase=cleanup-kill ;;
    'printf '*'$rc'*) __quiet_phase=accounting-start ;;
    'exit "$rc"') __quiet_phase=accounting-return ;;
    'systemd-notify --ready') __quiet_phase=watchdog-ready ;;
    'heartbeat_until "$runtime"') __quiet_phase=watchdog-runtime ;;
    'systemctl --user kill --signal=SIGTERM '*) __quiet_phase=watchdog-term ;;
    'heartbeat_until "$grace"') __quiet_phase=watchdog-grace ;;
  esac
  [ -n "$__quiet_phase" ] || return 0
  [ "$__quiet_records" -le 64 ] || return 0
  [ "$__quiet_records" -lt 64 ] || __quiet_phase=overflow
  __quiet_records=$((__quiet_records + 1))
  printf '{"kind":"shell","at":%s,"pid":%s,"role":"${role}","phase":"%s","status":%s}\\n' "$EPOCHREALTIME" "$BASHPID" "$__quiet_phase" "$__quiet_status" 2>/dev/null >>${quote(directory)}/events-"$BASHPID".jsonl || :
  return 0
}
trap '__quiet_phase "$?" "$BASH_COMMAND"' DEBUG
`
}

export function createQuietObserver(box: Box): QuietObserver {
  const directory = path.join(box.root, 'quiet-observer')
  try {
    mkdirSync(directory)
    for (const [name, role] of [
      ['scope.sh', 'shim'],
      ['deadline.sh', 'watchdog'],
    ] as const) {
      const source = readFileSync(path.join(import.meta.dirname, name), 'utf8')
      writeFileSync(
        path.join(directory, name),
        source.replace(
          role === 'shim' ? 'exec 6<&-\n' : 'set -eu\n',
          (role === 'shim' ? 'exec 6<&-\n' : 'set -eu\n') + shellObserver(directory, role),
        ),
      )
    }
    const preload = path.join(directory, 'preload.mjs')
    writeFileSync(
      preload,
      `
import { quietRuntimeRecorder } from ${JSON.stringify(path.join(import.meta.dirname, 'quiet-receipts.ts'))}
const recorder = quietRuntimeRecorder(${JSON.stringify(directory)})
const spawn = Bun.spawn.bind(Bun)
let pid
let unit
Bun.spawn = (options, ...rest) => {
  const index = options.cmd?.indexOf(${JSON.stringify(path.join(import.meta.dirname, 'scope.sh'))})
  const owner = options.cmd?.find(value => typeof value === 'string' && value.startsWith('--unit=${box.sliceRoot}-') && value.endsWith('.scope'))
  if (index === undefined || index < 0 || !owner) return spawn(options, ...rest)
  const cmd = options.cmd.map((value, position) => position === index ? ${JSON.stringify(path.join(directory, 'scope.sh'))} : value)
  const child = spawn({ ...options, cmd }, ...rest)
  pid = child.pid
  unit = owner.slice('--unit='.length)
  try { recorder.observe(child, unit) } catch {}
  return child
}
const spawnSync = Bun.spawnSync.bind(Bun)
Bun.spawnSync = (command, ...rest) => {
  const result = spawnSync(command, ...rest)
  if (pid && Array.isArray(command) && command[0] === 'systemctl' && command.some(value => typeof value === 'string' && value.startsWith('${box.sliceRoot}-'))) { try { recorder.manager(pid, unit, result.exitCode) } catch {} }
  return result
}
`,
    )
    return { kind: 'ready', directory, preload }
  } catch (error) {
    return { kind: 'unavailable', reason: observerReason(error) }
  }
}

type ObservationRead = {
  events: Observation[]
  refused: number
  unavailable: number
  truncated: boolean
  dropped: number
  bytes: number
}

function parseObserverLine(line: string, result: ObservationRead) {
  if (result.events.length >= OBSERVER_RECORDS) {
    result.truncated = true
    return
  }
  if (Buffer.byteLength(line) > OBSERVER_LINE) {
    result.refused++
    return
  }
  try {
    const event = v.safeParse(observationSchema, JSON.parse(line))
    if (!event.success) {
      result.refused++
      return
    }
    result.events.push(event.output)
    result.truncated ||= event.output.kind === 'shell' && event.output.phase === 'overflow'
  } catch {
    result.refused++
  }
}

function parseObserverLines(text: string, result: ObservationRead) {
  for (const line of text.split('\n').filter(Boolean)) parseObserverLine(line, result)
}

function readObserverFile(directory: string, name: string, result: ObservationRead) {
  try {
    const body = boundedText(path.join(directory, name), OBSERVER_BYTES - result.bytes)
    if (body.kind !== 'read') {
      result.refused++
      result.truncated ||= body.kind === 'truncated'
      return
    }
    result.bytes += body.bytes
    if (name.startsWith('events-')) {
      parseObserverLines(body.text, result)
      return
    }
    const count = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_000_000))
    const counts = v.safeParse(
      v.strictObject({ dropped: count, unavailable: count }),
      JSON.parse(body.text),
    )
    if (!counts.success) {
      result.refused++
      return
    }
    result.dropped += counts.output.dropped
    result.unavailable += counts.output.unavailable
  } catch {
    result.unavailable++
  }
}

function drainObserverDirectory(
  directory: string,
  dir: ReturnType<typeof opendirSync>,
  result: ObservationRead,
) {
  for (let index = 0; index < OBSERVER_FILES; index++) {
    const file = dir.readSync()
    if (!file) return
    if (
      ['scope.sh', 'deadline.sh', 'preload.mjs', 'failure.json', 'cleanup.json'].includes(file.name)
    )
      continue
    if (
      !/^(events-\d+\.jsonl|counts-\d+\.json)$/.test(file.name) ||
      !file.isFile() ||
      file.isSymbolicLink()
    ) {
      result.refused++
      continue
    }
    readObserverFile(directory, file.name, result)
  }
  result.truncated ||= dir.readSync() !== null
}

function observerRecords(directory: string) {
  const result: ObservationRead = {
    events: [],
    refused: 0,
    unavailable: 0,
    truncated: false,
    dropped: 0,
    bytes: 0,
  }
  const dir = opendirSync(directory)
  try {
    drainObserverDirectory(directory, dir, result)
    if (result.events.length === 0) result.unavailable++
    const { bytes: _bytes, ...snapshot } = result
    return snapshot
  } finally {
    dir.closeSync()
  }
}

export function freezeQuietObserver(observer: QuietObserver, stage: 'failure' | 'cleanup') {
  if (observer.kind === 'unavailable')
    return { stage, unavailable: observer.reason, persisted: false }
  try {
    const snapshot = { stage, at: Date.now() / 1_000, ...observerRecords(observer.directory) }
    try {
      writeFileSync(path.join(observer.directory, `${stage}.json`), JSON.stringify(snapshot), {
        flag: 'wx',
      })
      return { ...snapshot, persisted: true }
    } catch (error) {
      return { ...snapshot, persisted: false, persistenceUnavailable: observerReason(error) }
    }
  } catch (error) {
    return { stage, unavailable: observerReason(error), persisted: false }
  }
}

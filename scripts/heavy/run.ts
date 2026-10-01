#!/usr/bin/env bun
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  SETTINGS_REGISTRY,
  type SettingId,
  type SettingValue,
} from '../../packages/contracts/src/settings/keys'
import { readHomeSetting } from '../home-setting'
import { productionStateHome } from '../state-home'
import { createScriptError, scriptFailureText } from '../structured-errors'
import {
  decide,
  drainRequest,
  legacyHold,
  liveSlices,
  readReadings,
  type Limits,
} from './admission'
import { HOSTS, isHost, reapSlice, startJob, type Host, type JobOutcome, type JobSpec } from './job'
import { acquirePiLane, DEFAULT_STATE_DIR, tryLock, unlock, waitLock } from './lock'
import { enqueue, live, promote, release, type Entry, type Held } from './queue'
import { appendRecord, redactCommand, type HeavyJobRecord } from './record'

const USAGE =
  'Usage: bun /work/platform-production/heavy/current/run.js [--class suite|browser|build|bench|light] [--host local|pi] [--max-wall <seconds, pi only>] [--state-dir <dir>] [--slice-root <name>] [--log-dir <dir>] [--settings-home <dir>] [--proc <dir>] <label> -- <command…>'
const SLOT_FILES = ['slot1.lock', 'slot2.lock', 'slot3.lock'] as const
const POLL_MS = 1_000
const WAIT_NOTICE_MS = 60_000
const MiB = 2 ** 20
const FLAGS = [
  '--class',
  '--host',
  '--max-wall',
  '--state-dir',
  '--slice-root',
  '--log-dir',
  '--settings-home',
  '--proc',
]

type Classes = SettingValue<'developer.heavyJobClasses'>
type JobClass = keyof Classes
type Budget = Classes[JobClass]

type Options = {
  readonly jobClass: JobClass
  readonly host: Host
  readonly label: string
  readonly command: readonly string[]
  readonly stateDir: string
  /** Job slices are `<root>-<id>.slice` under `<root>.slice`; tests keep their own root. */
  readonly sliceRoot: string
  readonly logDir: string | null
  readonly settingsHome: string
  readonly procRoot: string
  readonly maxWallSec?: number
}

type Config = { readonly classes: Classes; readonly limits: Limits; readonly graceSeconds: number }

try {
  process.exit(await run(parseOptions(Bun.argv.slice(2))))
} catch (error) {
  console.error(scriptFailureText(error))
  process.exit(2)
}

function parseOptions(argv: readonly string[]): Options {
  const flags = new Map<string, string>()
  let index = 0
  while (argv[index]?.startsWith('--') && argv[index] !== '--') {
    const flag = argv[index]!
    const value = argv[index + 1]
    if (!FLAGS.includes(flag) || value === undefined) {
      throw createScriptError(`Unknown or incomplete option ${flag}. ${USAGE}`)
    }
    flags.set(flag, value)
    index += 2
  }
  const label = argv[index]
  const command = argv.slice(argv[index + 1] === '--' ? index + 2 : index + 1)
  if (!label || command.length === 0) throw createScriptError(USAGE)

  const host = flags.get('--host') ?? 'local'
  if (!isHost(host)) {
    throw createScriptError(`Unknown host ${host}. Hosts: ${HOSTS.join(', ')}.`)
  }
  const maxWall = flags.get('--max-wall')
  if (maxWall !== undefined && host !== 'pi') {
    throw createScriptError(
      `--max-wall applies to --host pi, which enforces it on the Pi. ${USAGE}`,
    )
  }
  const maxWallSec = maxWall === undefined ? undefined : Number(maxWall)
  if (maxWallSec !== undefined && (!Number.isSafeInteger(maxWallSec) || maxWallSec <= 0)) {
    throw createScriptError(`--max-wall must be a positive whole number of seconds. ${USAGE}`)
  }
  const jobClass = flags.get('--class') ?? 'suite'
  if (!Object.hasOwn(SETTINGS_REGISTRY['developer.heavyJobClasses'].default, jobClass)) {
    throw createScriptError(`Unknown class ${jobClass}. ${USAGE}`)
  }
  return {
    command,
    host,
    jobClass: jobClass as JobClass,
    label,
    logDir: flags.get('--log-dir') ?? null,
    maxWallSec,
    procRoot: flags.get('--proc') ?? '/proc',
    settingsHome: flags.get('--settings-home') ?? productionStateHome,
    sliceRoot: flags.get('--slice-root') ?? 'heavy',
    stateDir: flags.get('--state-dir') ?? DEFAULT_STATE_DIR,
  }
}

async function run(options: Options) {
  const cwd = process.cwd()
  const id = randomBytes(6).toString('hex')
  const config = readConfig(options.settingsHome)
  const queuedAt = performance.now()
  const placed =
    options.host === 'pi'
      ? await admitPi(options, config, cwd, id)
      : await admitLocal(options, config, cwd, id)
  const queuedMs = Math.round(performance.now() - queuedAt)
  console.error(
    `[wave-heavy] started '${options.label}' on ${options.host} after ${Math.round(queuedMs / 1000)}s: ${placed.reason}`,
  )
  // Released however the launch or the job ends, so a failed launch leaves no admission held.
  try {
    const job = startJob(placed.spec)
    // A signal to this PID alone reaches the job only through its slice. A terminal's Ctrl-C
    // also reaches it directly, so it sees SIGINT twice; one is enough to stop it.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => job.stop(signal))
    }
    const outcome = await job.done
    record(options, { admission: placed.reason, budget: placed.budget, cwd, id, outcome, queuedMs })
    return outcome.exitCode
  } finally {
    placed.release()
  }
}

/** Where a job was admitted, and how to give its place back once it has exited. */
type Placed = {
  readonly spec: JobSpec
  readonly budget: Budget | null
  readonly reason: string
  readonly release: () => void
}

async function admitLocal(
  options: Options,
  config: Config,
  cwd: string,
  id: string,
): Promise<Placed> {
  const budget = config.classes[options.jobClass]
  const entry: Entry = {
    cwd,
    estimateBytes: budget.estimateMiB * MiB,
    id,
    jobClass: options.jobClass,
    label: options.label,
    pid: process.pid,
    since: new Date().toISOString(),
  }
  const admitted = await admit(options, config, entry)
  return {
    budget,
    reason: admitted.reason,
    release: () => {
      release(admitted.held)
      for (const fd of admitted.slots) unlock(fd)
    },
    spec: {
      ceilingBytes: budget.ceilingMiB * MiB,
      command: options.command,
      cwd,
      graceSeconds: config.graceSeconds,
      host: 'local',
      id,
      sliceRoot: options.sliceRoot,
      slotLocks: admitted.slots,
    },
  }
}

// The Pi runs one job at a time under its own ceiling, so this machine's memory is not asked.
async function admitPi(options: Options, config: Config, cwd: string, id: string): Promise<Placed> {
  const { fd, holder } = await acquirePiLane(options.stateDir)
  const since = new Date().toTimeString().slice(0, 8)
  writeFileSync(holder, `${options.label} pid=${process.pid} since=${since} cwd=${cwd}\n`)
  return {
    budget: null,
    reason: 'the Pi lane is free',
    release: () => {
      clearHolder(holder)
      unlock(fd)
    },
    spec: {
      command: options.command,
      cwd,
      graceSeconds: config.graceSeconds,
      host: 'pi',
      id,
      maxWallSec: options.maxWallSec,
    },
  }
}

// The job's exit status is the wrapper's; failing to clear a status line must not replace it.
function clearHolder(holder: string) {
  try {
    writeFileSync(holder, '')
  } catch (error) {
    console.error(`[wave-heavy] could not clear ${holder}: ${scriptFailureText(error)}`)
  }
}

type Admitted = { readonly held: Held; readonly slots: readonly number[]; readonly reason: string }

// Waits first-in first-out: only the head of the queue is considered, so a small job never
// overtakes a large one that is waiting for memory.
async function admit(options: Options, config: Config, entry: Entry): Promise<Admitted> {
  mkdirSync(options.stateDir, { recursive: true })
  for (const slot of SLOT_FILES) writeFileSync(path.join(options.stateDir, slot), '', { flag: 'a' })
  const waiting = enqueue(options.stateDir, entry)
  const started = Date.now()
  let nextNotice = 0
  for (;;) {
    const attempt = attemptAdmission(options, config, waiting)
    if ('held' in attempt) return attempt
    if (Date.now() - started >= nextNotice) {
      console.error(`[wave-heavy] '${options.label}' is waiting: ${attempt.reason}`)
      nextNotice += WAIT_NOTICE_MS
    }
    await Bun.sleep(POLL_MS)
  }
}

function attemptAdmission(
  options: Options,
  config: Config,
  waiting: Held,
): Admitted | { reason: string } {
  const lock = waitLock(path.join(options.stateDir, 'admission.lock'))
  try {
    const ahead = live(options.stateDir, 'queue').findIndex(
      (entry) => entry.id === waiting.entry.id,
    )
    if (ahead > 0) return { reason: `${ahead} job(s) ahead in the queue` }
    const drain = drainRequest(options.stateDir)
    if (drain) return { reason: `draining for ${drain}` }
    const hold = legacyHold(options.stateDir, SLOT_FILES)
    if (hold) return { reason: hold }
    const charges = runningCharges(options)
    const decision = decide(
      waiting.entry.estimateBytes,
      charges,
      readReadings(options.procRoot),
      config.limits,
    )
    if (!decision.admit) return { reason: decision.reason }
    const slots = SLOT_FILES.map((slot) => tryLock(path.join(options.stateDir, slot), 'shared'))
    const taken = slots.filter((fd): fd is number => fd !== null)
    if (taken.length < slots.length) {
      for (const fd of taken) unlock(fd)
      return { reason: 'a slot lock was taken exclusively' }
    }
    return { held: promote(options.stateDir, waiting), reason: decision.reason, slots: taken }
  } finally {
    unlock(lock)
  }
}

/**
 * What each running job is charged. The cgroup tree is what runs: a job slice whose wrapper is
 * gone (no live entry) is an orphan, charged its ceiling while this pass kills and removes it.
 * A job admitted but not yet in its slice is charged through its live entry.
 */
function runningCharges(options: Options) {
  const owned = new Map(live(options.stateDir, 'jobs').map((job) => [job.id, job.estimateBytes]))
  const orphans = liveSlices(options.sliceRoot).filter((slice) => !owned.has(slice.id))
  for (const orphan of orphans) {
    console.error(`[wave-heavy] stopping ${orphan.slice}: its wrapper is gone`)
    reapSlice(orphan.slice)
  }
  return [...owned.values(), ...orphans.map((orphan) => orphan.ceilingBytes)]
}

function readConfig(home: string): Config {
  return {
    classes: setting(home, 'developer.heavyJobClasses'),
    graceSeconds: setting(home, 'developer.heavyJobStopGraceSeconds'),
    limits: {
      cpuLoadLimit: setting(home, 'developer.heavyJobCpuLoadLimit'),
      memoryPressureLimit: setting(home, 'developer.heavyJobMemoryPressureLimit'),
      reserveBytes: setting(home, 'developer.heavyJobMemoryReserveMiB') * MiB,
    },
  }
}

// An unreadable settings file must not stop every heavy job on the machine.
function setting<K extends SettingId>(home: string, id: K): SettingValue<K> {
  try {
    return readHomeSetting(home, id)
  } catch (error) {
    console.error(`[wave-heavy] using the default ${id}: ${scriptFailureText(error)}`)
    return SETTINGS_REGISTRY[id].default as SettingValue<K>
  }
}

// An installed copy has no checkout around it; install.ts writes its commit beside the bundle.
function wrapperCommit() {
  const installed = readText(path.join(import.meta.dirname, 'commit')).trim()
  if (installed) return installed
  return Bun.spawnSync(['git', '-C', import.meta.dirname, 'rev-parse', 'HEAD'])
    .stdout.toString()
    .trim()
}

function readText(file: string) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

type Finished = {
  readonly admission: string
  readonly budget: Budget | null
  readonly cwd: string
  readonly id: string
  readonly outcome: JobOutcome
  readonly queuedMs: number
}

// Logging is best effort: a settings, git or disk failure is reported, and the job's exit
// status still becomes the wrapper's.
function record(options: Options, finished: Finished) {
  try {
    const logDir =
      options.logDir ?? readHomeSetting(options.settingsHome, 'developer.heavyJobLogDirectory')
    appendRecord(logDir, jobRecord(options, finished))
  } catch (error) {
    console.error('[wave-heavy] the job ran but its record was not written:')
    console.error(scriptFailureText(error))
  }
}

function jobRecord(
  options: Options,
  { admission, budget, cwd, id, outcome, queuedMs }: Finished,
): HeavyJobRecord {
  const commitHash = wrapperCommit()
  return {
    action: 'heavy.job',
    admission,
    area: 'heavy-jobs',
    ceilingBytes: budget ? budget.ceilingMiB * MiB : null,
    class: budget ? options.jobClass : null,
    command: redactCommand(options.command),
    commitHash,
    cpuUsageUsec: outcome.cpuUsageUsec,
    cwd,
    estimateBytes: budget ? budget.estimateMiB * MiB : null,
    exitCode: outcome.exitCode,
    host: options.host,
    label: options.label,
    leftoverProcesses: outcome.leftoverProcesses,
    level: outcome.oomKills ? 'warn' : 'info',
    memoryPeakBytes: outcome.memoryPeakBytes,
    oomKills: outcome.oomKills,
    queuedMs,
    requestId: id,
    slice: outcome.slice,
    source: 'heavy',
    timestamp: new Date().toISOString(),
    unit: outcome.unit,
    version: commitHash.slice(0, 9),
    wallMs: outcome.wallMs,
    ...repositoryOf(cwd),
  }
}

// Worktrees of one repository share its common git directory, so lanes group together.
function repositoryOf(cwd: string) {
  const result = Bun.spawnSync(
    ['git', '-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-prefix'],
    { stderr: 'ignore', stdout: 'pipe' },
  )
  if (result.exitCode !== 0) return { repo: null, subdir: null }
  const [commonDir = '', prefix = ''] = result.stdout.toString().split('\n')
  return { repo: commonDir.replace(/\/\.git\/?$/, ''), subdir: prefix.replace(/\/$/, '') }
}

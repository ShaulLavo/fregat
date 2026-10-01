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
import { decide, legacyHold, readReadings, sliceMemory, type Limits } from './admission'
import { HOSTS, isHost, startJob, type Host, type JobOutcome } from './job'
import { tryLock, unlock, waitLock } from './lock'
import { enqueue, live, promote, release, type Entry, type Held } from './queue'
import { appendRecord, redactCommand, type HeavyJobRecord } from './record'

const USAGE =
  'Usage: bun /work/platform-production/heavy/current/run.js [--class suite|browser|build|bench|light] [--host local] [--state-dir <dir>] [--log-dir <dir>] [--settings-home <dir>] [--proc <dir>] <label> -- <command…>'
// Also the directory of the slot locks that tools taking all three for a quiet machine use.
const STATE_DIR = '/work/tmp/wave-heavy'
const SLOT_FILES = ['slot1.lock', 'slot2.lock', 'slot3.lock'] as const
const POLL_MS = 1_000
const WAIT_NOTICE_MS = 60_000
const MiB = 2 ** 20
const FLAGS = ['--class', '--host', '--state-dir', '--log-dir', '--settings-home', '--proc']

type Classes = SettingValue<'developer.heavyJobClasses'>
type JobClass = keyof Classes

type Options = {
  readonly jobClass: JobClass
  readonly host: Host
  readonly label: string
  readonly command: readonly string[]
  readonly stateDir: string
  readonly logDir: string | null
  readonly settingsHome: string
  readonly procRoot: string
}

type Config = { readonly classes: Classes; readonly limits: Limits }

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
    procRoot: flags.get('--proc') ?? '/proc',
    settingsHome: flags.get('--settings-home') ?? productionStateHome,
    stateDir: flags.get('--state-dir') ?? STATE_DIR,
  }
}

async function run(options: Options) {
  const config = readConfig(options.settingsHome)
  const budget = config.classes[options.jobClass]
  const cwd = process.cwd()
  const entry: Entry = {
    cwd,
    estimateBytes: budget.estimateMiB * MiB,
    id: randomBytes(6).toString('hex'),
    jobClass: options.jobClass,
    label: options.label,
    pid: process.pid,
    since: new Date().toISOString(),
  }
  const queuedAt = performance.now()
  const admitted = await admit(options, config, entry)
  const queuedMs = Math.round(performance.now() - queuedAt)
  console.error(
    `[wave-heavy] started '${options.label}' (${options.jobClass}) after ${Math.round(queuedMs / 1000)}s: ${admitted.reason}`,
  )

  const job = startJob({
    ceilingBytes: budget.ceilingMiB * MiB,
    command: options.command,
    cwd,
    host: options.host,
    id: entry.id,
  })
  // A signal to this PID alone reaches the job only through its slice. A terminal's Ctrl-C
  // also reaches it directly, so it sees SIGINT twice; one is enough to stop it.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => job.stop(signal))
  }
  const outcome = await job.done
  record(options, { admission: admitted.reason, budget, cwd, id: entry.id, outcome, queuedMs })
  release(admitted.held)
  for (const fd of admitted.slots) unlock(fd)
  return outcome.exitCode
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
    const hold = legacyHold(options.stateDir, SLOT_FILES)
    if (hold) return { reason: hold }
    const running = live(options.stateDir, 'jobs').map((job) => ({
      currentBytes: sliceMemory(job.id),
      estimateBytes: job.estimateBytes,
    }))
    const decision = decide(
      waiting.entry.estimateBytes,
      running,
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

function readConfig(home: string): Config {
  return {
    classes: setting(home, 'developer.heavyJobClasses'),
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
  readonly budget: Classes[JobClass]
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
    ceilingBytes: budget.ceilingMiB * MiB,
    class: options.jobClass,
    command: redactCommand(options.command),
    commitHash,
    cpuUsageUsec: outcome.cpuUsageUsec,
    cwd,
    estimateBytes: budget.estimateMiB * MiB,
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

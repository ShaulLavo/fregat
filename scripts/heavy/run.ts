#!/usr/bin/env bun
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { constants } from 'node:os'

import {
  SETTINGS_REGISTRY,
  type SettingId,
  type SettingValue,
} from '../../packages/contracts/src/settings/keys'
import { readHomeSetting } from '../home-setting'
import { productionStateHome } from '../state-home'
import { createScriptError, scriptErrors, scriptFailureText } from '../structured-errors'
import {
  allowedDuringQuiet,
  bootSeconds,
  chargeOf,
  decide,
  decideQuiet,
  drainRequest,
  jobsAhead,
  legacyHold,
  orphanSlices,
  readReadings,
  sliceState,
  type Limits,
  type LiveSlice,
} from './admission'
import {
  HOSTS,
  isHost,
  reapSlice,
  removeSlice,
  startJob,
  stopTimeoutSeconds,
  DEADLINE_START_SECONDS,
  type Host,
  type JobOutcome,
  type JobSpec,
} from './job'
import {
  acquirePiLane,
  DEFAULT_STATE_DIR,
  isProductionState,
  PRODUCTION,
  isSliceRoot,
  sliceRootFor,
  type Production,
  tryLock,
  unlessMissing,
  unlock,
} from './lock'
import {
  deadJobs,
  enqueue,
  live,
  promote,
  release,
  type DeadJob,
  type Entry,
  type Held,
} from './queue'
import {
  appendRecord,
  redactCommand,
  type HeavyJobRecord,
  type JobDuringRun,
  type ServerAtAdmission,
} from './record'
import { beginRun, finishRun, isActiveQuietRun, stopRunConcurrency } from './runtime'

const USAGE =
  'Usage: bun /work/platform-production/heavy/current/run.js [--class suite|browser|build|bench|light] [--quiet | --server] [--host local|pi] [--max-wall <seconds, pi only>] [--state-dir <dir>] [--slice-root <name>] [--production-state-dir <dir>] [--production-slice-root <name>] [--log-dir <dir>] [--settings-home <dir>] [--proc <dir>] <label> -- <command…>'
const SLOT_FILES = ['slot1.lock', 'slot2.lock', 'slot3.lock'] as const
const POLL_MS = 1_000
const WAIT_NOTICE_MS = 60_000
// rev-parse answers in about a millisecond; a git still running after this is stuck, and the
// wrapper holds its admission while it waits.
const GIT_TIMEOUT_MS = 250
const MiB = 2 ** 20
// EX_TEMPFAIL: an expired quiet admission or running hold needs a fresh queue ticket.
const RETRY_EXIT = 75
const FLAGS = [
  '--class',
  '--host',
  '--max-wall',
  '--state-dir',
  '--slice-root',
  '--production-state-dir',
  '--production-slice-root',
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
  /** Drains finite jobs; admission and execution each get one quiet hold. */
  readonly quiet: boolean
  /** A long-lived local server, charged for memory and excluded from quiet draining. */
  readonly server: boolean
  /** Job slices are `<root>-<id>.slice` under `<root>.slice`; tests keep their own root. */
  readonly sliceRoot: string
  readonly logDir: string | null
  readonly settingsHome: string
  readonly procRoot: string
  readonly maxWallSec?: number
}

type Config = {
  readonly classes: Classes
  readonly limits: Limits
  readonly graceSeconds: number
  readonly quietHoldSeconds: number
  readonly quietPolicy: SettingValue<'developer.heavyJobQuietPolicy'>
}

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
    if (flag === '--quiet' || flag === '--server') {
      flags.set(flag, '')
      index += 1
      continue
    }
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
  const quiet = flags.has('--quiet')
  if (quiet && host === 'pi') {
    throw createScriptError(
      `--quiet applies to this machine; the Pi lane already runs one job at a time. ${USAGE}`,
    )
  }
  const server = flags.has('--server')
  if (server && (quiet || host === 'pi')) {
    throw createScriptError(
      `--server declares a local dev server; --quiet and --host pi run finite jobs. ${USAGE}`,
    )
  }
  const jobClass = flags.get('--class') ?? 'suite'
  if (!Object.hasOwn(SETTINGS_REGISTRY['developer.heavyJobClasses'].default, jobClass)) {
    throw createScriptError(`Unknown class ${jobClass}. ${USAGE}`)
  }
  const stateDir = flags.get('--state-dir') ?? DEFAULT_STATE_DIR
  return {
    command,
    host,
    jobClass: jobClass as JobClass,
    label,
    logDir: flags.get('--log-dir') ?? null,
    maxWallSec,
    procRoot: flags.get('--proc') ?? '/proc',
    quiet,
    server,
    settingsHome: flags.get('--settings-home') ?? productionStateHome,
    sliceRoot: sliceRootOption(flags.get('--slice-root'), stateDir, {
      root: flags.get('--production-slice-root') ?? PRODUCTION.root,
      stateDir: flags.get('--production-state-dir') ?? PRODUCTION.stateDir,
    }),
    stateDir,
  }
}

// Production's root pairs only with production's state directory: a wrapper with any other
// state directory would find no owner for production's slices and stop them. Tests name a
// private stand-in as production, so a broken guard can only reach the stand-in.
function sliceRootOption(given: string | undefined, stateDir: string, production: Production) {
  // The directory must exist for its identity to decide its root.
  mkdirSync(stateDir, { recursive: true })
  const root = given ?? sliceRootFor(stateDir, production)
  if (!isSliceRoot(root)) {
    throw createScriptError(
      `--slice-root takes lowercase letters and digits; got ${root}. ${USAGE}`,
    )
  }
  if (root === production.root && !isProductionState(stateDir, production)) {
    throw createScriptError(
      `--slice-root ${production.root} belongs to the state directory ${production.stateDir}; another state directory gets its own root. ${USAGE}`,
    )
  }
  return root
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
  if ('cancelled' in placed) return 128 + constants.signals[placed.cancelled]
  if ('retry' in placed) {
    console.error(
      `[wave-heavy] quiet admission for '${options.label}' expired: ${placed.reason}. Run it again to queue for another admission window.`,
    )
    return RETRY_EXIT
  }
  const queuedMs = Math.round(performance.now() - queuedAt)
  console.error(
    `[wave-heavy] started '${options.label}' on ${options.host} after ${Math.round(queuedMs / 1000)}s: ${placed.reason}`,
  )
  // Released however the launch or the job ends, so a failed launch leaves no admission held.
  try {
    // Read before launch: the job, or another session, may commit while it runs.
    const checkout = repositoryOf(cwd)
    const job = startJob(
      placed.spec,
      (launch) => (placed.entry ? beginRun(options.stateDir, placed.entry, launch) : launch()),
      () => {
        if (placed.entry?.quiet) stopRunConcurrency(options.stateDir, placed.entry.id)
      },
    )
    // A signal to this PID alone reaches the job only through its slice. A terminal's Ctrl-C
    // also reaches it directly, so it sees SIGINT twice; one is enough to stop it.
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => job.stop(signal))
    }
    const holdMs = config.quietHoldSeconds * 1000
    const deadline = placed.spec.host === 'local' ? placed.spec.runtimeDeadline : undefined
    const remainingHoldMs =
      deadline === undefined ? holdMs : Math.max(0, deadline - bootSeconds()) * 1000
    let stoppedAtHold = false
    const hold = options.quiet
      ? setTimeout(() => {
          stoppedAtHold = true
          job.stop('SIGTERM')
        }, remainingHoldMs)
      : undefined
    const outcome = await job.done
    clearTimeout(hold)
    // systemd ends the scope at the hold too, so a run this process slept through counts.
    const holdExpired =
      options.quiet && (stoppedAtHold || (deadline !== undefined && bootSeconds() >= deadline))
    if (holdExpired) {
      console.error(
        `[wave-heavy] quiet hold for '${options.label}' reached its ${config.quietHoldSeconds} s limit (developer.heavyJobQuietHoldSeconds), so the job was stopped. Run it again to queue for another hold.`,
      )
    }
    record(options, {
      admission: placed.reason,
      allowedCpus: placed.entry?.allowedCpus ?? [],
      budget: placed.budget,
      checkout,
      cwd,
      holdExpired,
      id,
      jobsDuringRun: placed.entry ? finishRun(options.stateDir, id) : [],
      outcome,
      queuedMs,
      serversAtAdmission: placed.serversAtAdmission,
    })
    return holdExpired ? RETRY_EXIT : outcome.exitCode
  } finally {
    try {
      if (placed.entry) finishRun(options.stateDir, id)
    } finally {
      placed.release()
    }
  }
}

/** Where a job was admitted, and how to give its place back once it has exited. */
type Placed = {
  readonly entry: Entry | null
  readonly spec: JobSpec
  readonly serversAtAdmission: readonly ServerAtAdmission[]
  readonly budget: Budget | null
  readonly reason: string
  readonly release: () => void
}

async function admitLocal(
  options: Options,
  config: Config,
  cwd: string,
  id: string,
): Promise<Placed | Deferred | Cancelled> {
  const budget = config.classes[options.jobClass]
  const entry: Entry = {
    allowedCpus: options.quiet
      ? config.quietPolicy.measurementCpus
      : config.quietPolicy.concurrentCpus,
    cwd,
    estimateBytes: budget.estimateMiB * MiB,
    id,
    jobClass: options.jobClass,
    label: options.label,
    pid: process.pid,
    quiet: options.quiet,
    server: options.server,
    since: new Date().toISOString(),
    sliceRoot: options.sliceRoot,
  }
  const admitted = await admit(options, config, entry)
  if ('retry' in admitted || 'cancelled' in admitted) return admitted
  if (options.quiet) {
    writeFileSync(
      path.join(options.stateDir, 'quiet.holder'),
      `${options.label} id=${id} pid=${process.pid} since=${new Date().toISOString()} cwd=${cwd}\n`,
    )
  }
  return {
    entry: admitted.held.entry,
    budget,
    reason: admitted.reason,
    serversAtAdmission: admitted.serversAtAdmission,
    release: () => {
      if (options.quiet) clearQuietHolder(options.stateDir, (holder) => holder === id)
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
      runtimeLimitSeconds: options.quiet ? config.quietHoldSeconds : null,
      runtimeDeadline: admitted.held.entry.quietDeadline,
      entryLock: admitted.held.fd,
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
    entry: null,
    reason: 'the Pi lane is free',
    serversAtAdmission: [],
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

type Cancelled = { readonly cancelled: NodeJS.Signals }
type Deferred = { readonly retry: true; readonly reason: string }
type Blocked = { readonly reason: string; readonly quiet?: Entry }
type Admitted = {
  readonly held: Held
  readonly slots: readonly number[]
  readonly reason: string
  readonly serversAtAdmission: readonly ServerAtAdmission[]
}

// FIFO among eligible jobs. An active wrapper quiet hold lets its allowed classes pass
// held classes; ordinary admission and quiet draining retain the full queue order.
async function admit(
  options: Options,
  config: Config,
  entry: Entry,
): Promise<Admitted | Deferred | Cancelled> {
  mkdirSync(options.stateDir, { recursive: true })
  for (const slot of SLOT_FILES) writeFileSync(path.join(options.stateDir, slot), '', { flag: 'a' })
  const waiting = enqueue(options.stateDir, {
    ...entry,
    ...(entry.quiet ? { quietAdmissionUntil: bootSeconds() + config.quietHoldSeconds } : {}),
  })
  const started = performance.now()
  let nextNotice = 0
  let promoted = false
  const cancellation = new AbortController()
  const cancellations = (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => {
    const handler = () => cancellation.abort(signal)
    process.on(signal, handler)
    return { signal, handler }
  })
  try {
    for (;;) {
      if (cancellation.signal.aborted)
        return { cancelled: cancellation.signal.reason as NodeJS.Signals }
      const expired = expiredAdmission(waiting.entry, config.quietHoldSeconds)
      if (expired) return expired
      const attempt = await attemptAdmission(options, config, waiting, cancellation.signal)
      if ('held' in attempt) {
        promoted = true
        return attempt
      }
      if (cancellation.signal.aborted)
        return { cancelled: cancellation.signal.reason as NodeJS.Signals }
      if ('retry' in attempt) return attempt
      const elapsedMs = performance.now() - started
      // A healthy predecessor owns its full startup, runtime and cleanup budget.
      if (
        attempt.quiet &&
        elapsedMs >= config.quietHoldSeconds * 1000 &&
        bootSeconds() >= (attempt.quiet.quietUntil ?? 0)
      ) {
        const predecessor = attempt.quiet
        const slice = `${predecessor.sliceRoot}-${predecessor.id}.slice`
        const state = sliceState(predecessor.sliceRoot, slice)
        console.error(`[wave-heavy] warn: quiet lease '${predecessor.label}' still holds admission`)
        throw scriptErrors.HEAVY_QUIET_BLOCKED({
          label: predecessor.label,
          slice,
          state,
          internal: { elapsedMs, predecessorId: predecessor.id, sliceState: state },
        })
      }
      if (elapsedMs >= nextNotice) {
        console.error(`[wave-heavy] '${options.label}' is waiting: ${attempt.reason}`)
        nextNotice += WAIT_NOTICE_MS
      }
      await Bun.sleep(POLL_MS)
    }
  } finally {
    for (const { signal, handler } of cancellations) process.off(signal, handler)
    if (!promoted) release(waiting)
  }
}

function expiredAdmission(entry: Entry, seconds: number): Deferred | null {
  if (entry.quietAdmissionUntil === undefined || bootSeconds() < entry.quietAdmissionUntil)
    return null
  return {
    retry: true,
    reason: `wait reached its ${seconds} s limit (developer.heavyJobQuietHoldSeconds)`,
  }
}

async function attemptAdmission(
  options: Options,
  config: Config,
  waiting: Held,
  cancellation: AbortSignal,
): Promise<Admitted | Deferred | Blocked> {
  const lock = tryLock(path.join(options.stateDir, 'admission.lock'))
  if (lock === null) return { reason: 'another wrapper is admitting a job' }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const controller = new AbortController()
    const remaining = (waiting.entry.quietAdmissionUntil ?? Infinity) - bootSeconds()
    timeout = setTimeout(
      () => controller.abort(),
      Math.max(0, Math.min(remaining, stopTimeoutSeconds(config.graceSeconds)) * 1000),
    )
    const signal = AbortSignal.any([cancellation, controller.signal])
    // Reconciliation shares one stop budget, shortened to the quiet admission's remainder.
    const running = await reconcile(options, config.graceSeconds, signal)
    const expired = expiredAdmission(waiting.entry, config.quietHoldSeconds)
    if (expired) return expired
    const quiet = running.quietHolders[0]
    // Dead or preparing owners and unfinished manager cleanup retain the parent's quiet gate.
    if (
      quiet &&
      (running.quietHolders.length !== 1 ||
        !running.owners.some((owner) => owner.id === quiet.id) ||
        !isActiveQuietRun(options.stateDir, quiet))
    )
      return { reason: `quiet hold by '${quiet.label}' since ${quiet.since}`, quiet }
    if (signal.aborted) return { reason: 'orphan reconciliation was interrupted' }
    const allowedClasses = config.quietPolicy.allowedClasses
    const ahead = jobsAhead(
      live(options.stateDir, 'queue'),
      waiting.entry,
      Boolean(quiet),
      allowedClasses,
    )
    if (ahead > 0) return { reason: `${ahead} job(s) ahead in the queue` }
    const drain = drainRequest(options.stateDir, config.quietHoldSeconds * 1000)
    if (drain) return { reason: `draining for ${drain}` }
    const hold = legacyHold(options.stateDir, SLOT_FILES)
    if (hold) return { reason: hold }
    if (quiet && !allowedDuringQuiet(waiting.entry, allowedClasses))
      return { reason: `quiet hold by '${quiet.label}' since ${quiet.since}`, quiet }
    const now = bootSeconds()
    const serversAtAdmission = running.owners
      .filter((job) => job.server)
      .map(({ id, label, pid, cwd, sliceRoot, allowedCpus = [] }) => ({
        id,
        label,
        pid,
        cwd,
        sliceRoot,
        allowedCpus,
      }))
    const drained = waiting.entry.quiet
      ? decideQuiet(
          running.owners.length - serversAtAdmission.length + running.orphanCharges.length,
        )
      : null
    if (drained && !drained.admit) return { reason: drained.reason }
    const decision = decide(
      waiting.entry.estimateBytes,
      [...running.orphanCharges, ...ownerCharges(running.owners)],
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
    const lease = waiting.entry.quiet
      ? {
          quietDeadline: now + config.quietHoldSeconds,
          quietUntil:
            now +
            DEADLINE_START_SECONDS +
            config.quietHoldSeconds +
            stopTimeoutSeconds(config.graceSeconds),
        }
      : {}
    const expiredBeforePromotion = expiredAdmission(waiting.entry, config.quietHoldSeconds)
    if (expiredBeforePromotion) {
      for (const fd of taken) unlock(fd)
      return expiredBeforePromotion
    }
    if (quiet && !isActiveQuietRun(options.stateDir, quiet)) {
      for (const fd of taken) unlock(fd)
      return { reason: `quiet hold by '${quiet.label}' since ${quiet.since}`, quiet }
    }
    const held = promote(options.stateDir, waiting, lease)
    // Servers pass the external-lock admission gate, then retain only their entry lock.
    if (waiting.entry.server) for (const fd of taken) unlock(fd)
    const quietReason = serversAtAdmission.length
      ? `finite jobs drained; ${serversAtAdmission.length} server(s) running; ${decision.reason}`
      : 'the machine is quiet'
    return {
      held,
      reason: drained ? quietReason : decision.reason,
      serversAtAdmission,
      slots: waiting.entry.server ? [] : taken,
    }
  } finally {
    clearTimeout(timeout)
    unlock(lock)
  }
}

/**
 * Reaps orphans: job slices whose wrapper is gone (`orphanSlices`). Each is charged its
 * ceiling less its use, read before the kill; if the kill fails it may still grow that far.
 */
async function reconcile(options: Options, graceSeconds: number, signal: AbortSignal) {
  const owners = live(options.stateDir, 'jobs')
  const dead = deadJobs(options.stateDir)
  const orphans = orphanSlices(options.sliceRoot, owners, dead)
  const orphanCharges = orphans.map((orphan) =>
    chargeOf(orphan.root, orphan.slice, orphan.ceilingBytes),
  )
  for (const orphan of orphans) {
    if (signal.aborted) break
    await reapOrphan(options.stateDir, orphan, graceSeconds, signal)
  }
  forgetStoppedFailures(options.stateDir)
  for (const job of dead) {
    if (signal.aborted) break
    await settleDeadEntry(job, signal)
  }
  // A dead quiet entry remains until its slice is empty and the manager has stopped it.
  const quietHolders = [
    ...owners.filter((job) => job.quiet),
    ...dead.flatMap((job) =>
      job.attributable && job.entry.quiet && existsSync(job.file) ? [job.entry] : [],
    ),
  ]
  clearQuietHolder(options.stateDir, (holder) => !quietHolders.some((job) => job.id === holder))
  return { orphanCharges, owners, quietHolders }
}

// A slice that outlives its stop stays charged and is retried quietly on each later pass. A
// marker under `reaping/` keeps the series across wrappers: one warning when it starts, one
// error once the stop timeout has passed, each naming the slice and how to stop it by hand.
async function reapOrphan(
  stateDir: string,
  orphan: LiveSlice,
  graceSeconds: number,
  signal: AbortSignal,
) {
  const marker = path.join(stateDir, 'reaping', orphan.slice)
  const failing = readText(marker).trim()
  if (!failing) console.error(`[wave-heavy] stopping ${orphan.slice}: its wrapper is gone`)
  await reapSlice(orphan.root, orphan.slice, signal)
  if (sliceState(orphan.root, orphan.slice) !== 'running') return rmSync(marker, { force: true })
  const now = bootSeconds()
  if (!failing) {
    mkdirSync(path.dirname(marker), { recursive: true })
    writeFileSync(marker, `${now} warned`)
    console.error(
      `[wave-heavy] warn: ${orphan.slice} is still running after a stop; later admissions retry it and count its memory`,
    )
    return
  }
  const [since = '0', reported] = failing.split(' ')
  if (reported === 'error' || now - Number(since) < stopTimeoutSeconds(graceSeconds)) return
  writeFileSync(marker, `${since} error`)
  console.error(
    `[wave-heavy] error: ${orphan.slice} is still running ${Math.round(now - Number(since))} s after its first stop; stop it with: systemctl --user stop ${orphan.slice}`,
  )
}

// A slice that stopped some other way ends its failure series.
function forgetStoppedFailures(stateDir: string) {
  const dir = path.join(stateDir, 'reaping')
  for (const slice of unlessMissing(() => readdirSync(dir)) ?? []) {
    const root = slice.slice(0, slice.lastIndexOf('-'))
    if (isSliceRoot(root) && sliceState(root, slice) === 'running') continue
    rmSync(path.join(dir, slice), { force: true })
  }
}

// A dead entry is the only record of a slice on another root. Keep it until its cgroup is
// drained and manager cleanup succeeds; an unattributable entry names nothing and is dropped.
async function settleDeadEntry(job: DeadJob, signal: AbortSignal) {
  if (!job.attributable) {
    console.error(`[wave-heavy] dropped ${job.file}: not a job entry a wrapper wrote`)
    return rmSync(job.file, { force: true })
  }
  const slice = `${job.entry.sliceRoot}-${job.entry.id}.slice`
  const state = sliceState(job.entry.sliceRoot, slice)
  if (state === 'running') return
  if (!(await removeSlice(slice, signal))) return
  rmSync(job.file, { force: true })
}

// The part of each live job's estimate it may still claim, by the slice root it runs under; a
// job admitted but not yet in its slice is charged its whole estimate. Read beside
// MemAvailable: both move while jobs run.
function ownerCharges(owners: readonly Entry[]) {
  return owners.map((job) =>
    chargeOf(job.sliceRoot, `${job.sliceRoot}-${job.id}.slice`, job.estimateBytes),
  )
}

// The holder line names its job; it is cleared only when that job qualifies, so clearing a
// stale line cannot erase a newer holder's.
function clearQuietHolder(stateDir: string, stale: (id: string) => boolean) {
  const file = path.join(stateDir, 'quiet.holder')
  const named = /\bid=(\S+)/.exec(readText(file))?.[1]
  if (named && stale(named)) clearHolder(file)
}

function readConfig(home: string): Config {
  return {
    classes: setting(home, 'developer.heavyJobClasses'),
    graceSeconds: setting(home, 'developer.heavyJobStopGraceSeconds'),
    quietHoldSeconds: setting(home, 'developer.heavyJobQuietHoldSeconds'),
    quietPolicy: setting(home, 'developer.heavyJobQuietPolicy'),
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
  return gitOutput(['-C', import.meta.dirname, 'rev-parse', 'HEAD'])?.trim() ?? ''
}

function readText(file: string) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

type Finished = {
  readonly allowedCpus: readonly number[]
  readonly jobsDuringRun: readonly JobDuringRun[]
  readonly admission: string
  readonly budget: Budget | null
  readonly checkout: ReturnType<typeof repositoryOf>
  readonly cwd: string
  readonly holdExpired: boolean
  readonly id: string
  readonly outcome: JobOutcome
  readonly queuedMs: number
  readonly serversAtAdmission: readonly ServerAtAdmission[]
}

// Logging is best effort: a settings or disk failure is reported, and the job's exit
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
  {
    admission,
    allowedCpus,
    budget,
    checkout,
    cwd,
    holdExpired,
    id,
    jobsDuringRun,
    outcome,
    queuedMs,
    serversAtAdmission,
  }: Finished,
): HeavyJobRecord {
  const wrapper = wrapperCommit()
  return {
    action: 'heavy.job',
    allowedCpus,
    jobsDuringRun,
    admission,
    area: 'heavy-jobs',
    ceilingBytes: budget ? budget.ceilingMiB * MiB : null,
    class: budget ? options.jobClass : null,
    command: redactCommand(options.command),
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
    quiet: options.quiet,
    quietHoldExpired: holdExpired,
    server: options.server,
    serversAtAdmission,
    requestId: id,
    slice: outcome.slice,
    source: 'heavy',
    timestamp: new Date().toISOString(),
    unit: outcome.unit,
    version: wrapper.slice(0, 9),
    wallMs: outcome.wallMs,
    ...checkout,
  }
}

// Worktrees of one repository share its common git directory, so lanes group together; each
// worktree has its own HEAD, which is the commit the job runs.
function repositoryOf(cwd: string) {
  const output = gitOutput([
    '-C',
    cwd,
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
    '--show-prefix',
    'HEAD',
  ])
  if (output === null) return { commitHash: null, repo: null, subdir: null }
  const [commonDir = '', prefix = '', head = ''] = output.split('\n')
  return {
    commitHash: head,
    repo: commonDir.replace(/\/\.git\/?$/, ''),
    subdir: prefix.replace(/\/$/, ''),
  }
}

// Git's output, or null when git fails, is not installed, or outlives GIT_TIMEOUT_MS. Only the
// launch sits in the try, so a bug here still surfaces.
function gitOutput(args: readonly string[]) {
  const options = { stderr: 'ignore', stdout: 'pipe', timeout: GIT_TIMEOUT_MS } as const
  const result = unlessLaunchFails(() => Bun.spawnSync(['git', ...args], options))
  return result?.success ? result.stdout.toString() : null
}

function unlessLaunchFails<T>(launch: () => T): T | null {
  try {
    return launch()
  } catch {
    return null
  }
}

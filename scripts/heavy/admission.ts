import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'

import { tryLock, unlessMissing, unlock } from './lock'
import type { DeadJob } from './queue'

const MiB = 2 ** 20

/** The machine as admission sees it, read from `/proc` (or a test's stand-in). */
export type Readings = {
  readonly memAvailableBytes: number
  /** `some avg10` of /proc/pressure/memory, in percent. */
  readonly memoryPressure: number
  /** One-minute load average per core. */
  readonly cpuLoad: number
}

export type Limits = {
  readonly reserveBytes: number
  readonly memoryPressureLimit: number
  readonly cpuLoadLimit: number
}

export type Decision = { readonly admit: boolean; readonly reason: string }

/**
 * Whether a job with this estimate may start beside running jobs charged `charges` bytes each:
 * the memory each may still claim (`chargeOf`). What they already use is missing from
 * MemAvailable, so charging it again would count it twice. A job always starts when none runs,
 * since waiting would not free anything.
 */
export function decide(
  estimateBytes: number,
  charges: readonly number[],
  readings: Readings,
  limits: Limits,
): Decision {
  if (charges.length === 0) return { admit: true, reason: 'no heavy job is running' }
  const committed = charges.reduce((total, charge) => total + charge, 0)
  const free = readings.memAvailableBytes - committed - limits.reserveBytes
  if (free < estimateBytes) {
    return {
      admit: false,
      reason: `memory: ${mib(free)} MiB free after ${charges.length} running job(s) and the reserve, ${mib(estimateBytes)} MiB needed`,
    }
  }
  if (readings.memoryPressure >= limits.memoryPressureLimit) {
    return {
      admit: false,
      reason: `memory pressure ${readings.memoryPressure}% ≥ ${limits.memoryPressureLimit}%`,
    }
  }
  if (readings.cpuLoad >= limits.cpuLoadLimit) {
    return {
      admit: false,
      reason: `CPU load ${readings.cpuLoad.toFixed(2)} per core ≥ ${limits.cpuLoadLimit}`,
    }
  }
  return { admit: true, reason: `${mib(free)} MiB free covers ${mib(estimateBytes)} MiB` }
}

/**
 * Whether finite work has drained for a `--quiet` job; declared servers are counted separately.
 * Jobs queued behind it wait meanwhile, so the running ones drain.
 */
export function decideQuiet(running: number): Decision {
  if (running === 0) return { admit: true, reason: 'the machine is quiet' }
  return { admit: false, reason: `quiet: waiting for ${running} running job(s) to finish` }
}

export function readReadings(procRoot: string): Readings {
  const meminfo = readFileSync(path.join(procRoot, 'meminfo'), 'utf8')
  const available = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo)?.[1]
  const pressure = readFileSync(path.join(procRoot, 'pressure', 'memory'), 'utf8')
  const some = /^some avg10=([\d.]+)/m.exec(pressure)?.[1]
  const load = readFileSync(path.join(procRoot, 'loadavg'), 'utf8').split(' ')[0]
  return {
    cpuLoad: Number(load) / availableParallelism(),
    memAvailableBytes: Number(available) * 1024,
    memoryPressure: Number(some),
  }
}

/** A job slice under the slice root, as the cgroup tree shows it. */
export type LiveSlice = {
  readonly id: string
  readonly root: string
  readonly slice: string
  readonly ceilingBytes: number
}

/**
 * Every `<root>-<id>.slice` under `<root>.slice` with a process in it: the cgroup tree is what
 * runs, whatever happened to the wrappers. A slice removed during the scan is gone.
 */
export function liveSlices(root: string): LiveSlice[] {
  const prefix = `${root}-`
  return (unlessGone(() => readdirSync(sliceRootPath(root))) ?? [])
    .filter((name) => name.startsWith(prefix) && name.endsWith('.slice'))
    .flatMap((slice) => liveSlice(root, slice) ?? [])
}

/** The slice if a process runs in it. */
function liveSlice(root: string, slice: string): LiveSlice | null {
  if (sliceState(root, slice) !== 'running') return null
  const max = unlessGone(() =>
    readFileSync(path.join(sliceRootPath(root), slice, 'memory.max'), 'utf8'),
  )
  if (max === null) return null
  const id = slice.slice(`${root}-`.length, -'.slice'.length)
  return { ceilingBytes: Number(max.trim()) || 0, id, root, slice }
}

/**
 * Whether a process runs in the slice, it is empty, or its cgroup is gone. A slice whose
 * processes have all exited runs nothing; systemd may keep it, or even its cgroup, after that.
 */
export function sliceState(root: string, slice: string): 'running' | 'empty' | 'gone' {
  const events = unlessGone(() =>
    readFileSync(path.join(sliceRootPath(root), slice, 'cgroup.events'), 'utf8'),
  )
  if (events === null) return 'gone'
  return events.includes('populated 1') ? 'running' : 'empty'
}

/**
 * Slices left running by dead wrappers that this state directory can attribute: the one each
 * attributable dead entry names, on whatever root it ran, unless a live entry owns that id;
 * and any slice under `root` no live entry owns. No other root is scanned, so another state
 * directory's slices are never taken for orphans.
 */
export function orphanSlices(
  root: string,
  owners: readonly { readonly id: string }[],
  dead: readonly DeadJob[],
): LiveSlice[] {
  const owned = (id: string) => owners.some((job) => job.id === id)
  const named = dead.flatMap((job) =>
    job.attributable && !owned(job.entry.id)
      ? (liveSlice(job.entry.sliceRoot, `${job.entry.sliceRoot}-${job.entry.id}.slice`) ?? [])
      : [],
  )
  const unowned = liveSlices(root).filter(
    (slice) => !owned(slice.id) && !named.some((n) => n.slice === slice.slice),
  )
  return [...named, ...unowned]
}

/** The slice's `memory.current`, or null once it is gone. */
export function sliceMemory(root: string, slice: string) {
  const text = unlessGone(() =>
    readFileSync(path.join(sliceRootPath(root), slice, 'memory.current'), 'utf8'),
  )
  return text === null ? null : Number(text)
}

/**
 * What a running slice may still claim of `bound` (its estimate, or an orphan's ceiling): the
 * bound less what it uses. A slice with no cgroup yet is charged the whole bound.
 */
export function chargeOf(
  root: string,
  slice: string,
  bound: number,
  readStat: typeof sliceStat = sliceStat,
) {
  const stat = readStat(root, slice)
  if (stat === null) return bound
  // si_mem_available() counts the file LRU and reclaimable slab as available; the rest of
  // memory.current (anon, shmem, other kernel memory) is already missing from MemAvailable.
  const used =
    stat.current -
    (stat.active_file ?? 0) -
    (stat.inactive_file ?? 0) -
    (stat.slab_reclaimable ?? 0)
  return Math.max(0, bound - used)
}

/** The slice's `memory.current` and `memory.stat` counters, in bytes; null once it is gone. */
export function sliceStat(root: string, slice: string): Record<string, number> | null {
  const dir = path.join(sliceRootPath(root), slice)
  const current = unlessGone(() => readFileSync(path.join(dir, 'memory.current'), 'utf8'))
  const stat = unlessGone(() => readFileSync(path.join(dir, 'memory.stat'), 'utf8'))
  if (current === null || stat === null) return null
  const counters: Record<string, number> = { current: Number(current) }
  for (const line of stat.trim().split('\n')) {
    const [name = '', value = ''] = line.split(' ')
    counters[name] = Number(value)
  }
  return counters
}

// A cgroup removed under a read reports ENOENT, or ENODEV once the file was already open.
function unlessGone<T>(read: () => T): T | null {
  try {
    return read()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENODEV') return null
    throw error
  }
}

function sliceRootPath(root: string) {
  const uid = process.getuid?.() ?? 0
  return `/sys/fs/cgroup/user.slice/user-${uid}.slice/user@${uid}.service/${root}.slice`
}

/**
 * Who asked this machine to drain, or null. An external tool that needs it quiet writes
 * `drain.request` as `pid=<pid> since=<time> holder=<who>`; while that process lives, no
 * new job starts and the running ones finish, for at most `maxAgeMs` (one quiet hold).
 * The age runs on the boot clock from the first time a wrapper saw the request, so no clock
 * in the file, set forward or rolled back, can stretch it. A request is its process (PID and
 * start time) and its file; one whose process has exited, or whose PID now belongs to a
 * different process, is ignored. Writing a new file starts a new hold.
 */
export function drainRequest(stateDir: string, maxAgeMs: number): string | null {
  const file = path.join(stateDir, 'drain.request')
  const seenFile = path.join(stateDir, 'drain.seen')
  const text = unlessMissing(() => readFileSync(file, 'utf8'))
  const inode = unlessMissing(() => statSync(file).ino)
  const pid = Number(/\bpid=(\d+)/.exec(text ?? '')?.[1])
  const started = pid ? processStart(pid) : null
  if (text === null || inode === null || started === null) return null
  const [seenPid, seenStart, seenInode, seenAt] = (
    unlessMissing(() => readFileSync(seenFile, 'utf8')) ?? ''
  )
    .trim()
    .split(' ')
  const sameRequest = seenPid === String(pid) && seenInode === String(inode)
  if (sameRequest && seenStart !== started) return null
  const now = bootSeconds()
  const since = sameRequest ? Number(seenAt) : now
  if (!sameRequest) writeFileSync(seenFile, `${pid} ${started} ${inode} ${now}`)
  if ((now - since) * 1000 > maxAgeMs) return null
  return text.trim()
}

// Field 22 of /proc/<pid>/stat: when the process started, in clock ticks since boot.
function processStart(pid: number) {
  const stat = unlessMissing(() => readFileSync(`/proc/${pid}/stat`, 'utf8'))
  if (stat === null) return null
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null
}

/** Seconds since boot: a clock no wall-clock change can move. */
export function bootSeconds() {
  return Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0])
}

/**
 * Why the legacy slot locks forbid a start, or null. Running jobs hold all three shared, so
 * a tool that takes them exclusively waits for the running jobs to drain; once it waits
 * (a blocked request in /proc/locks) or holds them, no further job starts. All three held
 * exclusively is another tool's quiet hold, which this wrapper cannot bound.
 */
export function legacyHold(stateDir: string, slots: readonly string[]): string | null {
  const quiet = legacyQuietHold(stateDir, slots)
  if (quiet) {
    return `quiet hold by another tool (pid ${quiet.pids.join(', ')}), unbounded, for ${quiet.ageSeconds}s`
  }
  const inodes = new Set(slots.map((slot) => statSync(path.join(stateDir, slot)).ino))
  if (lockRequests().some((request) => request.blocked && inodes.has(request.inode))) {
    return 'another tool is waiting for the slot locks exclusively'
  }
  for (const slot of slots) {
    const fd = tryLock(path.join(stateDir, slot), 'shared')
    if (fd === null) return `${slot} is held exclusively`
    unlock(fd)
  }
  return null
}

/**
 * Another tool's quiet hold, or null: every slot lock held exclusively, which this wrapper
 * never does. Its age runs from the first time any wrapper saw it (`legacy-hold.since`).
 */
export function legacyQuietHold(stateDir: string, slots: readonly string[]) {
  const marker = path.join(stateDir, 'legacy-hold.since')
  const inodes = slots.map((slot) => statSync(path.join(stateDir, slot)).ino)
  const holders = lockRequests().filter(
    (request) => !request.blocked && request.write && inodes.includes(request.inode),
  )
  if (!inodes.every((inode) => holders.some((request) => request.inode === inode))) {
    rmSync(marker, { force: true })
    return null
  }
  const seen = Number(unlessMissing(() => readFileSync(marker, 'utf8')))
  const since = seen || Date.now()
  if (!seen) writeFileSync(marker, String(since))
  return {
    ageSeconds: Math.round((Date.now() - since) / 1000),
    pids: [...new Set(holders.map((request) => request.pid))],
  }
}

// `N: [-> ]FLOCK ADVISORY READ|WRITE <pid> <maj>:<min>:<inode> 0 EOF`; `->` marks a request
// that is blocked waiting for the lock.
function lockRequests() {
  return readFileSync('/proc/locks', 'utf8')
    .split('\n')
    .filter((line) => line.includes('FLOCK'))
    .map((line) => {
      const fields = line.trim().split(/\s+/)
      const at = fields[1] === '->' ? 1 : 0
      return {
        blocked: at === 1,
        inode: Number(fields[5 + at]?.split(':')[2]),
        pid: Number(fields[4 + at]),
        write: fields[3 + at] === 'WRITE',
      }
    })
}

function mib(bytes: number) {
  return Math.round(bytes / MiB)
}

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'

import { processExists } from '../../apps/server/scripts/process-exists'
import { tryLock, unlessMissing, unlock } from './lock'

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
 * Whether a job with this estimate may start beside running jobs charged `charges` bytes each
 * (a job's estimate, or the ceiling of one whose wrapper is gone). MemAvailable is taken as it
 * is: what a running job uses already shows there, so its whole estimate stays reserved. A job
 * always starts when none runs, since waiting would not free anything.
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
  readonly slice: string
  readonly ceilingBytes: number
}

/**
 * Every `<root>-<id>.slice` the user manager has under `<root>.slice`: the cgroup tree is what
 * runs, whatever happened to the wrappers. A slice removed during the scan is gone.
 */
export function liveSlices(root: string): LiveSlice[] {
  const dir = sliceRootPath(root)
  const prefix = `${root}-`
  return (unlessGone(() => readdirSync(dir)) ?? [])
    .filter((name) => name.startsWith(prefix) && name.endsWith('.slice'))
    .flatMap((slice) => {
      const max = unlessGone(() => readFileSync(path.join(dir, slice, 'memory.max'), 'utf8'))
      if (max === null) return []
      const id = slice.slice(prefix.length, -'.slice'.length)
      return [{ ceilingBytes: Number(max.trim()) || 0, id, slice }]
    })
}

/** The slice's `memory.current`, or null once it is gone. */
export function sliceMemory(root: string, slice: string) {
  const text = unlessGone(() =>
    readFileSync(path.join(sliceRootPath(root), slice, 'memory.current'), 'utf8'),
  )
  return text === null ? null : Number(text)
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
 * new job starts and the running ones finish. A request from a dead process is ignored.
 */
export function drainRequest(stateDir: string): string | null {
  const text = unlessMissing(() => readFileSync(path.join(stateDir, 'drain.request'), 'utf8'))
  if (text === null) return null
  const pid = Number(/\bpid=(\d+)/.exec(text)?.[1])
  if (!pid || !processExists(pid)) return null
  return text.trim()
}

/**
 * Why the legacy slot locks forbid a start, or null. Running jobs hold all three shared, so
 * a tool that takes them exclusively waits for the running jobs to drain; once it waits
 * (a blocked request in /proc/locks) or holds them, no further job starts.
 */
export function legacyHold(stateDir: string, slots: readonly string[]): string | null {
  const inodes = new Set(slots.map((slot) => statSync(path.join(stateDir, slot)).ino))
  if (blockedRequests().some((inode) => inodes.has(inode))) {
    return 'another tool is waiting for the slot locks exclusively'
  }
  for (const slot of slots) {
    const fd = tryLock(path.join(stateDir, slot), 'shared')
    if (fd === null) return `${slot} is held exclusively`
    unlock(fd)
  }
  return null
}

// A blocked request is printed as `N: -> FLOCK ADVISORY WRITE <pid> <maj>:<min>:<inode> 0 EOF`.
function blockedRequests() {
  return readFileSync('/proc/locks', 'utf8')
    .split('\n')
    .filter((line) => line.includes('->'))
    .map((line) => Number(line.trim().split(/\s+/)[6]?.split(':')[2]))
}

function mib(bytes: number) {
  return Math.round(bytes / MiB)
}

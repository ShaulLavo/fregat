import { existsSync, readFileSync, statSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'

import { tryLock, unlock } from './lock'

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

export type Charge = {
  readonly estimateBytes: number
  /** The job's slice `memory.current`, or null before the slice exists. */
  readonly currentBytes: number | null
}

export type Decision =
  | { readonly admit: true; readonly reason: string }
  | { readonly admit: false; readonly reason: string }

/**
 * Whether a job with this estimate may start beside the running jobs. A running job is
 * charged what it has not used yet of its estimate: what it already uses is gone from
 * MemAvailable. A job always starts when none runs, since waiting would not free anything.
 */
export function decide(
  estimateBytes: number,
  running: readonly Charge[],
  readings: Readings,
  limits: Limits,
): Decision {
  if (running.length === 0) return { admit: true, reason: 'no heavy job is running' }
  const committed = running.reduce(
    (total, job) => total + Math.max(0, job.estimateBytes - (job.currentBytes ?? 0)),
    0,
  )
  const free = readings.memAvailableBytes - committed - limits.reserveBytes
  if (free < estimateBytes) {
    return {
      admit: false,
      reason: `memory: ${mib(free)} MiB free after ${running.length} running job(s) and the reserve, ${mib(estimateBytes)} MiB needed`,
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

/** The job slice's `memory.current`; systemd's user manager nests it under `heavy.slice`. */
export function sliceMemory(id: string) {
  const uid = process.getuid?.() ?? 0
  const file = `/sys/fs/cgroup/user.slice/user-${uid}.slice/user@${uid}.service/heavy.slice/heavy-${id}.slice/memory.current`
  if (!existsSync(file)) return null
  return Number(readFileSync(file, 'utf8')) || null
}

function mib(bytes: number) {
  return Math.round(bytes / MiB)
}

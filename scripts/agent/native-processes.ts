import { existsSync, readFileSync, readlinkSync } from 'node:fs'

/** A native.jsonl line about a process: a fixture's own spawn and exit, or a child it started. */
export type NativeProcessEntry = {
  readonly event: string
  readonly kind?: string
  readonly pid?: number
  readonly childPid?: number
  readonly cwd?: string
}

type NativeProcess = { readonly pid: number; readonly kind: 'fixture' | 'child' }

const PROC = existsSync('/proc/self/stat')

// A zombie has already exited; only its parent's wait is outstanding.
function running(pid: number) {
  if (!PROC) {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  try {
    return !/^\d+ \(.*\) Z /s.test(readFileSync(`/proc/${pid}/stat`, 'utf8'))
  } catch {
    return false
  }
}

// Without /proc a pid cannot be told from its reuse, so only the log's own record counts.
function holds(check: () => boolean) {
  if (!PROC) return true
  try {
    return check()
  } catch {
    return false
  }
}

/**
 * Fixture processes and their recorded children that still run. A pid counts only while it
 * still runs the fixture binary from `root`, or a child in its recorded checkout, so a reused
 * pid is never taken for one of them.
 */
export function liveNativeProcesses(root: string, entries: readonly NativeProcessEntry[]) {
  const exited = new Set(
    entries.filter((entry) => entry.event === 'exit').map((entry) => entry.pid),
  )
  const live: NativeProcess[] = []
  for (const entry of entries) {
    if (entry.event === 'spawn' && entry.pid !== undefined) {
      const pid = entry.pid
      const fixture = holds(() => readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(root))
      if (running(pid) && fixture && (PROC || !exited.has(pid))) live.push({ pid, kind: 'fixture' })
      continue
    }
    if (entry.event !== 'child' || entry.childPid === undefined || !entry.cwd) continue
    const { childPid, cwd } = entry
    if (running(childPid) && holds(() => readlinkSync(`/proc/${childPid}/cwd`) === cwd))
      live.push({ pid: childPid, kind: 'child' })
  }
  return live
}

/** SIGKILLs what `liveNativeProcesses` found; a process that exited meanwhile is skipped. */
export function reapNativeProcesses(processes: readonly NativeProcess[]) {
  for (const { pid } of processes) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }
}

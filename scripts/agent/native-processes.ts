import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'

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
      const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' })
      return state.trim().length > 0 && !state.trim().startsWith('Z')
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

function holds(check: () => boolean) {
  try {
    return check()
  } catch {
    return false
  }
}

function fixtureCommand(pid: number) {
  if (PROC) return readFileSync(`/proc/${pid}/cmdline`, 'utf8')
  return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
}

function workingDirectory(pid: number) {
  if (PROC) return readlinkSync(`/proc/${pid}/cwd`)
  const files = execFileSync('lsof', ['-nP', '-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  })
  return files
    .split('\n')
    .find((line) => line.startsWith('n'))
    ?.slice(1)
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
      const fixture = holds(() => fixtureCommand(pid).includes(root))
      if (running(pid) && fixture && (PROC || !exited.has(pid))) live.push({ pid, kind: 'fixture' })
      continue
    }
    if (entry.event !== 'child' || entry.childPid === undefined || !entry.cwd) continue
    const { childPid, cwd } = entry
    if (running(childPid) && holds(() => workingDirectory(childPid) === realpathSync(cwd)))
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

import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type ForegroundProcessReader = (pid: number) => Promise<string | null>

/** True when the shell runs any command, in the foreground, the background or suspended. */
export type ShellCommandReader = (pid: number) => Promise<boolean>

/**
 * The command in the PTY's foreground process group, or null while the shell
 * itself is in the foreground. Linux reads `/proc`; elsewhere `ps` is the only
 * portable source.
 */
export async function readForegroundProcessName(pid: number): Promise<string | null> {
  if (process.platform === 'linux') return readFromProc(pid)

  return readFromPs(pid)
}

async function readFromProc(pid: number) {
  const foreground = await foregroundGroupFromProc(pid)
  if (foreground === null || foreground === pid) return null

  const comm = await readOptional(`/proc/${foreground}/comm`)
  return comm?.trim() || null
}

async function foregroundGroupFromProc(pid: number) {
  const stat = await readOptional(`/proc/${pid}/stat`)
  if (!stat) return null

  // The command name is parenthesised and may contain spaces, so split after it.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  const tpgid = Number(fields[5])
  return Number.isInteger(tpgid) && tpgid > 0 ? tpgid : null
}

async function readFromPs(pid: number) {
  const tpgid = Number(await ps(['-o', 'tpgid=', '-p', String(pid)]))
  if (!Number.isInteger(tpgid) || tpgid <= 0 || tpgid === pid) return null

  const command = await ps(['-o', 'comm=', '-p', String(tpgid)])
  return command ? path.basename(command) : null
}

async function ps(args: string[]) {
  try {
    const child = Bun.spawn(['ps', ...args], { stderr: 'ignore', stdout: 'pipe' })
    const output = await new Response(child.stdout).text()
    await child.exited
    return output.trim()
  } catch {
    return ''
  }
}

async function readOptional(file: string) {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

/** Whether the shell has a child process, read from the machine's process table. */
export async function readShellHasCommand(pid: number): Promise<boolean> {
  const table = await processTable()
  // A table that cannot be read counts as busy: closing a shell on a guess could end work.
  if (!table) return true
  return shellRunsCommand(table, pid)
}

export type ProcessEntry = {
  readonly pid: number
  readonly parent: number
  readonly command: string
}

/**
 * A foreground command, a background job (`&`) and a suspended one (Ctrl-Z) are all children
 * of the shell. Async prompt themes fork the shell into a helper with no children of its own;
 * that copy is not a command the user started.
 */
export function shellRunsCommand(table: ReadonlyMap<number, ProcessEntry>, pid: number) {
  const shell = table.get(pid)?.command
  const entries = [...table.values()]
  return entries.some(
    (child) =>
      child.parent === pid &&
      (child.command !== shell || entries.some((entry) => entry.parent === child.pid)),
  )
}

async function processTable(): Promise<Map<number, ProcessEntry> | null> {
  const output = await ps(['-A', '-o', 'pid=,ppid=,comm='])
  if (!output) return null
  const table = new Map<number, ProcessEntry>()
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line)
    if (!match) continue
    const pid = Number(match[1])
    table.set(pid, { pid, parent: Number(match[2]), command: path.basename(match[3]!.trim()) })
  }
  return table
}

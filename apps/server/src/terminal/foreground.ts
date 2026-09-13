import { readFile } from 'node:fs/promises'
import path from 'node:path'

export type ForegroundProcessReader = (pid: number) => Promise<string | null>

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

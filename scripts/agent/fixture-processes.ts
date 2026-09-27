import { readdir, readlink } from 'node:fs/promises'
import { createScriptError } from '../structured-errors'

/** Processes whose working directory is the fixture, optionally filtered by their stdin target. */
export async function processesIn(
  fixture: string,
  stdin: (target: string) => boolean = () => true,
) {
  if (process.platform === 'darwin') return macProcessesIn(fixture, stdin)
  const pids = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry)).map(Number)
  const matches = await Promise.all(pids.map((pid) => runsIn(pid, fixture, stdin)))
  return pids.filter((_, index) => matches[index])
}

async function runsIn(pid: number, fixture: string, stdin: (target: string) => boolean) {
  const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => null)
  if (cwd !== fixture && cwd !== `${fixture} (deleted)`) return false
  return stdin(await readlink(`/proc/${pid}/fd/0`).catch(() => ''))
}

async function macProcessesIn(fixture: string, stdin: (target: string) => boolean) {
  const child = Bun.spawn(
    ['lsof', '-nP', '-a', '-u', String(process.getuid?.()), '-d', 'cwd,0', '-F', 'pfn'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw createScriptError(`Fixture process lookup failed (${code}): ${error}`)
  return readProcesses(output)
    .filter((entry) => entry.cwd === fixture && stdin(entry.stdin))
    .map((entry) => entry.pid)
}

function readProcesses(output: string) {
  const entries: { pid: number; cwd: string; stdin: string }[] = []
  let descriptor = ''
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) entries.push({ pid: Number(line.slice(1)), cwd: '', stdin: '' })
    if (line.startsWith('f')) descriptor = line.slice(1)
    const entry = entries.at(-1)
    if (!entry || !line.startsWith('n')) continue
    if (descriptor === 'cwd') entry.cwd = line.slice(1)
    if (descriptor === '0') entry.stdin = line.slice(1)
  }
  return entries
}

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { superviseEntry, type Supervisor } from './restart-on-change'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

// A server stand-in that spawns a child and records both pids.
const ENTRY = `
const child = Bun.spawn(['sleep', '60'])
await Bun.write(process.env.PIDS_FILE ?? '', JSON.stringify({ server: process.pid, child: child.pid }))
setInterval(() => {}, 1000)
`

function processState(pid: number) {
  const result = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)])
  return result.stdout.toString().trim()
}

async function readPids(file: string) {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as { server: number; child: number }
  } catch {
    return null
  }
}

test('a source change starts a new process, and the old one leaves no zombie child', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'restart-on-change-'))
  const pidsFile = path.join(dir, 'pids.json')
  process.env.PIDS_FILE = pidsFile
  await writeFile(path.join(dir, 'entry.ts'), ENTRY)
  let supervisor: Supervisor | null = null
  cleanups.push(async () => {
    await supervisor?.stop()
    delete process.env.PIDS_FILE
    await rm(dir, { recursive: true, force: true })
  })
  supervisor = superviseEntry(path.join(dir, 'entry.ts'), [dir])

  await expect.poll(() => readPids(pidsFile), { timeout: 10_000 }).not.toBeNull()
  const first = (await readPids(pidsFile))!
  await rm(pidsFile)
  await writeFile(path.join(dir, 'other.ts'), 'export const changed = 1\n')

  await expect.poll(() => readPids(pidsFile), { timeout: 10_000 }).not.toBeNull()
  const second = (await readPids(pidsFile))!
  cleanups.push(async () => void process.kill(second.child, 'SIGKILL'))
  expect(second.server).not.toBe(first.server)
  expect(supervisor.restarts()).toBe(1)
  expect(processState(first.server)).toBe('')

  // The old server's child outlived it; once it exits, init reaps it instead of leaving a zombie.
  process.kill(first.child, 'SIGKILL')
  await expect.poll(() => processState(first.child), { timeout: 5_000 }).toBe('')
}, 30_000)

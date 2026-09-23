import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { clearLease, leaseChild, releaseChild, stopLeftoverChildren } from '../child-lease'
import { groupAlive, processStart, signalGroup } from '../processes'

let directory: string
let file: string
const spawned: number[] = []

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'desktop-lease-'))
  file = path.join(directory, 'lease.json')
})

afterEach(async () => {
  for (const pid of spawned.splice(0)) signalGroup(pid, 'SIGKILL')
  await rm(directory, { recursive: true, force: true })
})

function spawnGroup(script: string, detached = true) {
  const child = Bun.spawn({ cmd: ['sh', '-c', script], detached, stdout: 'ignore' })
  spawned.push(child.pid)
  return child
}

async function childPids(pid: number) {
  const output = await Bun.$`pgrep -g ${pid}`.nothrow().text()
  return output.split('\n').filter(Boolean).map(Number)
}

test('a leased leftover is stopped with every process in its group', async () => {
  const leader = spawnGroup('sleep 60 & sleep 60')
  await leaseChild(file, 'web', leader.pid)
  await Bun.sleep(100)
  expect((await childPids(leader.pid)).length).toBeGreaterThan(1)

  await stopLeftoverChildren(file)

  expect(groupAlive(leader.pid)).toBe(false)
  await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

test('a recorded pid that now belongs to another process is left running', async () => {
  const stranger = spawnGroup('sleep 60')
  const startedAt = await processStart(stranger.pid)
  await writeFile(
    file,
    JSON.stringify([{ name: 'server', pid: stranger.pid, startedAt: 'Thu Jan  1 00:00:00 1970' }]),
  )
  expect(startedAt).not.toBe('Thu Jan  1 00:00:00 1970')

  await stopLeftoverChildren(file)

  expect(groupAlive(stranger.pid)).toBe(true)
  await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

test('releasing a child removes only that record', async () => {
  const server = spawnGroup('sleep 60')
  const web = spawnGroup('sleep 60')
  await leaseChild(file, 'server', server.pid)
  await leaseChild(file, 'web', web.pid)

  await releaseChild(file, server.pid)

  const records = JSON.parse(await readFile(file, 'utf8')) as { name: string; pid: number }[]
  expect(records.map(({ name, pid }) => ({ name, pid }))).toEqual([{ name: 'web', pid: web.pid }])
})

test('children exiting together release their records without racing the file', async () => {
  const server = spawnGroup('sleep 60')
  const web = spawnGroup('sleep 60')
  await leaseChild(file, 'server', server.pid)
  await leaseChild(file, 'web', web.pid)

  const settled = await Promise.allSettled([
    releaseChild(file, server.pid),
    releaseChild(file, web.pid),
    clearLease(file),
  ])

  expect(settled.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled'])
  await expect(readFile(file, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

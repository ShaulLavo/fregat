import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { legacyHold } from './admission'
import { acquirePiLane, tryLock, unlock } from './lock'

const SLOTS = ['slot1.lock', 'slot2.lock', 'slot3.lock'] as const
const roots: string[] = []
const held: number[] = []

afterEach(() => {
  for (const fd of held.splice(0)) unlock(fd)
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function stateDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'heavy-lock-'))
  roots.push(dir)
  for (const slot of SLOTS) writeFileSync(path.join(dir, slot), '')
  return dir
}

function holdMachineSlots(dir: string) {
  for (const slot of SLOTS) held.push(tryLock(path.join(dir, slot))!)
}

const pending = Symbol('pending')
const settledWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise, Bun.sleep(ms).then(() => pending)])

test('a Pi job starts while every machine slot is held', async () => {
  const dir = stateDir()
  holdMachineSlots(dir)
  const acquired = await settledWithin(acquirePiLane(dir, 20), 500)
  expect(acquired).toMatchObject({ holder: path.join(dir, 'pi.holder') })
  held.push((acquired as { fd: number }).fd)
})

test('a second Pi job waits for the first', async () => {
  const dir = stateDir()
  const first = await acquirePiLane(dir, 20)
  const second = acquirePiLane(dir, 20)
  expect(await settledWithin(second, 300)).toBe(pending)
  unlock(first.fd)
  held.push((await second).fd)
})

test('a held Pi lane leaves this machine free for local jobs', async () => {
  const dir = stateDir()
  held.push((await acquirePiLane(dir, 20)).fd)
  expect(legacyHold(dir, SLOTS)).toBeNull()
})

test('keeps waiting when the Pi holder line cannot be read', async () => {
  const dir = stateDir()
  const first = await acquirePiLane(dir, 20)
  mkdirSync(path.join(dir, 'pi.holder'))
  const queued = acquirePiLane(dir, 20)
  const outcome = await Promise.race([
    queued.then(
      () => 'acquired',
      (error: unknown) => `rejected: ${String(error)}`,
    ),
    Bun.sleep(300).then(() => 'waiting'),
  ])
  expect(outcome).toBe('waiting')
  unlock(first.fd)
  held.push((await queued).fd)
})

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { acquireSlot, tryLock, unlock } from './lock'

const roots: string[] = []
const held: number[] = []

afterEach(() => {
  for (const fd of held.splice(0)) unlock(fd)
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function lockDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'heavy-lock-'))
  roots.push(dir)
  return dir
}

function holdMachineSlots(dir: string) {
  for (const slot of [1, 2, 3]) held.push(tryLock(path.join(dir, `slot${slot}.lock`))!)
}

const pending = Symbol('pending')
const settledWithin = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise, Bun.sleep(ms).then(() => pending)])

test('a Pi job starts while every machine slot is held', async () => {
  const dir = lockDir()
  holdMachineSlots(dir)
  const acquired = await settledWithin(acquireSlot(dir, 'pi', 20), 500)
  expect(acquired).toMatchObject({ slot: 0, holder: path.join(dir, 'pi.holder') })
  held.push((acquired as { fd: number }).fd)
})

test('a second Pi job waits for the first', async () => {
  const dir = lockDir()
  const first = await acquireSlot(dir, 'pi', 20)
  const second = acquireSlot(dir, 'pi', 20)
  expect(await settledWithin(second, 300)).toBe(pending)
  unlock(first.fd)
  const next = (await second) as { fd: number; slot: number }
  held.push(next.fd)
  expect(next.slot).toBe(0)
})

test('a held Pi slot leaves the machine slots free', async () => {
  const dir = lockDir()
  held.push((await acquireSlot(dir, 'pi', 20)).fd)
  const local = await acquireSlot(dir, 'local', 20)
  held.push(local.fd)
  expect(local.slot).toBe(1)
})

test('keeps waiting when a holder line cannot be read', async () => {
  const dir = lockDir()
  holdMachineSlots(dir)
  mkdirSync(path.join(dir, 'slot1.holder'))
  const queued = acquireSlot(dir, 'local', 20)
  const outcome = await Promise.race([
    queued.then(
      () => 'acquired',
      (error: unknown) => `rejected: ${String(error)}`,
    ),
    Bun.sleep(300).then(() => 'waiting'),
  ])
  expect(outcome).toBe('waiting')
  unlock(held.shift()!)
  held.push((await queued).fd)
})

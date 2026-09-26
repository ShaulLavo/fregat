import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'

import { createLogRetention, pruneExpiredLogs } from '../retention'

const NOW = Date.parse('2026-09-26T12:00:00Z')
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function logDir(names: readonly string[]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'platform-log-retention-'))
  dirs.push(dir)
  await Promise.all(names.map((name) => writeFile(path.join(dir, name), '{}\n')))
  return dir
}

it('deletes the files of days before the kept window and leaves other files alone', async () => {
  const dir = await logDir([
    '2026-09-23.jsonl',
    '2026-09-24.jsonl',
    '2026-09-24.2.jsonl',
    '2026-09-25.jsonl',
    '2026-09-26.jsonl',
    '.gitignore',
    'notes.txt',
  ])

  expect(await pruneExpiredLogs(dir, 2, NOW)).toBe(3)
  expect((await readdir(dir)).toSorted()).toEqual([
    '.gitignore',
    '2026-09-25.jsonl',
    '2026-09-26.jsonl',
    'notes.txt',
  ])
})

it('keeps every day at 0', async () => {
  const dir = await logDir(['2020-01-01.jsonl', '2026-09-26.jsonl'])

  expect(await pruneExpiredLogs(dir, 0, NOW)).toBe(0)
  expect(await readdir(dir)).toHaveLength(2)
})

it('prunes once per day, and again when the retention changes', async () => {
  const dir = await logDir(['2026-09-20.jsonl', '2026-09-24.jsonl', '2026-09-26.jsonl'])
  let days = 5
  const retention = createLogRetention(
    dir,
    () => days,
    () => {},
  )

  expect(await retention(NOW)).toBe(1)
  await writeFile(path.join(dir, '2026-09-19.jsonl'), '{}\n')
  expect(await retention(NOW)).toBe(0)
  expect(await readdir(dir)).toContain('2026-09-19.jsonl')

  days = 1
  expect(await retention(NOW)).toBe(2)
  expect(await readdir(dir)).toEqual(['2026-09-26.jsonl'])
})

it('never throws, and reports only the first failure of a series', async () => {
  const dir = await logDir(['2026-09-20.jsonl', '2026-09-26.jsonl'])
  const failures: unknown[] = []
  let broken = true
  const retention = createLogRetention(
    dir,
    () => {
      if (broken) throw new TypeError('settings unavailable')
      return 1
    },
    (error) => failures.push(error),
  )

  expect(await retention(NOW)).toBe(0)
  expect(await retention(NOW)).toBe(0)
  expect(failures).toHaveLength(1)

  broken = false
  expect(await retention(NOW)).toBe(1)
})

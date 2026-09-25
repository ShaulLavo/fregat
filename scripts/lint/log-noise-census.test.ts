import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

import { groupKey, logNoiseCensus } from './log-noise-census'

const UNTIL = new Date('2026-09-25T12:00:00.000Z')
const SINCE = new Date(UNTIL.getTime() - 86_400_000)

let directory = ''

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'log-noise-census-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function line(minutesBeforeUntil: number, fields: Record<string, unknown>) {
  const timestamp = new Date(UNTIL.getTime() - minutesBeforeUntil * 60_000).toISOString()
  return JSON.stringify({ timestamp, ...fields })
}

function writeLog(lines: readonly string[]) {
  writeFileSync(join(directory, '2026-09-25.jsonl'), `${lines.join('\n')}\n`)
}

function writeAllow(entries: Record<string, string>) {
  const file = join(directory, 'allow.json')
  writeFileSync(file, JSON.stringify(entries))
  return file
}

const reaper = {
  level: 'warn',
  area: 'chat',
  action: 'chat.pipeline.provider_session_reaper.stop_failed',
  error: { code: 'server.INTERNAL_ERROR', message: 'Provider instance not found' },
}
const REAPER_KEY =
  'warn chat chat.pipeline.provider_session_reaper.stop_failed server.INTERNAL_ERROR'

function census(allow: Record<string, string> = {}) {
  return logNoiseCensus({ directory, since: SINCE, until: UNTIL, allowFile: writeAllow(allow) })
}

test('a group over its daily budget is noise', async () => {
  const quiet = { level: 'warn', area: 'git', action: 'git.status' }
  writeLog([
    ...Array.from({ length: 51 }, (_, index) => line(index * 20, reaper)),
    ...Array.from({ length: 3 }, (_, index) => line(index, quiet)),
  ])

  const result = await census()

  expect(result.budget).toBe(50)
  expect(result.failures.map((group) => group.key)).toEqual([REAPER_KEY])
  expect(result.failures[0]?.reasons).toEqual(['51 lines, budget 50'])
})

test('a group that repeats for over an hour is noise under its budget', async () => {
  writeLog(Array.from({ length: 8 }, (_, index) => line(index * 9, reaper)))

  const [group] = (await census()).failures

  expect(group?.count).toBe(8)
  expect(group?.reasons).toEqual(['repeats for 1h03m'])
})

test('a ten-minute gap ends a run', async () => {
  const times = [0, 9, 18, 27, 38, 47, 56, 65]
  writeLog(times.map((minutes) => line(minutes, reaper)))

  expect((await census()).failures).toEqual([])
})

test('an allow entry with a reason excuses a group, and one without a reason fails', async () => {
  writeLog(Array.from({ length: 60 }, (_, index) => line(index * 20, reaper)))

  const excused = await census({ [REAPER_KEY]: 'Stuck binding, fixed in the next release.' })
  expect(excused.failures).toEqual([])
  expect(excused.groups[0]?.allowed).toBe('Stuck binding, fixed in the next release.')

  const bare = await census({ [REAPER_KEY]: ' ' })
  expect(bare.allowProblems).toEqual([`${REAPER_KEY}: an allow entry needs a reason`])
  expect(bare.failures.map((group) => group.key)).toEqual([REAPER_KEY])
})

test('checkpoint lines and info lines are not counted', async () => {
  writeLog([
    ...Array.from({ length: 60 }, (_, index) => line(index, { ...reaper, checkpoint: 'failure' })),
    ...Array.from({ length: 60 }, (_, index) => line(index, { ...reaper, level: 'info' })),
    line(1, reaper),
  ])

  const result = await census()

  expect(result.lines).toBe(1)
  expect(result.failures).toEqual([])
})

test('HTTP lines group by route with ids folded', () => {
  const address = (path: string) => ({
    timestamp: UNTIL.toISOString(),
    level: 'warn' as const,
    area: 'fs',
    method: 'GET',
    path,
    error: { code: 'NOT_FOUND' },
  })

  expect(groupKey(address('/fs/workspace-address/TtmPUppXzd85vy1E'))).toBe(
    'warn fs GET /fs/workspace-address/:id NOT_FOUND',
  )
  expect(groupKey(address('/sessions/3f9c2d1e-8b7a-4c6d-9e0f-1a2b3c4d5e6f/turns/42'))).toBe(
    'warn fs GET /sessions/:id/turns/:id NOT_FOUND',
  )
  expect(groupKey(address('/fs/workspace-address'))).toBe(
    'warn fs GET /fs/workspace-address NOT_FOUND',
  )
})

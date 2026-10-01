import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { readAccounting } from '../job'
import { accountingText, laneRunName } from './lane-job'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

function readBack(text: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'lane-accounting-'))
  roots.push(root)
  const file = path.join(root, 'accounting')
  writeFileSync(file, text)
  return readAccounting(file)
}

test('the wrapper reads a lane job slice totals as it reads a local scope', () => {
  const totals = {
    host: 'pi',
    exitCode: 0,
    memoryPeakBytes: 934903808,
    cpuUsageUsec: 201308282,
    oomKills: 0,
  }
  expect(readBack(accountingText(totals, 0))).toEqual({
    cpuUsageUsec: 201308282,
    leftoverProcesses: null,
    memoryPeakBytes: 934903808,
    oomKills: 0,
  })
})

test('missing lane totals read as unknown, not zero', () => {
  expect(readBack(accountingText(null, 74))).toEqual({
    cpuUsageUsec: null,
    leftoverProcesses: null,
    memoryPeakBytes: null,
    oomKills: null,
  })
})

test('run names stay unique and slice-safe', () => {
  const a = laneRunName('heavy-1a2b')
  expect(a).toMatch(/^\d{8}t\d{6}-heavy-1a2b-[0-9a-f]{6}$/)
  expect(laneRunName('heavy-1a2b')).not.toBe(a)
  expect(laneRunName('Big File!')).toMatch(/-big-file--[0-9a-f]{6}$/)
})
